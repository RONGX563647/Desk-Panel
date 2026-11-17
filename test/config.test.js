import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findAction, loadConfig, publicActions, saveConfig } from '../server/config.js'

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-panel-'))
  return { dir, file: path.join(dir, 'config.json') }
}

function configWith(actions) {
  return { version: 1, actions }
}

test('未知或已停用的动作 ID 不会命中', () => {
  const config = configWith([
    { id: 'a', kind: 'app', label: 'A', icon: 'terminal', target: 'a.exe', enabled: true },
    { id: 'b', kind: 'app', label: 'B', icon: 'terminal', target: 'b.exe', enabled: false },
  ])

  assert.equal(findAction(config, 'missing'), null)
  assert.equal(findAction(config, 'b'), null)
  assert.equal(findAction(config, 'a')?.label, 'A')
})

test('手机端动作列表只包含启用的动作且不暴露目标', () => {
  const config = configWith([
    { id: 'a', kind: 'app', label: 'A', icon: 'terminal', target: 'a.exe', args: ['-x'], enabled: true },
    { id: 'b', kind: 'url', label: 'B', icon: 'globe', target: 'https://example.com', enabled: false },
  ])

  const actions = publicActions(config)
  assert.equal(actions.length, 1)
  assert.deepEqual(actions[0], { id: 'a', kind: 'app', label: 'A', icon: 'terminal' })
})

test('保存后重新读取配置保持一致', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(
    file,
    configWith([
      { id: 'term', kind: 'app', label: '终端', icon: 'terminal', target: 'wt.exe', args: [], enabled: true },
    ])
  )

  assert.equal(saved.actions.length, 1)
  assert.deepEqual(loadConfig(file), saved)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('严格保存时拒绝非法网址与空目标', () => {
  const { dir, file } = tempFile()

  assert.throws(
    () => saveConfig(file, configWith([{ kind: 'url', label: '坏网址', target: 'javascript:alert(1)' }])),
    /网址/
  )
  assert.throws(
    () => saveConfig(file, configWith([{ kind: 'app', label: '空应用', target: '   ' }])),
    /启动目标/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('熄屏动作无需目标且可正常保存', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(
    file,
    configWith([
      { id: 'off', kind: 'monitor-off', label: '熄屏', icon: 'monitor', target: 'ignored', args: ['x'], enabled: true },
    ])
  )

  assert.equal(saved.actions[0].kind, 'monitor-off')
  assert.equal(saved.actions[0].target, '')
  assert.deepEqual(saved.actions[0].args, [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('配置文件损坏时回退默认动作并保留备份', () => {
  const { dir, file } = tempFile()
  fs.writeFileSync(file, '{ not json', 'utf8')
  const warnings = []

  const config = loadConfig(file, { warn: (message) => warnings.push(message) })

  assert.equal(config.actions.length, 6)
  assert.ok(warnings.length > 0)
  assert.ok(fs.existsSync(`${file}.bak`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('缺少配置文件时自动生成默认配置', () => {
  const { dir, file } = tempFile()
  const config = loadConfig(file)

  assert.equal(config.actions.length, 6)
  assert.equal(config.layout.pages.length, 1)
  assert.ok(config.layout.pages[0].components.includes('shortcuts'))
  assert.ok(fs.existsSync(file))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('严格保存时校验页面布局', () => {
  const { dir, file } = tempFile()
  const base = { version: 2, actions: [] }

  assert.throws(
    () => saveConfig(file, { ...base, layout: { pages: [] } }),
    /布局缺少页面/
  )
  assert.throws(
    () => saveConfig(file, { ...base, layout: { pages: [{ name: '空页', components: [] }] } }),
    /至少需要一个组件/
  )
  assert.throws(
    () =>
      saveConfig(file, {
        ...base,
        layout: { pages: [{ name: '非法', components: ['cpu', 'unknown'] }] },
      }),
    /未知组件/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('新增资源卡片可在布局中使用', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(file, {
    version: 2,
    actions: [],
    layout: {
      pages: [{ name: '监控', components: ['system', 'temp', 'processes', 'latency', 'power'] }],
    },
  })

  assert.deepEqual(saved.layout.pages[0].components, ['system', 'temp', 'processes', 'latency', 'power'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('布局页面数量限制为 5 个', () => {
  const { dir, file } = tempFile()
  const page = { name: '页', components: ['clock'] }
  const pages = Array.from({ length: 6 }, () => ({ ...page }))

  assert.throws(
    () => saveConfig(file, { version: 2, actions: [], layout: { pages } }),
    /最多只能有 5 个页面/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})
