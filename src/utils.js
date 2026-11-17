export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

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
