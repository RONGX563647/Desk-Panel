import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findAction,
  loadConfig,
  normalizeConfig,
  publicActions,
  publicDev,
  publicSettings,
  saveConfig,
} from '../server/config.js'

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

  assert.equal(config.actions.length, 7)
  assert.ok(warnings.length > 0)
  assert.ok(fs.existsSync(`${file}.bak`))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('缺少配置文件时自动生成默认配置', () => {
  const { dir, file } = tempFile()
  const config = loadConfig(file)

  assert.equal(config.actions.length, 7)
  assert.ok(config.actions.some((action) => action.kind === 'sleep'))
  assert.equal(config.layout.pages.length, 1)
  assert.ok(config.layout.pages[0].components.includes('shortcuts'))
  assert.ok(config.layout.pages[0].components.includes('sensors'))
  assert.ok(fs.existsSync(file))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('旧版本配置升级后自动补上硬件详情卡片', () => {
  const { dir, file } = tempFile()
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 4,
      actions: [],
      layout: { pages: [{ id: 'main', name: '主页', components: ['cpu', 'power'] }] },
    }),
    'utf8'
  )

  const config = loadConfig(file)
  assert.deepEqual(config.layout.pages[0].components, ['cpu', 'power', 'sensors'])
  assert.equal(config.version, 6)
  assert.deepEqual(config.dev, { services: [] })

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.version, 6)
  assert.ok(saved.layout.pages[0].components.includes('sensors'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('开发服务配置支持增删改并校验必填项', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(file, {
    version: 6,
    actions: [],
    dev: {
      services: [{ id: 'svc_web', name: '前端', cwd: 'E:\\code\\webpanel', command: 'npm run dev', port: 5173 }],
    },
  })

  assert.deepEqual(saved.dev.services[0], {
    id: 'svc_web',
    name: '前端',
    cwd: 'E:\\code\\webpanel',
    command: 'npm run dev',
    port: 5173,
  })

  // 非严格模式（读取旧配置）只丢弃无效项，不抛错
  const loose = normalizeConfig({
    version: 6,
    actions: [],
    dev: { services: [{ id: 'ok', name: '有效', command: 'npm run dev' }, { name: '  ', command: 'npm start' }] },
  })
  assert.equal(loose.config.dev.services.length, 1)
  assert.equal(loose.config.dev.services[0].id, 'ok')

  assert.throws(
    () =>
      saveConfig(file, {
        version: 6,
        actions: [],
        dev: { services: [{ name: '缺命令', cwd: '' }] },
      }),
    /启动命令/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('公开的开发服务不下发命令与工作目录', () => {
  const dev = publicDev({
    dev: { services: [{ id: 'a', name: '前端', cwd: 'E:\\secret', command: 'npm run dev', port: 5173 }] },
  })

  assert.deepEqual(dev, { services: [{ id: 'a', name: '前端', port: 5173 }] })
})

test('打开路径动作需要目标且只保留一个打开方式', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(file, {
    version: 6,
    actions: [
      { id: 'p', kind: 'open-path', label: '项目', icon: 'folder', target: 'E:\\code\\webpanel', args: ['trae-cn.cmd', 'extra'] },
    ],
  })

  assert.deepEqual(saved.actions[0].args, ['trae-cn.cmd'])

  assert.throws(
    () => saveConfig(file, { version: 6, actions: [{ kind: 'open-path', label: '空', target: '' }] }),
    /启动目标/
  )
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

test('布局页面数量限制为 6 个', () => {
  const { dir, file } = tempFile()
  const page = { name: '页', components: ['clock'] }
  const pages = Array.from({ length: 7 }, () => ({ ...page }))

  assert.throws(
    () => saveConfig(file, { version: 2, actions: [], layout: { pages } }),
    /最多只能有 6 个页面/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('全局设置带默认值并自动限制取值范围', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(file, {
    version: 2,
    actions: [],
    settings: { metricsInterval: 1, autoRotate: 999, theme: 'light', token: 'panel_2026' },
  })

  assert.equal(saved.settings.theme, 'light')
  assert.equal(saved.settings.metricsInterval, 5)
  assert.equal(saved.settings.autoRotate, 120)
  assert.equal(saved.settings.token, 'panel_2026')
  assert.equal(saved.settings.fanUrl, 'http://127.0.0.1:8085')
  assert.deepEqual(Object.keys(saved.settings).sort(), [
    'autoRotate',
    'fanUrl',
    'metricsInterval',
    'theme',
    'token',
  ])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('风扇数据源支持自定义地址并回退非法值', () => {
  const { dir, file } = tempFile()
  const saved = saveConfig(file, {
    version: 2,
    actions: [],
    settings: { fanUrl: 'http://192.168.1.5:8085' },
  })
  assert.equal(saved.settings.fanUrl, 'http://192.168.1.5:8085')

  const fallback = saveConfig(file, {
    version: 2,
    actions: [],
    settings: { fanUrl: 'ftp://not-allowed' },
  })
  assert.equal(fallback.settings.fanUrl, 'http://127.0.0.1:8085')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('严格保存时拒绝非法访问口令', () => {
  const { dir, file } = tempFile()

  assert.throws(
    () => saveConfig(file, { version: 2, actions: [], settings: { token: '有 空格' } }),
    /口令/
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('公开设置不包含访问口令', () => {
  const settings = publicSettings({
    settings: { theme: 'light', metricsInterval: 30, autoRotate: 10, token: 'secret-token' },
  })

  assert.deepEqual(settings, { theme: 'light', metricsInterval: 30, autoRotate: 10 })
})
