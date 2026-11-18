import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  createDefaultConfig,
  findAction,
  loadConfig,
  normalizeConfig,
  publicActions,
  publicAgent,
  publicDev,
  publicLayout,
  publicSettings,
  saveConfig,
} from './config.js'
import { createActionRunner } from './actions.js'
import { createDevManager } from './devprocs.js'
import { createSampler } from './sampler.js'
import { createLogger } from './logger.js'
import { createMediaWatcher, controlMedia } from './media.js'
import { createOptimizer } from './optimize.js'
import { analyzeWithAgent, executeAgentPlan } from './agent.js'
import { openDevPort, scanDevPorts, stopDevProcess } from './devports.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 8787)
const ENV_TOKEN = process.env.PANEL_TOKEN || ''
const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const LOG_FILE = path.join(DATA_DIR, 'panel.log')
const METRICS_INTERVAL_ENV = Number(process.env.PANEL_METRICS_INTERVAL) || 0

const logger = createLogger(LOG_FILE)
let config = loadConfig(CONFIG_FILE, { warn: (message) => logger.warn(message) })
const runAction = createActionRunner()
const optimizer = createOptimizer()
const sampler = createSampler({ getFanUrl: () => config.settings?.fanUrl })
const mediaWatcher = createMediaWatcher({
  logger,
  onUpdate: (media) => broadcast({ t: 'media', media }),
})
const devManager = createDevManager({
  onLog: (id, lines) => broadcast({ t: 'devlogs', id, lines }),
  onChange: (service) => service && broadcast({ t: 'devproc', service }),
})
devManager.sync(config.dev?.services || [])

const app = express()
app.use(express.json())

// 环境变量优先于设置页里的口令，便于部署时锁定
function accessToken() {
  return ENV_TOKEN || config.settings?.token || ''
}

function authorized(req) {
  const token = accessToken()
  if (!token) return true
  const fromQuery = req.query.token
  const fromHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return fromQuery === token || fromHeader === token
}

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const item of addrs || []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254')) {
        return item.address
      }
    }
  }
  return ''
}

const info = {
  host: os.hostname(),
  cpu: (os.cpus()[0]?.model || 'CPU').trim(),
  cores: os.cpus().length,
  memTotal: os.totalmem(),
  platform: `${os.type()} ${os.release()}`,
  arch: os.arch(),
  ip: lanAddress(),
}

app.get('/api/info', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })
  res.json({ ...info, agent: publicAgent(config) })
})

let agentBusy = false
let agentHits = []

