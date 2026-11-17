import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createActionRunner } from '../server/actions.js'

function fakeSpawn(outcome = 'spawn') {
  const calls = []
  const spawnFn = (cmd, args, options) => {
    calls.push({ cmd, args, options })
    const child = new EventEmitter()
    child.unref = () => {}
    process.nextTick(() => {
      if (outcome === 'error') {
        const err = new Error('spawn ENOENT')
        err.code = 'ENOENT'
        child.emit('error', err)
      } else if (outcome === 'spawn') {
        child.emit('spawn')
      }
    })
    return child
  }
  spawnFn.calls = calls
  return spawnFn
}

function fakeExitSpawn(code = 0) {
  const calls = []
  const spawnFn = (cmd, args, options) => {
    calls.push({ cmd, args, options })
    const child = new EventEmitter()
    child.unref = () => {}
    process.nextTick(() => {
      child.emit('spawn')
      process.nextTick(() => child.emit('exit', code))
    })
    return child
  }
  spawnFn.calls = calls
  return spawnFn
}

test('应用动作以真实 spawn 事件为成功依据', async () => {
  const spawnFn = fakeSpawn()
  const run = createActionRunner({ spawnFn })

  await run({ kind: 'app', label: '记事本', target: 'notepad.exe', args: ['a.txt'] })

  assert.equal(spawnFn.calls.length, 1)
  assert.equal(spawnFn.calls[0].cmd, 'notepad.exe')
  assert.deepEqual(spawnFn.calls[0].args, ['a.txt'])
  assert.equal(spawnFn.calls[0].options.shell, false)
})

test('PATH 命令通过 shell 解析', async () => {
  const spawnFn = fakeSpawn()
  const run = createActionRunner({ spawnFn })

  await run({ kind: 'app', label: 'VS Code', target: 'code', args: [] })

  assert.equal(spawnFn.calls[0].options.shell, true)
})

test('网址动作交给系统默认浏览器', async () => {
  const spawnFn = fakeSpawn()
  const run = createActionRunner({ spawnFn })

  await run({ kind: 'url', label: '官网', target: 'https://example.com' })

  assert.deepEqual(spawnFn.calls[0].args, ['/c', 'start', '', 'https://example.com'])
})

test('非法网址不会启动进程', async () => {
  const spawnFn = fakeSpawn()
  const run = createActionRunner({ spawnFn })

  await assert.rejects(() => run({ kind: 'url', target: 'javascript:alert(1)' }), /http/)
  assert.equal(spawnFn.calls.length, 0)
})

test('程序不存在时返回可读错误', async () => {
  const run = createActionRunner({ spawnFn: fakeSpawn('error') })

  await assert.rejects(() => run({ kind: 'app', target: 'nope.exe', args: [] }), /未找到目标程序/)
})

test('启动超时返回明确错误', async () => {
  const spawnFn = () => {
    const child = new EventEmitter()
    child.unref = () => {}
    return child
  }
  const run = createActionRunner({ spawnFn, timeoutMs: 20 })

  await assert.rejects(() => run({ kind: 'lock' }), /启动超时/)
})

test('熄屏动作等待 PowerShell 执行完成', async () => {
  const spawnFn = fakeExitSpawn()
  const run = createActionRunner({ spawnFn })

  await run({ kind: 'monitor-off', label: '熄屏' })

  assert.equal(spawnFn.calls.length, 1)
  assert.equal(spawnFn.calls[0].cmd, 'powershell.exe')
  assert.ok(spawnFn.calls[0].args.includes('-Command'))
})

test('熄屏指令失败时返回错误', async () => {
  const run = createActionRunner({ spawnFn: fakeExitSpawn(1) })

  await assert.rejects(() => run({ kind: 'monitor-off', label: '熄屏' }), /熄灭显示器失败/)
})
