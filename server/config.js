import fs from 'node:fs'
import path from 'node:path'

export const CONFIG_VERSION = 6
export const ICON_NAMES = ['terminal', 'folder', 'code', 'globe', 'lock', 'monitor', 'moon']
export const ACTION_KINDS = ['app', 'url', 'open-path', 'lock', 'monitor-off', 'sleep']
export const COMPONENT_IDS = [
  'clock',
  'cpu',
  'gpu',
  'memory',
  'disk',
  'network',
  'temp',
  'processes',
  'devices',
  'latency',
  'system',
  'power',
  'fan',
  'sensors',
  'media',
  'optimize',
  'agent',
  'shortcuts',
  'dev',
]
export const MAX_PAGES = 6

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  metricsInterval: 60,
  autoRotate: 0,
  token: '',
  fanUrl: 'http://127.0.0.1:8085',
}

export const DEFAULT_AGENT = {
  enabled: false,
  permission: 'advice',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
}

export const DEFAULT_DEV = { services: [] }

const MAX_SERVICES = 12
const MAX_SERVICE_COMMAND = 512
const MAX_SERVICE_CWD = 512

const MIN_METRICS_INTERVAL = 5
const MAX_METRICS_INTERVAL = 300
const MAX_AUTO_ROTATE = 120
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/
const FAN_URL_PATTERN = /^https?:\/\/[^\s]+$/i

export const DEFAULT_LAYOUT = {
  pages: [
    {
      id: 'main',
      name: '主页',
      components: ['clock', 'cpu', 'memory', 'disk', 'network', 'shortcuts', 'sensors'],
    },
  ],
}

export const DEFAULT_ACTIONS = [
  { id: 'terminal', kind: 'app', label: '终端', icon: 'terminal', target: 'wt.exe', args: [], enabled: true },
  { id: 'explorer', kind: 'app', label: '文件', icon: 'folder', target: 'explorer.exe', args: [], enabled: true },
  { id: 'vscode', kind: 'app', label: 'VS Code', icon: 'code', target: 'code', args: [], enabled: true },
  { id: 'browser', kind: 'url', label: '浏览器', icon: 'globe', target: 'https://github.com', args: [], enabled: true },
  { id: 'monitor-off', kind: 'monitor-off', label: '熄屏', icon: 'monitor', target: '', args: [], enabled: true },
  { id: 'sleep', kind: 'sleep', label: '睡眠', icon: 'moon', target: '', args: [], enabled: true },
  { id: 'lock', kind: 'lock', label: '锁屏', icon: 'lock', target: '', args: [], enabled: true },
]

const ID_PATTERN = /^[a-z0-9_-]{1,40}$/i
const MAX_LABEL = 24
const MAX_TARGET = 2048

export function createActionId() {
  return `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAction(raw, index, strict, errors, taken) {
  const where = `第 ${index + 1} 个动作`
  if (!isObject(raw)) {
    if (strict) errors.push(`${where}格式不正确`)
    return null
  }

  let kind = 'app'
  if (ACTION_KINDS.includes(raw.kind)) kind = raw.kind
  else if (strict) errors.push(`${where}的类型不受支持`)

  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) {
    if (strict) errors.push(`${where}缺少名称`)
  } else if (label.length > MAX_LABEL) {
    if (strict) errors.push(`${where}名称不能超过 ${MAX_LABEL} 个字符`)
  }

  const icon = ICON_NAMES.includes(raw.icon) ? raw.icon : 'terminal'

  let target = typeof raw.target === 'string' ? raw.target.trim() : ''
  if (target.length > MAX_TARGET) {
    if (strict) errors.push(`${where}目标过长`)
    target = target.slice(0, MAX_TARGET)
  }
  if (kind === 'lock' || kind === 'monitor-off' || kind === 'sleep') target = ''
  if (kind === 'url') {
    if (!/^https?:\/\//i.test(target)) {
      if (strict) errors.push(`${where}的网址必须以 http:// 或 https:// 开头`)
    }
  } else if ((kind === 'app' || kind === 'open-path') && !target) {
    if (strict) errors.push(`${where}缺少启动目标`)
  }

  let args = []
  if (raw.args != null) {
    if (!Array.isArray(raw.args)) {
      if (strict) errors.push(`${where}的参数必须是字符串数组`)
    } else {
      args = raw.args.filter((item) => typeof item === 'string' && item.length <= 512)
      if (strict && args.length !== raw.args.length) errors.push(`${where}的参数包含无效内容`)
    }
  }
  // open-path 只保留第一个参数，作为打开方式（explorer.exe / code / trae）
  if (kind === 'open-path') args = args.slice(0, 1)
  else if (kind !== 'app') args = []

  let id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!ID_PATTERN.test(id) || taken.has(id)) {
    if (strict && id && taken.has(id)) errors.push(`${where}的 ID 重复`)
    id = createActionId()
    while (taken.has(id)) id = createActionId()
  }
  taken.add(id)

  if (!label && !strict) return null

  return {
    id,
    kind,
    label: label || '未命名动作',
    icon,
    target,
    args,
    enabled: raw.enabled !== false,
  }
}

