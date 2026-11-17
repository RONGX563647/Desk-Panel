import test from 'node:test'
import assert from 'node:assert/strict'
import { packRows, wrapPage } from '../src/utils.js'

test('组件按 12 列打包并在行内自动伸展', () => {
  const rows = packRows(['clock', 'cpu', 'memory', 'network', 'shortcuts'])

  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows[1].map((item) => item.id),
    ['memory', 'network']
  )
  assert.equal(
    rows[0].reduce((sum, item) => sum + item.span, 0),
    12
  )
})

test('单独占一行的组件也能撑满整行', () => {
  const rows = packRows(['disk', 'gpu'])
  assert.deepEqual(rows, [[{ id: 'disk', span: 4 }, { id: 'gpu', span: 6 }]])
})

test('新增资源卡片按 12 列成对铺满', () => {
  const rows = packRows(['system', 'temp', 'processes', 'latency'])
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows[0].map((item) => item.id),
    ['system', 'temp']
  )
  assert.deepEqual(
    rows[1].map((item) => item.id),
    ['processes', 'latency']
  )
  assert.equal(
    rows[1].reduce((sum, item) => sum + item.span, 0),
    12
  )
})

test('页面切换支持循环', () => {
  assert.equal(wrapPage(0, -1, 2), 1)
  assert.equal(wrapPage(1, 1, 2), 0)
  assert.equal(wrapPage(0, 1, 1), 0)
  assert.equal(wrapPage(2, 1, 3), 0)
  assert.equal(wrapPage(0, -1, 3), 2)
})