app.post('/api/agent/analyze', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const now = Date.now()
  agentHits = agentHits.filter((time) => now - time < 60000)
  if (agentHits.length >= 10) {
    return res.status(429).json({ error: 'Agent 请求过于频繁，请稍后再试' })
  }
  if (agentBusy) return res.status(429).json({ error: 'Agent 正在分析，请稍后再试' })
  agentHits.push(now)

  agentBusy = true
  try {
    const metrics = latest || sampler.sample()
    const result = await analyzeWithAgent({
      agent: config.agent,
      metrics,
      prompt: req.body?.prompt,
    })

    // 切实执行：safe 模式下由服务端直接执行可逆动作，advice 模式只返回建议
    let executed = []
    if (result.permission === 'safe') {
      executed = await executeAgentPlan({
        actions: result.actions,
        optimizer,
        fan: (percent) => setFanPercent(percent),
        media: (command) => controlMedia(command),
      })
      for (const item of executed) {
        if (item.ok) logger.info(`Agent 已执行：${item.label}`)
        else logger.warn(`Agent 执行失败：${item.label} ${item.error}`)
      }
    }
    res.json({ ok: true, ...result, executed })
  } catch (err) {
    logger.warn(`Agent 分析失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  } finally {
    agentBusy = false
  }
})

app.post('/api/devices/toggle', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })
  const { id, connected } = req.body || {}
  if (!id) return res.status(400).json({ ok: false, error: '缺少设备标识' })

  try {
    const result = await sampler.setDeviceEnabled(id, Boolean(connected))
    logger.info(`设备${connected ? '连接' : '断开'}：${id}`)
    res.json({ ok: true, ...result })
  } catch (err) {
    logger.warn(`设备操作失败：${id} ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

app.post('/api/action', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })
  const { id } = req.body || {}

  // 熄屏成功后的临时亮屏动作，不写入用户配置
  if (id === '__wake') {
    try {
      await runAction({ id: '__wake', kind: 'monitor-on', label: '亮屏' })
      logger.info('动作已执行：亮屏（__wake）')
      res.json({ ok: true, id })
    } catch (err) {
      logger.warn(`动作失败：亮屏（__wake） ${err.message}`)
      res.status(400).json({ ok: false, error: err.message })
    }
    return
  }

  const action = findAction(config, id)
  if (!action) return res.status(404).json({ ok: false, error: '动作不存在或已停用' })

  try {
    await runAction(action)
    logger.info(`动作已执行：${action.label}（${action.id}）`)
    res.json({ ok: true, id })
  } catch (err) {
    logger.warn(`动作失败：${action.label}（${action.id}） ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

// 设置接口只对本机开放，避免局域网设备直接修改动作配置
app.use('/api/admin', (req, res, next) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: '设置页仅支持本机访问' })
  next()
})

app.get('/api/admin/config', (req, res) => {
  res.json({
    ok: true,
    config,
    localOnly: true,
    configFile: path.relative(ROOT, CONFIG_FILE),
    envToken: !!ENV_TOKEN,
  })
})

app.get('/api/admin/defaults', (req, res) => {
  res.json({ ok: true, config: createDefaultConfig() })
})

app.put('/api/admin/config', (req, res) => {
  try {
    const previousToken = accessToken()
    config = saveConfig(CONFIG_FILE, req.body)
    scheduleMetrics()
    devManager.sync(config.dev?.services || [])
    logger.info(`配置已保存，共 ${config.actions.length} 个动作、${config.layout.pages.length} 个页面`)
    broadcast({
      t: 'config',
      actions: publicActions(config),
      layout: publicLayout(config),
      settings: publicSettings(config),
      agent: publicAgent(config),
      dev: { ...publicDev(config), proc: devManager.list(config.dev?.services || []) },
    })
    // 口令变化后旧连接已失效，主动断开让客户端按新口令重连
    if (accessToken() !== previousToken) {
      for (const ws of clients) {
        try {
          ws.close(1008, 'token changed')
        } catch {
          /* 忽略关闭异常 */
        }
      }
    }
    res.json({ ok: true, config })
  } catch (err) {
    logger.warn(`配置保存失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message, errors: err.errors || [] })
  }
})

