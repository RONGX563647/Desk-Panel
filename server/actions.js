import { spawn } from 'node:child_process'

const SHELL_TARGET = /\.(exe|com)$/i

// 通过 WM_SYSCOMMAND / SC_MONITORPOWER 关闭显示器
const MONITOR_OFF_SCRIPT =
  'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class DeskPanelDisplay{[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr hWnd,uint Msg,IntPtr wParam,IntPtr lParam);}\'; [void][DeskPanelDisplay]::SendMessage([IntPtr]0xffff,0x0112,[IntPtr]0xF170,[IntPtr]2)'

export function createActionRunner({ spawnFn = spawn, timeoutMs = 5000 } = {}) {
  function launch(action) {
    if (action.kind === 'monitor-off') {
      const child = spawnFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', MONITOR_OFF_SCRIPT],
        { windowsHide: true, stdio: 'ignore' }
      )
      // 熄屏指令需要等 PowerShell 执行完才有结果
      child.waitExit = true
      return child
    }

    if (action.kind === 'lock') {
      return spawnFn('rundll32.exe', ['user32.dll,LockWorkStation'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
    }

    if (action.kind === 'url') {
      const url = String(action.target || '').trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('网址必须以 http:// 或 https:// 开头')
      return spawnFn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
    }

    const target = String(action.target || '').trim()
    if (!target) throw new Error('动作未配置启动目标')
    const args = Array.isArray(action.args) ? action.args.map(String) : []
    // 带扩展名的可执行文件直接启动；code 这类 PATH 命令需要经过 shell 解析
    return spawnFn(target, args, {
      detached: true,
      stdio: 'ignore',
      shell: !SHELL_TARGET.test(target),
    })
  }

  return function runAction(action) {
    if (!action) return Promise.reject(new Error('动作不存在或已停用'))

    let child
    try {
      child = launch(action)
    } catch (err) {
      return Promise.reject(err)
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) {
          reject(err)
          return
        }
        try {
          child.unref()
        } catch {
          /* 忽略 unref 失败 */
        }
        resolve()
      }
      const timer = setTimeout(
        () => finish(new Error(child.waitExit ? '熄屏指令执行超时' : '启动超时，请检查目标程序')),
        timeoutMs
      )

      child.once('spawn', () => {
        if (!child.waitExit) finish()
      })
      if (child.waitExit) {
        child.once('exit', (code) => finish(code === 0 ? null : new Error('熄灭显示器失败')))
      }
      child.once('error', (err) =>
        finish(err.code === 'ENOENT' ? new Error('未找到目标程序，请检查安装路径或命令是否可用') : err)
      )
    })
  }
}
