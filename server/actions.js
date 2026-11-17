import { spawn } from 'node:child_process'

const SHELL_TARGET = /\.(exe|com)$/i

export function createActionRunner({ spawnFn = spawn, timeoutMs = 5000 } = {}) {
  function launch(action) {
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
      const timer = setTimeout(() => finish(new Error('启动超时，请检查目标程序')), timeoutMs)

      child.once('spawn', () => finish())
      child.once('error', (err) =>
        finish(err.code === 'ENOENT' ? new Error('未找到目标程序，请检查安装路径或命令是否可用') : err)
      )
    })
  }
}
