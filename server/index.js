import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import si from 'systeminformation'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 8787)
const TOKEN = process.env.PANEL_TOKEN || ''

// 动作白名单：客户端只传 ID，命令本身永远不出本机
const ACTIONS = {
  terminal: () => spawn('wt.exe', [], { detached: true, stdio: 'ignore' }),
  explorer: () => spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }),
  vscode: () => spawn('code', [], { detached: true, stdio: 'ignore', shell: true }),
  browser: () => spawn('cmd', ['/c', 'start', '', 'https://github.com'], { detached: true, stdio: 'ignore', windowsHide: true }),
  lock: () => spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }),
}

function runAction(id) {
  const fn = ACTIONS[id]
  if (!fn) return Promise.reject(new Error(`未知动作: ${id}`))
  return new Promise((resolve, reject) => {
    let child
    try {
      child = fn()
    } catch (err) {
      reject(err)
      return
    }

    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else {
        child.unref()
        resolve()
      }
    }
    const timer = setTimeout(() => finish(new Error('启动超时，请检查目标程序')), 5000)

    child.once('spawn', () => finish())
    child.once('error', (err) =>
      finish(err.code === 'ENOENT' ? new Error('未找到目标程序，请检查是否已安装') : err)
    )
  })
}

const app = express()
app.use(express.json())

function authorized(req) {
  if (!TOKEN) return true
  const fromQuery = req.query.token
  const fromHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return fromQuery === TOKEN || fromHeader === TOKEN
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
  try {
    await runAction(id)
    res.json({ ok: true, id })
  } catch (err) {
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

// ---------- 采集 ----------
// CPU / 内存 / 磁盘走 Node 原生接口，1s 采样近乎零开销；
// 网络统计在 Windows 上只能靠 WMI，单独在后台异步轮询并自行算差值。
let prevCpu = null
let netPrev = null
let netRate = { rx: 0, tx: 0 }
let diskCache = { mount: 'C:', used: 0, size: 0 }
let diskAt = 0
let netTimer = null
let latest = null

function readCpu() {
  const snapshot = os.cpus().map((c) => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }
  })

  // 第一次采样没有可比较的基准，返回 null 让前端显示 "--"，避免误报 0%
  if (!prevCpu) {
    prevCpu = snapshot
    return { load: null, cores: Array(snapshot.length).fill(null) }
  }

  const cores = []
  let totalDelta = 0
  let idleDelta = 0

  for (let i = 0; i < snapshot.length; i++) {
    const prev = prevCpu[i]
    if (!prev) {
      cores.push(null)
      continue
    }
    const dTotal = snapshot[i].total - prev.total
    const dIdle = snapshot[i].idle - prev.idle
    if (dTotal <= 0) {
      cores.push(null)
      continue
    }
    cores.push(Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))))
    totalDelta += dTotal
    idleDelta += dIdle
  }

  prevCpu = snapshot
  const load = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
  return { load, cores }
}

function readDisk(force = false) {
  const now = Date.now()
  if (!force && now - diskAt < 10000) return diskCache
  try {
    const st = fs.statfsSync('C:\\')
    const size = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    diskCache = { mount: 'C:', size, used: size - free }
    diskAt = now
  } catch {
    /* 读不到就沿用上一次的值 */
  }
  return diskCache
}

function startNetworkPolling() {
  if (netTimer) return
  netPrev = null
  pollNetwork()
  netTimer = setInterval(pollNetwork, 3000)
}

function stopNetworkPolling() {
  clearInterval(netTimer)
  netTimer = null
  netPrev = null
  netRate = { rx: 0, tx: 0 }
}

async function pollNetwork() {
  try {
    const list = await si.networkStats()
    const nic = list.find((n) => n.operstate === 'up' && n.rx_bytes > 0) || list[0]
    if (!nic) return
    const now = Date.now()
    if (netPrev && netPrev.iface === nic.iface) {
      const dt = (now - netPrev.t) / 1000
      if (dt > 0) {
        netRate = {
          rx: Math.max(0, Math.round((nic.rx_bytes - netPrev.rx) / dt)),
          tx: Math.max(0, Math.round((nic.tx_bytes - netPrev.tx) / dt)),
        }
      }
    }
    netPrev = { iface: nic.iface, rx: nic.rx_bytes, tx: nic.tx_bytes, t: now }
  } catch {
    /* 忽略：部分网卡读不到统计 */
  }
}

function sample() {
  const cpu = readCpu()
  const disk = readDisk()
  return {
    ts: Date.now(),
    cpu: cpu.load,
    cores: cpu.cores,
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    disk,
    rx: netRate.rx,
    tx: netRate.tx,
    uptime: os.uptime(),
  }
}

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost')
  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
    ws.close(1008, 'unauthorized')
    return
  }
  clients.add(ws)
  if (clients.size === 1) {
    // 无客户端期间不采样；首个客户端接入时重建基准并立即给一帧快照
    prevCpu = null
    readDisk(true)
    try {
      latest = sample()
    } catch (err) {
      console.error('[sample]', err.message)
    }
    startNetworkPolling()
  }
  ws.send(JSON.stringify({ t: 'hello', info, actions: Object.keys(ACTIONS) }))
  if (latest) ws.send(JSON.stringify({ t: 'metrics', ...latest }))
  ws.on('close', () => {
    clients.delete(ws)
    if (clients.size === 0) stopNetworkPolling()
  })
  ws.on('error', () => {
    clients.delete(ws)
    if (clients.size === 0) stopNetworkPolling()
  })
})

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
    latest = sample()
    broadcast({ t: 'metrics', ...latest })
  } catch (err) {
    console.error('[sample]', err.message)
  } finally {
    busy = false
  }
}, 1000)

readDisk(true)

server.listen(PORT, '0.0.0.0', () => {
  const suffix = TOKEN ? `/?token=${TOKEN}` : '/'
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
