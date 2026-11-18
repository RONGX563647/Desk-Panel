import net from 'node:net'
import { execFile } from 'node:child_process'
import { isProtectedPid, isProtectedProcess } from './optimize.js'

// 面板自身端口，绝不能出现在可结束列表里
const PANEL_PORT = Number(process.env.PORT || 8787)
const FAN_PORT = 8085

// 系统与基础设施端口，不可结束
const BLOCKED_PORTS = new Set([
  135, 139, 445, 504, 623, 3389, 5353, 5355, 7680, 8085,
])

// 常见本地开发端口：命中即视为开发服务
const DEV_PORTS = new Set([
  1234, 1313, 1420, 24678, 3000, 3001, 3002, 3333, 35729, 4000, 4173, 4200, 4321,
  5000, 5001, 5173, 5174, 5175, 5176, 5500, 5555, 6006, 7000, 7001, 7860, 8000,
  8001, 8008, 8020, 8080, 8081, 8082, 8088, 8090, 8888, 9000, 9001, 9080, 9229,
])

const DEV_PROCESS_NAMES = new Set([
  'node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'pythonw', 'ruby', 'php',
  'php-cgi', 'java', 'javaw', 'dotnet', 'go', 'cargo', 'vite', 'webpack', 'next',
  'nuxt', 'ng', 'npx', 'pnpm', 'yarn',
])

const DEV_CMD_HINTS =
  /vite|webpack|next|nuxt|rollup|esbuild|parcel|snowpack|turbo|\bng serve\b|vue-cli|http\.server|uvicorn|flask|django|gunicorn|spring-boot|dotnet run|npm run|pnpm|yarn/i

const FRAMEWORKS = [
  { test: /vite/i, label: 'Vite', icon: 'vite' },
  { test: /next/i, label: 'Next.js', icon: 'next' },
  { test: /nuxt/i, label: 'Nuxt', icon: 'nuxt' },
  { test: /angular|ng serve/i, label: 'Angular', icon: 'angular' },
  { test: /webpack/i, label: 'Webpack', icon: 'webpack' },
  { test: /rollup/i, label: 'Rollup', icon: 'rollup' },
  { test: /esbuild/i, label: 'esbuild', icon: 'esbuild' },
  { test: /http\.server/i, label: 'http.server', icon: 'python' },
  { test: /uvicorn|flask|django|gunicorn/i, label: 'Python', icon: 'python' },
  { test: /spring-boot/i, label: 'Spring', icon: 'java' },
]

const SCAN_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$conns = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
$procs = @{}
foreach ($item in Get-Process -ErrorAction SilentlyContinue) { $procs[[int]$item.Id] = $item }
$cmds = @{}
foreach ($item in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
  $cmds[[int]$item.ProcessId] = [string]$item.CommandLine
}
$seen = @{}
$out = @()
foreach ($conn in $conns) {
  $port = [int]$conn.LocalPort
  if ($seen.ContainsKey($port)) { continue }
  $seen[$port] = $true
  $owner = [int]$conn.OwningProcess
  $proc = $procs[$owner]
  $line = ''
  if ($cmds.ContainsKey($owner)) { $line = $cmds[$owner] }
  $out += [pscustomobject]@{
    port = $port
    address = [string]$conn.LocalAddress
    pid = $owner
    name = $(if ($proc) { [string]$proc.ProcessName } else { '' })
    mem = $(if ($proc) { [double]$proc.WorkingSet64 } else { 0 })
    cmd = $line
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`

function runPowerShell(script, timeout = 15000) {
  const encoded = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${script}`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-Command', encoded],
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message).trim().split(/\r?\n/)[0] || '端口扫描失败'))
          return
        }
        resolve(String(stdout || '').trim())
      }
    )
  })
}

function canConnect(port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

// 健康判定：端口可连 + HTTP 状态码 < 500 才算健康
export async function probePort(port) {
  const started = Date.now()
  if (!(await canConnect(port))) {
    return { status: 'closed', statusCode: null, latency: Date.now() - started }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
      redirect: 'manual',
    })
    const latency = Date.now() - started
    try {
      await res.text()
    } catch {
      /* 读不完响应体不影响健康判定 */
    }
    return {
      status: res.status < 500 ? 'healthy' : 'error',
      statusCode: res.status,
      latency,
    }
  } catch {
    // 端口通但不是 HTTP 服务（如 HMR、gRPC）
    return { status: 'open', statusCode: null, latency: Date.now() - started }
  }
}

function describe(entry) {
  const cmd = entry.cmd || ''
  const framework = FRAMEWORKS.find((item) => item.test.test(cmd))
  const label = framework ? framework.label : entry.name || `端口 ${entry.port}`
  return { label, icon: framework?.icon || 'unknown' }
}