function cloneDefaultLayout() {
  return {
    pages: DEFAULT_LAYOUT.pages.map((page) => ({ ...page, components: [...page.components] })),
  }
}

function normalizeLayout(raw, strict, errors) {
  if (raw == null) return cloneDefaultLayout()
  if (!isObject(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    if (strict) errors.push('布局缺少页面')
    return cloneDefaultLayout()
  }
  if (raw.pages.length > MAX_PAGES && strict) errors.push(`最多只能有 ${MAX_PAGES} 个页面`)

  const taken = new Set()
  const pages = []
  raw.pages.slice(0, MAX_PAGES).forEach((page, index) => {
    const where = `第 ${index + 1} 个页面`
    if (!isObject(page)) {
      if (strict) errors.push(`${where}格式不正确`)
      return
    }
    const name = typeof page.name === 'string' ? page.name.trim().slice(0, 12) : ''
    if (!name && strict) errors.push(`${where}缺少名称`)

    const rawComponents = Array.isArray(page.components) ? page.components : []
    const components = rawComponents.filter((id) => COMPONENT_IDS.includes(id))
    const unique = [...new Set(components)]
    if (!unique.length) {
      if (strict) errors.push(`${where}至少需要一个组件`)
      return
    }
    if (strict && components.length !== rawComponents.length) errors.push(`${where}包含未知组件`)

    let id = typeof page.id === 'string' ? page.id.trim() : ''
    if (!ID_PATTERN.test(id) || taken.has(id)) id = `page_${Date.now().toString(36)}${pages.length}`
    taken.add(id)

    pages.push({ id, name: name || `页面 ${index + 1}`, components: unique })
  })

  if (!pages.length) {
    if (strict) errors.push('至少需要一个有效页面')
    return cloneDefaultLayout()
  }
  return { pages }
}

function normalizeSettings(raw, strict, errors) {
  const source = isObject(raw) ? raw : {}
  const theme = source.theme === 'light' ? 'light' : 'dark'

  let metricsInterval = Number(source.metricsInterval)
  if (!Number.isFinite(metricsInterval)) metricsInterval = DEFAULT_SETTINGS.metricsInterval
  metricsInterval = Math.min(
    MAX_METRICS_INTERVAL,
    Math.max(MIN_METRICS_INTERVAL, Math.round(metricsInterval))
  )

  let autoRotate = Number(source.autoRotate)
  if (!Number.isFinite(autoRotate) || autoRotate < 0) autoRotate = 0
  autoRotate = Math.min(MAX_AUTO_ROTATE, Math.round(autoRotate))

  const token = typeof source.token === 'string' ? source.token.trim() : ''
  if (token && !TOKEN_PATTERN.test(token) && strict) {
    errors.push('访问口令需为 4-64 位字母、数字、下划线或短横线')
  }

  const rawFanUrl = typeof source.fanUrl === 'string' ? source.fanUrl.trim() : ''
  const fanUrl = FAN_URL_PATTERN.test(rawFanUrl) ? rawFanUrl : DEFAULT_SETTINGS.fanUrl

  return {
    theme,
    metricsInterval,
    autoRotate,
    token: TOKEN_PATTERN.test(token) ? token : '',
    fanUrl,
  }
}

function normalizeAgent(raw, strict, errors) {
  const source = isObject(raw) ? raw : {}
  const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
  const model = typeof source.model === 'string' ? source.model.trim() : ''
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : ''
  const enabled = source.enabled === true
  const permission = source.permission === 'safe' ? 'safe' : 'advice'

  if (source.permission && !['advice', 'safe'].includes(source.permission) && strict) {
    errors.push('Agent 权限只能是 advice 或 safe')
  }

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    if (strict) errors.push('Agent 网关地址必须以 http:// 或 https:// 开头')
  }
  if (baseUrl.length > 512 && strict) errors.push('Agent 网关地址过长')
  if (model.length > 80 && strict) errors.push('Agent 模型名称过长')
  if (apiKey.length > 512 && strict) errors.push('Agent API Key 过长')

  return {
    enabled,
    permission,
    baseUrl: /^https?:\/\//i.test(baseUrl) ? baseUrl.slice(0, 512) : DEFAULT_AGENT.baseUrl,
    model: (model || DEFAULT_AGENT.model).slice(0, 80),
    apiKey: apiKey.slice(0, 512),
  }
}

