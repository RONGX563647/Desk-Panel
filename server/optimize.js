import { execFile, spawn } from 'node:child_process'

const PRIORITY_LEVELS = {
  idle: 'Idle',
  below: 'BelowNormal',
  normal: 'Normal',
}

// 这些进程要么是系统关键进程，要么被强行整理后会导致桌面/登录会话异常
const PROTECTED_PROCESSES = [
  'system',
  'idle',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'smss',
  'registry',
  'memory compression',
  'secure system',
  'dwm',
  'explorer',
  'svchost',
  'taskhostw',
  'sihost',
  'fontdrvhost',
]

const PROTECTED_PS_ARRAY = PROTECTED_PROCESSES.map((name) => `'${name}'`).join(',')

export function isProtectedProcess(name) {
  return PROTECTED_PROCESSES.includes(String(name || '').toLowerCase())
}

export function isProtectedPid(pid) {
  return Number(pid) === process.pid
}

function cleanPowerShellError(text) {
  const lines = String(text || '')
    .replace(/^#< CLIXML[\s\S]*$/m, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (
    lines.find(
      (line) => !/^(所在位置|At line|\+|CategoryInfo|FullyQualifiedErrorId|Exception)/i.test(line)
    ) ||
    lines[0] ||
    'PowerShell 执行失败'
  )
}

function runPowerShell(script, timeout = 12000) {
  const encoded = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${script}`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-Command', encoded],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(cleanPowerShellError(stderr || err.message)))
          return
        }
        resolve(String(stdout || '').trim())
      }
    )
  })
}

function parsePid(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647) {
    throw new Error('进程 ID 不合法')
  }
  return value
}

function parseOutput(output) {
  if (!output) throw new Error('操作未返回结果')
  try {
    return JSON.parse(output)
  } catch {
    throw new Error('操作返回了无法解析的结果')
  }
}

function trimProcess(pid) {
  if (isProtectedPid(pid)) throw new Error('不允许操作 Desk Panel 服务自身')

  const script = `
$ErrorActionPreference = 'Stop'
try { $target = Get-Process -Id ${pid} -ErrorAction Stop } catch { throw '进程不存在或已退出' }
if (@(${PROTECTED_PS_ARRAY}) -contains $target.ProcessName.ToLower()) {
  throw "不允许操作系统关键进程：$($target.ProcessName)"
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DeskPanelNative
{
    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
$before = $target.WorkingSet64
# PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION
$handle = [DeskPanelNative]::OpenProcess(0x0500, $false, ${pid})
if ($handle -eq [IntPtr]::Zero) {
  throw '无法打开进程，可能需要管理员权限'
}
try {
  if (-not [DeskPanelNative]::EmptyWorkingSet($handle)) {
    throw "整理失败（错误码 $([Runtime.InteropServices.Marshal]::GetLastWin32Error())）"
  }
} finally {
  [void][DeskPanelNative]::CloseHandle($handle)
}
Start-Sleep -Milliseconds 250
$after = (Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64
@{ ok = $true; before = $before; after = $after } | ConvertTo-Json -Compress
`

  return runPowerShell(script).then((output) => {
    const data = parseOutput(output)
    const before = Number(data.before) || 0
    const after = Number(data.after) || 0
    return { before, after, freed: Math.max(0, before - after) }
  })
}

function setPriority(pid, level) {
  if (isProtectedPid(pid)) throw new Error('不允许操作 Desk Panel 服务自身')
  const priority = PRIORITY_LEVELS[level]
  if (!priority) throw new Error('优先级不合法')

  const script = `
$ErrorActionPreference = 'Stop'
try { $target = Get-Process -Id ${pid} -ErrorAction Stop } catch { throw '进程不存在或已退出' }
if (@(${PROTECTED_PS_ARRAY}) -contains $target.ProcessName.ToLower()) {
  throw "不允许操作系统关键进程：$($target.ProcessName)"
}
$before = $target.PriorityClass.ToString()
try { $target.PriorityClass = '${priority}' } catch { throw '无法修改优先级，可能需要管理员权限' }
$after = (Get-Process -Id ${pid} -ErrorAction Stop).PriorityClass.ToString()
@{ ok = $true; before = $before; after = $after } | ConvertTo-Json -Compress
`

  return runPowerShell(script).then((output) => {
    const data = parseOutput(output)
    return { before: data.before, after: data.after }
  })
}

function openTaskManager() {
  return new Promise((resolve, reject) => {
    const child = spawn('taskmgr.exe', [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('spawn', () => {
      try {
        child.unref()
      } catch {
        /* 忽略 unref 失败 */
      }
      resolve({})
    })
    child.once('error', (err) => {
      reject(new Error(err.code === 'ENOENT' ? '未找到任务管理器' : err.message))
    })
  })
}

export function createOptimizer() {
  async function run({ action, pid, level } = {}) {
    if (action === 'open-task-manager') {
      await openTaskManager()
      return { action }
    }

    if (action === 'trim-process') {
      const target = parsePid(pid)
      const result = await trimProcess(target)
      return { action, pid: target, ...result }
    }

    if (action === 'set-priority') {
      const target = parsePid(pid)
      const result = await setPriority(target, level)
      return { action, pid: target, ...result }
    }

    throw new Error('不支持的优化动作')
  }

  return { run }
}
