import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { findAction, loadConfig, publicActions, publicLayout, saveConfig } from './config.js'
import { createActionRunner } from './actions.js'
import { createSampler } from './sampler.js'
import { createLogger } from './logger.js'
import { createMediaWatcher, controlMedia } from './media.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 8787)
const TOKEN = process.env.PANEL_TOKEN || ''
const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const LOG_FILE = path.join(DATA_DIR, 'panel.log')
const METRICS_INTERVAL = Number(process.env.PANEL_METRICS_INTERVAL) || 60 * 1000

const logger = createLogger(LOG_FILE)
let config = loadConfig(CONFIG_FILE, { warn: (message) => logger.warn(message) })
const runAction = createActionRunner()
const sampler = createSampler()
const mediaWatcher = createMediaWatcher({
  logger,
  onUpdate: (media) => broadcast({ t: 'media', media }),
})

const app = express()
app.use(express.json())

function authorized(req) {
  if (!TOKEN) return true
  const fromQuery = req.query.token
  const fromHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return fromQuery === TOKEN || fromHeader === TOKEN
}

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

const info = {
  host: os.hostname(),
  cpu: (os.cpus()[0]?.model || 'CPU').trim(),
  cores: os.cpus().length,
  memTotal: os.totalmem(),
  platform: `${os.type()} ${os.release()}`,
}

app.get('/api/info', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })
  res.json(info)
})

app.post('/api/action', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })
  const { id } = req.body || {}
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
  res.json({ ok: true, config, localOnly: true })
})

app.put('/api/admin/config', (req, res) => {
  try {
    config = saveConfig(CONFIG_FILE, req.body)
    logger.info(`配置已保存，共 ${config.actions.length} 个动作、${config.layout.pages.length} 个页面`)
    broadcast({ t: 'config', actions: publicActions(config), layout: publicLayout(config) })
    res.json({ ok: true, config })
  } catch (err) {
    logger.warn(`配置保存失败：${err.message}`)
    res.status(400).json({ ok: false, error: err.message, errors: err.errors || [] })
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
  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
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
      info,
      actions: publicActions(config),
      layout: publicLayout(config),
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
setInterval(() => {
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
}, METRICS_INTERVAL)

sampler.readDisk(true)

function shutdown() {
  try {
    mediaWatcher.stop()
    sampler.stopNetworkPolling()
    sampler.stopHardwarePolling()
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
  const suffix = TOKEN ? `/?token=${TOKEN}` : '/'
  logger.info(`服务已启动，端口 ${PORT}`)
  console.log(`\n  Desk Panel 已启动  (端口 ${PORT}${TOKEN ? '，已启用 token' : '，未设置 token'}）`)
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