export function createDefaultConfig() {
  return {
    version: CONFIG_VERSION,
    actions: cloneDefaults(),
    layout: cloneDefaultLayout(),
    settings: { ...DEFAULT_SETTINGS },
    agent: { ...DEFAULT_AGENT },
    dev: cloneDefaultDev(),
  }
}

function cloneDefaultDev() {
  return { services: [] }
}

// 开发服务：command 交给 shell 执行，cwd 为空时用面板所在目录
function normalizeDev(raw, strict, errors) {
  if (raw == null) return cloneDefaultDev()
  const source = isObject(raw) ? raw : {}
  const rawServices = Array.isArray(source.services) ? source.services : []
  if (rawServices.length > MAX_SERVICES && strict) {
    errors.push(`开发服务最多 ${MAX_SERVICES} 个`)
  }

  const taken = new Set()
  const services = []
  rawServices.slice(0, MAX_SERVICES).forEach((item, index) => {
    const where = `第 ${index + 1} 个开发服务`
    if (!isObject(item)) {
      if (strict) errors.push(`${where}格式不正确`)
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) {
      if (strict) errors.push(`${where}缺少名称`)
      return
    }
    const command = typeof item.command === 'string' ? item.command.trim() : ''
    if (!command) {
      if (strict) errors.push(`${where}缺少启动命令`)
      return
    }
    const cwd = typeof item.cwd === 'string' ? item.cwd.trim() : ''
    if (command.length > MAX_SERVICE_COMMAND && strict) errors.push(`${where}命令过长`)
    if (cwd.length > MAX_SERVICE_CWD && strict) errors.push(`${where}目录过长`)

    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!ID_PATTERN.test(id) || taken.has(id)) id = `svc_${Date.now().toString(36)}${index}`
    taken.add(id)

    const port = Number(item.port)
    services.push({
      id,
      name: name.slice(0, MAX_LABEL),
      cwd: cwd.slice(0, MAX_SERVICE_CWD),
      command: command.slice(0, MAX_SERVICE_COMMAND),
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    })
  })

  return { services }
}

export function normalizeConfig(raw, { strict = false } = {}) {
  const errors = []
  if (!isObject(raw) || !Array.isArray(raw.actions)) {
    if (strict) errors.push('配置缺少动作列表')
    return { config: createDefaultConfig(), errors }
  }

  const taken = new Set()
  const actions = []
  raw.actions.forEach((item, index) => {
    const action = normalizeAction(item, index, strict, errors, taken)
    if (action) actions.push(action)
  })

  const layout = normalizeLayout(raw.layout, strict, errors)
  const settings = normalizeSettings(raw.settings, strict, errors)
  const agent = normalizeAgent(raw.agent, strict, errors)
  const dev = normalizeDev(raw.dev, strict, errors)
  return { config: { version: CONFIG_VERSION, actions, layout, settings, agent, dev }, errors }
}

