import fs from 'node:fs'
import path from 'node:path'

export const CONFIG_VERSION = 2
export const ICON_NAMES = ['terminal', 'folder', 'code', 'globe', 'lock']
export const ACTION_KINDS = ['app', 'url', 'lock']
export const COMPONENT_IDS = [
  'clock',
  'cpu',
  'gpu',
  'memory',
  'disk',
  'network',
  'temp',
  'processes',
  'latency',
  'system',
  'power',
  'media',
  'optimize',
  'shortcuts',
]
export const MAX_PAGES = 5

export const DEFAULT_LAYOUT = {
  pages: [
    {
      id: 'main',
      name: '主页',
      components: ['clock', 'cpu', 'memory', 'disk', 'network', 'shortcuts'],
    },
  ],
}

export const DEFAULT_ACTIONS = [
  { id: 'terminal', kind: 'app', label: '终端', icon: 'terminal', target: 'wt.exe', args: [], enabled: true },
  { id: 'explorer', kind: 'app', label: '文件', icon: 'folder', target: 'explorer.exe', args: [], enabled: true },
  { id: 'vscode', kind: 'app', label: 'VS Code', icon: 'code', target: 'code', args: [], enabled: true },
  { id: 'browser', kind: 'url', label: '浏览器', icon: 'globe', target: 'https://github.com', args: [], enabled: true },
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
  if (kind === 'lock') target = ''
  if (kind === 'url') {
    if (!/^https?:\/\//i.test(target)) {
      if (strict) errors.push(`${where}的网址必须以 http:// 或 https:// 开头`)
    }
  } else if (kind === 'app' && !target) {
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
  if (kind !== 'app') args = []

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

export function normalizeConfig(raw, { strict = false } = {}) {
  const errors = []
  if (!isObject(raw) || !Array.isArray(raw.actions)) {
    if (strict) errors.push('配置缺少动作列表')
    return { config: { version: CONFIG_VERSION, actions: cloneDefaults(), layout: cloneDefaultLayout() }, errors }
  }

  const taken = new Set()
  const actions = []
  raw.actions.forEach((item, index) => {
    const action = normalizeAction(item, index, strict, errors, taken)
    if (action) actions.push(action)
  })

  const layout = normalizeLayout(raw.layout, strict, errors)
  return { config: { version: CONFIG_VERSION, actions, layout }, errors }
}

function cloneDefaults() {
  return DEFAULT_ACTIONS.map((action) => ({ ...action, args: [...action.args] }))
}

export function loadConfig(file, { warn = () => {} } = {}) {
  const fallback = () => {
    const config = { version: CONFIG_VERSION, actions: cloneDefaults(), layout: cloneDefaultLayout() }
    saveConfig(file, config)
    return config
  }

  if (!fs.existsSync(file)) return fallback()

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
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

  const { config, errors } = normalizeConfig(raw)
  for (const message of errors) warn(`配置项已忽略：${message}`)
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