// 试运行使用草稿动作，不写入配置，方便在保存前验证命令是否正确
let lastTestAt = 0
app.post('/api/admin/action/test', async (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ ok: false, error: '仅支持本机试运行' })
  if (Date.now() - lastTestAt < 600) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  lastTestAt = Date.now()

  const { action } = req.body || {}
  const draft = normalizeConfig(
    { actions: action ? [action] : [], layout: createDefaultConfig().layout },
    { strict: true }
  )
  if (draft.errors.length) {
    return res.status(400).json({ ok: false, error: draft.errors[0], errors: draft.errors })
  }
  const target = draft.config.actions[0]
  if (!target) return res.status(400).json({ ok: false, error: '动作内容为空' })
  if (target.kind === 'lock') {
    return res.status(400).json({ ok: false, error: '锁屏动作不支持试运行，避免中断当前操作' })
  }

  try {
    await runAction(target)
    logger.info(`动作试运行成功：${target.label}（${target.kind}）`)
    res.json({ ok: true })
  } catch (err) {
    logger.warn(`动作试运行失败：${target.label} ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

app.post('/api/media', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const { command } = req.body || {}
  try {
    await controlMedia(command)
    res.json({ ok: true, command })
  } catch (err) {
    logger.warn(`媒体指令失败：${command} ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

let lastOptimizeAt = 0

app.post('/api/optimize/run', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - lastOptimizeAt < 800) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  lastOptimizeAt = Date.now()

  const { action, pid, level } = req.body || {}
  try {
    const result = await optimizer.run({ action, pid, level })
    logger.info(`优化动作已执行：${action}${pid ? `（PID ${pid}）` : ''}`)
    res.json({ ok: true, ...result })
  } catch (err) {
    logger.warn(`优化动作失败：${action} ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

function collectFanControls(node, out) {
  if (!node || typeof node !== 'object') return
  if (node.Type === 'Control' && node.SensorId) {
    out.push({ sensorId: node.SensorId, name: node.Text || 'Control' })
  }
  for (const child of node.Children || []) collectFanControls(child, out)
}

// 开发端口扫描：全量扫描由前端手动触发，避免占用采样节奏
let devScanAt = 0
app.get('/api/dev/ports', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - devScanAt < 1200) {
    return res.status(429).json({ ok: false, error: '扫描过于频繁，请稍后再试' })
  }
  devScanAt = Date.now()

  try {
    const ports = await scanDevPorts()
    res.json({ ok: true, ports, scannedAt: Date.now() })
  } catch (err) {
    logger.warn(`端口扫描失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

// 结束占用开发端口的进程：按所选权限设置放开，二次校验端口归属防止被当作任意 PID 杀手
let devStopAt = 0
app.post('/api/dev/stop', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - devStopAt < 800) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  devStopAt = Date.now()

  const { pid, tree } = req.body || {}
  try {
    const result = await stopDevProcess({ pid, tree })
    logger.info(`已结束开发端口进程：${result.name}(${result.pid}) 端口 ${result.port}`)
    res.json({ ok: true, ...result })
  } catch (err) {
    logger.warn(`结束开发端口进程失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

// 在电脑本机浏览器打开开发端口（平板访问面板时也能让电脑打开网页）
let devOpenAt = 0
app.post('/api/dev/open', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - devOpenAt < 600) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  devOpenAt = Date.now()

  const { port } = req.body || {}
  try {
    const result = await openDevPort({ port })
    logger.info(`已在电脑浏览器打开：${result.url}`)
    res.json({ ok: true, ...result })
  } catch (err) {
    logger.warn(`打开开发端口失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

// 开发服务一键启停：spawn 由 devManager 纳管，stdout/stderr 进环形缓冲并通过 WS 推送
function devServiceById(id) {
  return (config.dev?.services || []).find((item) => item.id === id) || null
}

let devProcAt = 0
app.post('/api/dev/proc/start', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - devProcAt < 400) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  devProcAt = Date.now()

  const service = devServiceById(req.body?.id)
  if (!service) return res.status(404).json({ ok: false, error: '开发服务不存在' })

  try {
    const state = devManager.start(service)
    logger.info(`开发服务已启动：${service.name}（${service.command}）`)
    res.json({ ok: true, service: state })
  } catch (err) {
    logger.warn(`开发服务启动失败：${service.name} ${err.message}`)
    res.status(400).json({ ok: false, error: err.message })
  }
})

app.post('/api/dev/proc/stop', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  if (Date.now() - devProcAt < 400) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  devProcAt = Date.now()

  const service = devServiceById(req.body?.id)
  if (!service) return res.status(404).json({ ok: false, error: '开发服务不存在' })

  const state = await devManager.stop(service)
  logger.info(`开发服务已停止：${service.name}`)
  res.json({ ok: true, service: state })
})

app.get('/api/dev/proc', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  res.json({ ok: true, services: devManager.list(config.dev?.services || []) })
})

app.get('/api/dev/logs', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const id = String(req.query.id || '')
  const service = devServiceById(id)
  if (!service) return res.status(404).json({ ok: false, error: '开发服务不存在' })
  const since = Number(req.query.since) || 0
  const { lines, seq, state } = devManager.logs(id, since)
  res.json({ ok: true, id, lines, seq, state })
})

// 设置风扇档位的核心逻辑，供 /api/fan/set 与 Agent 执行复用
async function setFanPercent(percent) {
  const auto = percent === null
  const base = (config.settings?.fanUrl || 'http://127.0.0.1:8085').replace(/\/+$/, '')
  const treeRes = await fetch(`${base}/data.json`, { signal: AbortSignal.timeout(3000) })
  if (!treeRes.ok) throw new Error(`无法读取风扇数据（HTTP ${treeRes.status}）`)
  const tree = await treeRes.json()
  const controls = []
  collectFanControls(tree, controls)
  if (!controls.length) {
    throw new Error('未发现可控风扇，请确认 LibreHardwareMonitor 已安装并以管理员运行')
  }

  // 优先控制主板风扇，跳过水泵与显卡，避免覆盖自动曲线
  const safe = controls.filter(
    (control) => !control.sensorId.startsWith('/gpu') && !/pump/i.test(control.name)
  )
  const motherboard = safe.filter((control) => !control.sensorId.startsWith('/gpu'))
  const targets = motherboard.length ? motherboard : controls

  const value = auto ? 'null' : String(percent)
  const results = await Promise.all(
    targets.map(async (control) => {
      const url = `${base}/Sensor?action=Set&id=${encodeURIComponent(control.sensorId)}&value=${value}`
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000) })
      const data = await response.json().catch(() => ({}))
      return data.result === 'ok'
    })
  )
  const count = results.filter(Boolean).length
  if (!count) throw new Error('风扇控制未成功，请检查 LibreHardwareMonitor 权限')
  return { percent, count }
}

