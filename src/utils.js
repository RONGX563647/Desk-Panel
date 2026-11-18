export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const TOKEN_KEY = 'panel-token'

// 口令优先取 URL，成功后记在本地；之后直接打开面板也不用再手动带参数
export function readAccessToken() {
  if (typeof location === 'undefined') return ''
  const fromUrl = new URLSearchParams(location.search).get('token') || ''
  try {
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl)
      return fromUrl
    }
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return fromUrl
  }
}

export const pad2 = (n) => String(n).padStart(2, '0')

export function formatClock(ts) {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatUptime(sec) {
  if (!Number.isFinite(sec)) return '--'
  const total = Math.max(0, Math.floor(sec))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

export function levelOf(pct) {
  if (!Number.isFinite(pct)) return 'idle'
  if (pct >= 90) return 'danger'
  if (pct >= 70) return 'warn'
  return 'ok'
}

export function formatRate(n) {
  if (!Number.isFinite(n) || n < 0) return '--'
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB/s`
  if (n >= 1024) return `${Math.round(n / 1024)} KB/s`
  return `${Math.round(n)} B/s`
}

export function toGB(bytes) {
  return Number.isFinite(bytes) ? bytes / 1024 ** 3 : null
}

export const COMPONENT_SPANS = {
  clock: 5,
  cpu: 7,
  gpu: 6,
  memory: 4,
  disk: 4,
  network: 4,
  temp: 6,
  processes: 7,
  devices: 4,
  latency: 5,
  system: 6,
  power: 4,
  fan: 6,
  sensors: 12,
  media: 4,
  optimize: 4,
  agent: 6,
  shortcuts: 12,
  dev: 12,
}

// 按 12 列基准打包组件，行内按权重伸展自动占满整行
export function packRows(components) {
  const rows = []
  let current = []
  let used = 0
  for (const id of components) {
    const span = COMPONENT_SPANS[id] || 4
    if (used > 0 && used + span > 12) {
      rows.push(current)
      current = []
      used = 0
    }
    current.push({ id, span })
    used += span
    if (used >= 12) {
      rows.push(current)
      current = []
      used = 0
    }
  }
  if (current.length) rows.push(current)
  return rows
}

export function wrapPage(current, delta, total) {
  if (!Number.isInteger(total) || total <= 0) return 0
  return (((current + delta) % total) + total) % total
}
