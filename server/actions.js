import { spawn } from 'node:child_process'

const SHELL_TARGET = /\.(exe|com)$/i

// 通过 WM_SYSCOMMAND / SC_MONITORPOWER 关闭显示器
// 使用 PostMessage，避免 SendMessage 广播被无响应窗口阻塞导致 PowerShell 不退出
const MONITOR_OFF_SCRIPT =
  'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class DeskPanelDisplay{[DllImport("user32.dll",SetLastError=true)]public static extern bool PostMessage(IntPtr hWnd,uint Msg,IntPtr wParam,IntPtr lParam);}\'; [void][DeskPanelDisplay]::PostMessage([IntPtr]0xffff,0x0112,[IntPtr]0xF170,[IntPtr]2)'

// 通过一次 1px 的鼠标相对移动唤醒显示器，再移回原位
const MONITOR_ON_SCRIPT =
  'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class DeskPanelWake{[DllImport("user32.dll")]public static extern void mouse_event(uint dwFlags,int dx,int dy,uint dwData,UIntPtr dwExtraInfo);}\'; [DeskPanelWake]::mouse_event(0x0001,1,0,0,[UIntPtr]::Zero); [DeskPanelWake]::mouse_event(0x0001,-1,0,0,[UIntPtr]::Zero)'

export function createActionRunner({ spawnFn = spawn, timeoutMs = 5000 } = {}) {
  function launch(action) {
    if (action.kind === 'monitor-off' || action.kind === 'monitor-on') {
      const child = spawnFn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          action.kind === 'monitor-on' ? MONITOR_ON_SCRIPT : MONITOR_OFF_SCRIPT,
        ],
        { windowsHide: true, stdio: 'ignore' }
      )
      // 显示器控制需要等 PowerShell 执行完才有结果
      child.waitExit = true
      return child
    }

    if (action.kind === 'sleep') {
      // 睡眠会立即挂起系统，无法等待返回结果；以成功启动为准
      return spawnFn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
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

    // 用指定程序打开路径：explorer.exe 打开目录，code/trae 打开项目
    if (action.kind === 'open-path') {
      const target = String(action.target || '').trim()
      if (!target) throw new Error('动作未配置要打开的路径')
      const opener = Array.isArray(action.args) && action.args[0] ? String(action.args[0]).trim() : ''
      // 统一交给 cmd start 处理，路径与程序都加引号以兼容空格
      return spawnFn(
        'cmd',
        ['/c', 'start', '', `"${opener || 'explorer.exe'}"`, `"${target}"`],
        { detached: true, stdio: 'ignore', windowsHide: true }
      )
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
        () =>
          finish(
            new Error(
              child.waitExit
                ? action.kind === 'monitor-on'
                  ? '亮屏指令执行超时'
                  : '熄屏指令执行超时'
                : '启动超时，请检查目标程序'
            )
          ),
        timeoutMs
      )

      child.once('spawn', () => {
        if (!child.waitExit) finish()
      })
      if (child.waitExit) {
        child.once('exit', (code) =>
          finish(code === 0 ? null : new Error(action.kind === 'monitor-on' ? '唤醒显示器失败' : '熄灭显示器失败'))
        )
      }
      child.once('error', (err) =>
        finish(err.code === 'ENOENT' ? new Error('未找到目标程序，请检查安装路径或命令是否可用') : err)
      )
    })
  }
}
