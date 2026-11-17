import test from 'node:test'
import assert from 'node:assert/strict'
import { createSampler } from '../server/sampler.js'

test('首次采样没有 CPU 基准时返回 null，避免误报 0%', () => {
  const sampler = createSampler()
  const frame = sampler.sample()

  assert.equal(frame.cpu, null)
  assert.ok(frame.cores.length > 0)
  assert.ok(frame.cores.every((core) => core === null))
})

test('reset 后重新建立采样基准', () => {
  const sampler = createSampler()
  sampler.sample()
  sampler.reset()

  assert.equal(sampler.sample().cpu, null)
})

test('采样帧包含前端所需字段', () => {
  const frame = createSampler().sample()

  for (const key of [
    'ts',
    'cpu',
    'cores',
    'memUsed',
    'memTotal',
    'disk',
    'rx',
    'tx',
    'uptime',
    'temp',
    'processes',
    'processCount',
    'latency',
    'power',
  ]) {
    assert.ok(key in frame, `缺少字段 ${key}`)
  }
  assert.equal(typeof frame.ts, 'number')
  assert.ok(Array.isArray(frame.processes))
})