function cloneDefaults() {
  return DEFAULT_ACTIONS.map((action) => ({ ...action, args: [...action.args] }))
}

// v4 -> v5：新增硬件详情卡片；v5 -> v6：新增开发服务配置
function migrateConfig(raw) {
  if (!isObject(raw)) return raw
  const version = Number(raw.version)
  if (!Number.isFinite(version) || version >= CONFIG_VERSION) return raw
  let next = { ...raw, version: CONFIG_VERSION }
  if (version < 5) {
    const layout = raw.layout
    if (isObject(layout) && Array.isArray(layout.pages) && layout.pages.length) {
      const pages = layout.pages.map((page, index) => {
        if (index !== 0 || !isObject(page) || !Array.isArray(page.components)) return page
        if (page.components.includes('sensors')) return page
        return { ...page, components: [...page.components, 'sensors'] }
      })
      next = { ...next, layout: { ...layout, pages } }
    }
  }
  if (version < 6 && !isObject(raw.dev)) {
    next = { ...next, dev: cloneDefaultDev() }
  }
  return next
}

export function loadConfig(file, { warn = () => {} } = {}) {
  const fallback = () => {
    const config = createDefaultConfig()
    saveConfig(file, config)
    return config
  }

  if (!fs.existsSync(file)) return fallback()

  let raw
  try {
    // 外部编辑器保存时可能带 BOM，直接 JSON.parse 会失败并误回退默认配置
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    warn(`配置文件无法解析，已回退默认配置：${err.message}`)
    backup(file)
    return fallback()
  }

  if (!isObject(raw) || !Array.isArray(raw.actions)) {
    warn('配置文件结构不正确，已回退默认配置')
    backup(file)
    return fallback()
  }

  const migrated = migrateConfig(raw)
  const { config, errors } = normalizeConfig(migrated)
  for (const message of errors) warn(`配置项已忽略：${message}`)
  if (migrated !== raw) {
    try {
      saveConfig(file, config)
    } catch {
      /* 迁移写回失败时仍使用内存中的配置 */
    }
  }
  return config
}

export function saveConfig(file, raw) {
  const { config, errors } = normalizeConfig(raw, { strict: true })
  if (errors.length) {
    const error = new Error(errors[0])
    error.errors = errors
    throw error
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  backup(file)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
  return config
}

function backup(file) {
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  } catch {
    /* 备份失败不影响主流程 */
  }
}

export function publicActions(config) {
  return config.actions
    .filter((action) => action.enabled)
    .map(({ id, kind, label, icon }) => ({ id, kind, label, icon }))
}

export function findAction(config, id) {
  if (typeof id !== 'string') return null
  return config.actions.find((action) => action.id === id && action.enabled) || null
}

export function publicLayout(config) {
  return {
    pages: config.layout.pages.map(({ id, name, components }) => ({ id, name, components: [...components] })),
  }
}

// 只向面板下发可公开的设置，访问口令不下发到局域网设备
export function publicSettings(config) {
  const settings = config.settings || DEFAULT_SETTINGS
  return {
    theme: settings.theme,
    metricsInterval: settings.metricsInterval,
    autoRotate: settings.autoRotate,
  }
}

// 只下发开发服务的展示信息，启动命令与工作目录留在服务端
export function publicDev(config) {
  const dev = config.dev || DEFAULT_DEV
  return {
    services: (dev.services || []).map(({ id, name, port }) => ({ id, name, port })),
  }
}

// API Key 与网关地址只留在服务端
export function publicAgent(config) {
  const agent = config.agent || DEFAULT_AGENT
  return {
    enabled: agent.enabled === true,
    permission: agent.permission === 'safe' ? 'safe' : 'advice',
    model: agent.model || DEFAULT_AGENT.model,
  }
}

