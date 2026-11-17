import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 1024 * 1024

export function createLogger(file) {
  let dirReady = false

  function rotate() {
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`)
    } catch {
      /* 文件不存在时无需轮转 */
    }
  }

  function write(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${message}`
    if (level === 'error') console.error(line)
    else console.log(line)

    if (!file) return
    try {
      if (!dirReady) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        dirReady = true
      }
      rotate()
      fs.appendFileSync(file, `${line}\n`)
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }

  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  }
}
