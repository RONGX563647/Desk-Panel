import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { controlMedia, MEDIA_COMMANDS } from '../server/media.js'

function fakeChild(code) {
  const child = new EventEmitter()
  child.kill = () => {}
  process.nextTick(() => child.emit('exit', code))
  return child
}

test('媒体指令白名单固定', () => {
  assert.deepEqual(MEDIA_COMMANDS, ['playpause', 'next', 'prev', 'volume_up', 'volume_down', 'mute'])
})

test('未知媒体指令不会启动进程', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      controlMedia('shutdown', {
        spawnFn: () => {
          calls += 1
          return fakeChild(0)
        },
      }),
    /不支持/
  )
  assert.equal(calls, 0)
})

test('媒体指令成功以退出码 0 为准（PowerShell 回退）', async () => {
  let args = []
  await controlMedia('playpause', {
    helperPath: null,
    spawnFn: (cmd, spawnArgs) => {
      args = [cmd, ...spawnArgs]
      return fakeChild(0)
    },
  })
  assert.ok(args.includes('playpause'))
  assert.ok(args.some((item) => item.endsWith('media-control.ps1')))
})

test('存在原生工具时直接调用，避免 PowerShell 启动开销', async () => {
  let args = []
  await controlMedia('next', {
    helperPath: 'C:\\fake\\media-keys.exe',
    spawnFn: (cmd, spawnArgs) => {
      args = [cmd, ...spawnArgs]
      return fakeChild(0)
    },
  })
  assert.deepEqual(args, ['C:\\fake\\media-keys.exe', 'next'])
})

test('媒体指令失败时返回错误', async () => {
  await assert.rejects(
    () => controlMedia('mute', { helperPath: null, spawnFn: () => fakeChild(1) }),
    /媒体指令执行失败/
  )
})
