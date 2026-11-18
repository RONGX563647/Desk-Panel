import { spawn } from 'node:child_process'
import fs from 'node:fs'

// 每个服务保留的日志行数，够看编译报错又不吃内存
const RING_SIZE = 400
const MAX_LINE = 500

function trimLine(text) {
  const value = String(text || '').replace(/\r$/, '')
  return value.length > MAX_LINE ? `${value.slice(0, MAX_LINE)}…` : value
}

export function createDevManager({ spawnFn = spawn, onLog = () => {}, onChange = () => {} } = {}) {
  // id -> { service, child, status, pid, startedAt, exitCode, lines, seq }
  const entries = new Map()

  function ensure(service) {
    let entry = entries.get(service.id)
    if (!entry) {
      entry = {
        service,
        child: null,
        status: 'idle',
        pid: 0,
        startedAt: 0,
        exitCode: null,
        lines: [],
        seq: 0,
      }
      entries.set(service.id, entry)
    }
    entry.service = service
    return entry
  }

  function push(entry, stream, chunk) {
    const text = String(chunk || '')
    if (!text) return
    const parts = text.split(/\r?\n/)
    const added = []
    for (const part of parts) {
      if (!part.trim()) continue
      entry.seq += 1
      const line = { n: entry.seq, s: stream, text: trimLine(part), t: Date.now() }
      entry.lines.push(line)
      added.push(line)
    }
    if (entry.lines.length > RING_SIZE) entry.lines.splice(0, entry.lines.length - RING_SIZE)
    if (added.length) onLog(entry.service.id, added)
  }

  function stopEntry(entry, { force = true } = {}) {
    const child = entry.child
    if (!child) return
    try {
      // detached 的 shell 子进程用 taskkill 结束整棵树，避免留下 node/vite
      if (entry.pid) {
        spawnFn('taskkill', ['/PID', String(entry.pid), '/T', ...(force ? ['/F'] : [])], {
          windowsHide: true,
          stdio: 'ignore',
          detached: true,
        }).unref?.()
      } else {
        child.kill()
      }
    } catch {
      /* 进程可能已经退出 */
    }
  }

  function start(service) {
    const entry = ensure(service)
    if (entry.status === 'running') return publicEntry(entry)
    if (!service.command) throw new Error('服务未配置启动命令')
    if (service.cwd && !fs.existsSync(service.cwd)) throw new Error(`目录不存在：${service.cwd}`)

    entry.lines = []
    entry.seq = 0
    entry.status = 'starting'
    entry.exitCode = null
    entry.startedAt = Date.now()
    push(entry, 'sys', `$ ${service.command}`)

    const child = spawnFn(service.command, {
      cwd: service.cwd || undefined,
      shell: true,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    entry.child = child
    entry.pid = child.pid || 0

    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on('data', (chunk) => push(entry, 'out', chunk))
    child.stderr?.on('data', (chunk) => push(entry, 'err', chunk))

    child.once('spawn', () => {
      entry.status = 'running'
      push(entry, 'sys', `进程已启动（PID ${entry.pid}）`)
      onChange(publicEntry(entry))
    })
    child.once('error', (err) => {
      entry.status = 'error'
      entry.child = null
      push(entry, 'err', err.code === 'ENOENT' ? '未找到命令，请检查 PATH 或填写完整路径' : err.message)
      onChange(publicEntry(entry))
    })
    child.once('exit', (code, signal) => {
      entry.status = 'exited'
      entry.child = null
      entry.exitCode = typeof code === 'number' ? code : null
      push(entry, 'sys', `进程已退出${signal ? `（${signal}）` : `，退出码 ${code}`}`)
      onChange(publicEntry(entry))
    })

    onChange(publicEntry(entry))
    return publicEntry(entry)
  }

  async function stop(service) {
    const entry = entries.get(service.id)
    if (!entry || !entry.child) {
      if (entry) {
        entry.status = 'idle'
        entry.pid = 0
      }
      return publicEntry(entry || ensure(service))
    }
    push(entry, 'sys', '正在停止…')
    stopEntry(entry)
    return publicEntry(entry)
  }

  function remove(serviceId) {
    const entry = entries.get(serviceId)
    if (entry?.child) stopEntry(entry)
    entries.delete(serviceId)
  }

  function sync(services) {
    const alive = new Set(services.map((item) => item.id))
    for (const id of [...entries.keys()]) {
      if (!alive.has(id)) remove(id)
    }
    for (const service of services) ensure(service)
  }

  function publicEntry(entry) {
    if (!entry) return null
    return {
      id: entry.service.id,
      name: entry.service.name,
      port: entry.service.port || 0,
      status: entry.status,
      pid: entry.pid,
      startedAt: entry.startedAt,
      exitCode: entry.exitCode,
      lastLine: entry.lines.length ? entry.lines[entry.lines.length - 1].text : '',
    }
  }

  function list(services) {
    return services.map((service) => publicEntry(ensure(service)))
  }

  // since 为上次拿到的行号，只回传增量日志
  function logs(serviceId, since = 0) {
    const entry = entries.get(serviceId)
    if (!entry) return { lines: [], seq: 0, state: null }
    const from = Number.isFinite(Number(since)) ? Number(since) : 0
    const lines = from > 0 ? entry.lines.filter((line) => line.n > from) : entry.lines.slice(-120)
    return { lines, seq: entry.seq, state: publicEntry(entry) }
  }

  function stopAll() {
    for (const entry of entries.values()) {
      if (entry.child) stopEntry(entry)
    }
  }

  return { start, stop, remove, sync, list, logs, stopAll, publicEntry }
}