function isDevCandidate(entry) {
  if (entry.port === PANEL_PORT) return false
  if (entry.port <= 1024) return false
  if (BLOCKED_PORTS.has(entry.port)) return false
  if (DEV_PORTS.has(entry.port)) return true
  if (DEV_PROCESS_NAMES.has(String(entry.name || '').toLowerCase())) return true
  return DEV_CMD_HINTS.test(entry.cmd || '')
}

// allowLan: 监听在 0.0.0.0 / :: 的服务才可被局域网访问
function isLanReachable(address) {
  return address === '0.0.0.0' || address === '::' || address === '[::]'
}

export async function scanDevPorts() {
  const raw = await runPowerShell(SCAN_SCRIPT)
  if (!raw) return []
  let list
  try {
    list = JSON.parse(raw)
  } catch {
    throw new Error('端口扫描结果无法解析')
  }
  if (!Array.isArray(list)) list = [list]

  const items = list
    .filter((item) => Number.isInteger(item?.port))
    .filter(isDevCandidate)
    .map((item) => {
      const { label, icon } = describe(item)
      return {
        port: item.port,
        pid: Number(item.pid) || 0,
        name: item.name || '',
        label,
        icon,
        mem: Number(item.mem) || 0,
        lan: isLanReachable(item.address),
        cmd: String(item.cmd || '').slice(0, 300),
        protected: isProtectedProcess(item.name) || isProtectedPid(Number(item.pid)),
      }
    })

  const probed = await Promise.all(
    items.map(async (item) => {
      const health = await probePort(item.port)
      return { ...item, ...health }
    })
  )
  return probed.sort((a, b) => a.port - b.port)
}

// 只查询单个端口，用于「在电脑浏览器打开」前的归属校验
function portInfoScript(port) {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$conn = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { write-output '{}' } else {
  $owner = [int]$conn.OwningProcess
  $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
  $line = ''
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
  if ($cim) { $line = [string]$cim.CommandLine }
  ConvertTo-Json -Compress -Depth 3 -InputObject @{
    port = [int]$conn.LocalPort
    address = [string]$conn.LocalAddress
    pid = $owner
    name = $(if ($proc) { [string]$proc.ProcessName } else { '' })
    cmd = $line
  }
}
`
}

// 在电脑本机唤起默认浏览器打开开发端口：
// 平板/手机访问面板时点「电脑」也能在电脑上打开，而不会在平板里打开 127.0.0.1
export async function openDevPort({ port }) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('端口号不合法')
  if (value === PANEL_PORT) throw new Error('不允许打开面板自身端口')
  if (BLOCKED_PORTS.has(value)) throw new Error('不允许打开系统端口')

  const raw = await runPowerShell(portInfoScript(value))
  let target = null
  try {
    const parsed = JSON.parse(raw)
    target = parsed && Number.isInteger(Number(parsed.port)) ? parsed : null
  } catch {
    target = null
  }
  if (!target) throw new Error(`端口 ${value} 当前没有在监听`)
  if (!isDevCandidate({ port: value, name: target.name, cmd: target.cmd })) {
    throw new Error(`端口 ${value} 不是可识别的开发服务`)
  }

  const url = `http://127.0.0.1:${value}/`
  await new Promise((resolve, reject) => {
    execFile(
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', url],
      { windowsHide: true, timeout: 8000 },
      (err) => {
        if (err) reject(new Error('无法唤起电脑浏览器'))
        else resolve()
      }
    )
  })
  return { port: value, url }
}

function killProcess(pid, tree) {
  const args = ['/PID', String(pid), '/F']
  if (tree) args.push('/T')
  return new Promise((resolve, reject) => {
    execFile('taskkill', args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || err.message).trim().split(/\r?\n/)[0] || '结束进程失败'))
        return
      }
      resolve(String(stdout || '').trim())
    })
  })
}

// 只允许结束当前确实占用监听端口的进程，避免被当成任意 PID 杀手
export async function stopDevProcess({ pid, tree = false }) {
  const value = Number(pid)
  if (!Number.isInteger(value) || value <= 0) throw new Error('进程 ID 不合法')
  if (isProtectedPid(value)) throw new Error('不允许操作 Desk Panel 服务自身')
  if (value === process.pid) throw new Error('不允许结束面板进程')

  const raw = await runPowerShell(SCAN_SCRIPT)
  let list = []
  try {
    list = JSON.parse(raw)
  } catch {
    list = []
  }
  if (!Array.isArray(list)) list = [list]

  const target = list.find((item) => Number(item?.pid) === value)
  if (!target) throw new Error('该进程当前没有占用监听端口')
  if (isProtectedProcess(target.name)) throw new Error(`不允许结束系统进程：${target.name}`)
  if (Number(target.port) === PANEL_PORT) throw new Error('不允许结束面板自身端口')

  await killProcess(value, tree === true)
  return { pid: value, name: target.name || '', port: Number(target.port) }
}
