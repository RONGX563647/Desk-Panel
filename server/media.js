import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const INFO_SCRIPT = path.join(__dirname, 'media.ps1')
const CONTROL_SCRIPT = path.join(__dirname, 'media-control.ps1')
const HELPER_SOURCE = path.join(__dirname, 'media-keys.cs')
const HELPER_EXE = path.join(ROOT, 'data', 'media-keys.exe')
const CSC = path.join(
  process.env.WINDIR || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
  'csc.exe'
)

let helperPromise = null

// 首次使用时编译一次原生按键工具，避免每条指令都等待 PowerShell 的 Add-Type 编译
function ensureHelper() {
  if (helperPromise) return helperPromise
  helperPromise = new Promise((resolve) => {
    try {
      if (
        fs.existsSync(HELPER_EXE) &&
        fs.statSync(HELPER_EXE).mtimeMs >= fs.statSync(HELPER_SOURCE).mtimeMs
      ) {
        resolve(HELPER_EXE)
        return
      }
      if (!fs.existsSync(CSC)) {
        resolve(null)
        return
      }
      fs.mkdirSync(path.dirname(HELPER_EXE), { recursive: true })
      const child = spawn(
        CSC,
        ['/nologo', '/target:exe', `/out:${HELPER_EXE}`, HELPER_SOURCE],
        { windowsHide: true, stdio: 'ignore' }
      )
      child.once('exit', (code) =>
        resolve(code === 0 && fs.existsSync(HELPER_EXE) ? HELPER_EXE : null)
      )
      child.once('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
  return helperPromise
}

export const MEDIA_COMMANDS = ['playpause', 'next', 'prev', 'volume_up', 'volume_down', 'mute']

const EMPTY_STATE = {
  available: false,
  title: '',
  artist: '',
  album: '',
  status: 'closed',
  source: '',
  position: 0,
  duration: 0,
}

export function createMediaWatcher({ onUpdate = () => {}, logger } = {}) {
  let child = null
  let state = { ...EMPTY_STATE }
  let buffer = ''
  let lastSerialized = ''

  function handleLine(line) {
    if (!line.trim()) return
    try {
      const next = JSON.parse(line)
      state = {
        available: !!next.available,
        title: typeof next.title === 'string' ? next.title : '',
        artist: typeof next.artist === 'string' ? next.artist : '',
        album: typeof next.album === 'string' ? next.album : '',
        status: typeof next.status === 'string' ? next.status : 'closed',
        source: typeof next.source === 'string' ? next.source : '',
        position: Number.isFinite(next.position) ? Math.max(0, Math.round(next.position)) : 0,
        duration: Number.isFinite(next.duration) ? Math.max(0, Math.round(next.duration)) : 0,
      }
      // 只有状态真正变化时才推送，避免每 2 秒重复占用带宽
      const serialized = JSON.stringify(state)
      if (serialized === lastSerialized) return
      lastSerialized = serialized
      onUpdate(state)
    } catch {
      /* 忽略脚本输出的非 JSON 行 */
    }
  }

  function start() {
    if (child) return
    try {
      child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          INFO_SCRIPT,
          '-ParentPid',
          String(process.pid),
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      )
    } catch (err) {
      logger?.warn(`媒体信息进程启动失败：${err.message}`)
      return
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) handleLine(line)
    })
    child.on('error', (err) => {
      logger?.warn(`媒体信息进程异常：${err.message}`)
      child = null
    })
    child.on('exit', () => {
      child = null
      if (state.available) {
        state = { ...EMPTY_STATE }
        lastSerialized = JSON.stringify(state)
        onUpdate(state)
      }
    })
  }

  function stop() {
    if (!child) return
    const target = child
    child = null
    buffer = ''
    try {
      target.kill()
    } catch {
      /* 忽略退出失败 */
    }
    state = { ...EMPTY_STATE }
    lastSerialized = ''
  }

  return { start, stop, getState: () => state }
}

export async function controlMedia(
  command,
  { spawnFn = spawn, timeoutMs = 12000, helperPath } = {}
) {
  if (!MEDIA_COMMANDS.includes(command)) throw new Error('不支持的媒体指令')

  const helper = helperPath === undefined ? await ensureHelper() : helperPath
  const executable = helper || 'powershell.exe'
  const args = helper
    ? [command]
    : [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CONTROL_SCRIPT,
        '-Command',
        command,
      ]
  const limit = helper ? Math.min(timeoutMs, 5000) : timeoutMs

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnFn(executable, args, { windowsHide: true, stdio: 'ignore' })
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
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('媒体指令执行超时')), limit)

    child.once('exit', (code) => {
      finish(code === 0 ? null : new Error('媒体指令执行失败'))
    })
    child.once('error', (err) => finish(err))
  })
}