// 风扇控制借助 LibreHardwareMonitor 的 Web Server 完成，服务端不直接碰 EC/驱动
// 不校验访问口令：面板本身已限制在局域网，风扇只涉及散热档位，保留频率限制防止连点
let lastFanAt = 0
let fanSyncTimer = null
app.post('/api/fan/set', async (req, res) => {
  if (Date.now() - lastFanAt < 800) {
    return res.status(429).json({ ok: false, error: '操作过于频繁，请稍后再试' })
  }
  lastFanAt = Date.now()

  const raw = req.body?.percent
  const auto = raw === null || raw === 'auto'
  const percent = auto ? null : Math.round(Number(raw))
  if (!auto && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    return res.status(400).json({ ok: false, error: '风扇转速需在 0-100 之间' })
  }

  try {
    const result = await setFanPercent(percent)
    logger.info(`风扇档位已设置：${auto ? '自动' : `${percent}%`}（${result.count} 路）`)

    // 设置后稍等 LHM 刷新传感器，再回读并推送，避免面板要等下一轮 60 秒采样
    clearTimeout(fanSyncTimer)
    fanSyncTimer = setTimeout(async () => {
      try {
        await sampler.refreshFan()
        latest = sampler.sample()
        broadcast({ t: 'metrics', ...latest, media: mediaWatcher.getState() })
      } catch {
        /* 回读失败不影响本次设置结果 */
      }
    }, 2500)

    res.json({ ok: true, ...result })
  } catch (err) {
    const message =
      err?.name === 'TimeoutError'
        ? '连接 LibreHardwareMonitor 超时，请检查 Web Server 是否在运行'
        : err?.message === 'fetch failed'
          ? '未连接 LibreHardwareMonitor，请先在设置中开启远程 Web Server（8085）'
          : err.message
    logger.warn(`风扇控制失败：${message}`)
    res.status(400).json({ ok: false, error: message })
  }
})

const DIST = path.join(ROOT, 'dist')
if (fs.existsSync(DIST)) {
  // 带 hash 的静态资源长期缓存，入口 HTML 每次协商，避免更新后仍加载旧页面
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    })
  )
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (req, res) =>
    res
      .status(200)
      .type('html')
      .send('<h1>尚未构建前端</h1><p>开发模式请访问 <code>http://localhost:5173</code>，或先运行 <code>npm run build</code>。</p>')
  )
}

const server = createServer(app)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  // 指标改为低频推送后仍开启压缩，进一步降低局域网带宽占用
  perMessageDeflate: { threshold: 0 },
})
const clients = new Set()
let latest = null

wss.on('connection', (ws, req) => {
  try {
    setupConnection(ws, req)
  } catch (err) {
    logger.error(`WS 连接初始化失败：${err.stack || err.message}`)
    try {
      ws.close(1011, 'server error')
    } catch {
      /* 忽略关闭异常 */
    }
  }
})

function setupConnection(ws, req) {
  const url = new URL(req.url, 'http://localhost')
  const token = accessToken()
  if (token && url.searchParams.get('token') !== token) {
    ws.close(1008, 'unauthorized')
    return
  }
  clients.add(ws)
  if (clients.size === 1) {
    // 无客户端期间不采样；首个客户端接入时重建基准并立即给一帧快照
    sampler.reset()
    sampler.readDisk(true)
    try {
      latest = sampler.sample()
    } catch (err) {
      logger.error(`首次采样失败：${err.message}`)
    }
  }
  ws.send(
    JSON.stringify({
      t: 'hello',
      info: { ...info, agent: publicAgent(config) },
      actions: publicActions(config),
      layout: publicLayout(config),
      settings: publicSettings(config),
      dev: { ...publicDev(config), proc: devManager.list(config.dev?.services || []) },
      media: mediaWatcher.getState(),
    })
  )
  if (latest) ws.send(JSON.stringify({ t: 'metrics', ...latest }))
  if (clients.size === 1) {
    // 先让首帧发出去，再启动后台轮询，避免硬件采集拖慢首屏
    setTimeout(() => {
      if (clients.size === 0) return
      sampler.startNetworkPolling()
      sampler.startHardwarePolling()
      mediaWatcher.start()
      // 首次硬件与网络采样较慢，分两次补发，避免新卡片等待下一个推送周期
      for (const delay of [5000, 12000]) {
        setTimeout(() => {
          if (clients.size === 0) return
          try {
            latest = sampler.sample()
            broadcast({ t: 'metrics', ...latest, media: mediaWatcher.getState() })
          } catch (err) {
            logger.warn(`补充采样失败：${err.message}`)
          }
        }, delay)
      }
    }, 800)
  }
  ws.on('close', () => {
    clients.delete(ws)
    if (clients.size === 0) {
      sampler.stopNetworkPolling()
      sampler.stopHardwarePolling()
      mediaWatcher.stop()
    }
  })
  ws.on('error', () => {
    clients.delete(ws)
    if (clients.size === 0) {
      sampler.stopNetworkPolling()
      sampler.stopHardwarePolling()
      mediaWatcher.stop()
    }
  })
}

function broadcast(payload) {
  const text = JSON.stringify(payload)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(text)
  }
}

let busy = false
let metricsTimer = null

function metricsIntervalMs() {
  if (METRICS_INTERVAL_ENV > 0) return METRICS_INTERVAL_ENV
  const seconds = Math.max(5, Number(config.settings?.metricsInterval) || 60)
  return seconds * 1000
}

function scheduleMetrics() {
  if (metricsTimer) clearInterval(metricsTimer)
  metricsTimer = setInterval(() => {
    if (busy || clients.size === 0) return
    busy = true
    try {
      latest = sampler.sample()
      broadcast({ t: 'metrics', ...latest, media: mediaWatcher.getState() })
    } catch (err) {
      logger.error(`采样失败：${err.message}`)
    } finally {
      busy = false
    }
  }, metricsIntervalMs())
}

scheduleMetrics()

sampler.readDisk(true)

function shutdown() {
  try {
    mediaWatcher.stop()
    sampler.stopNetworkPolling()
    sampler.stopHardwarePolling()
    if (metricsTimer) clearInterval(metricsTimer)
    for (const ws of clients) ws.close()
  } catch {
    /* 忽略关闭异常 */
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, '0.0.0.0', () => {
  const token = accessToken()
  const suffix = token ? `/?token=${token}` : '/'
  logger.info(`服务已启动，端口 ${PORT}`)
  console.log(`\n  Desk Panel 已启动  (端口 ${PORT}${token ? '，已启用口令' : '，未设置口令'}）`)
  console.log(`  本机:   http://127.0.0.1:${PORT}${suffix}`)
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254')) {
        console.log(`  局域网: http://${a.address}:${PORT}${suffix}   (${name})`)
      }
    }
  }
  console.log('')
})
