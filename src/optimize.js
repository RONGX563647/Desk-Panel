import { toGB } from './utils.js'

const PROTECTED_PROCESSES = new Set([
  'system',
  'idle',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'smss',
  'registry',
  'memory compression',
  'secure system',
  'dwm',
  'explorer',
])

export function buildOptimizePlan(metrics, info) {
  const cpu = Number.isFinite(metrics?.cpu) ? Math.max(0, Math.min(100, metrics.cpu)) : null
  const memTotal = Number(metrics?.memTotal) || Number(info?.memTotal) || 0
  const memUsed = Number(metrics?.memUsed) || 0
  const memRatio = memTotal > 0 ? Math.max(0, Math.min(1, memUsed / memTotal)) : 0
  const diskSize = Number(metrics?.disk?.size) || 0
  const diskUsed = Number(metrics?.disk?.used) || 0
  const diskRatio = diskSize > 0 ? Math.max(0, Math.min(1, diskUsed / diskSize)) : 0
  const temp = Number.isFinite(metrics?.temp) ? metrics.temp : null

  let score = 100
  if (cpu != null) score -= Math.min(25, Math.max(0, cpu - 50) * 0.5)
  score -= Math.min(30, Math.max(0, memRatio - 0.6) * 75)
  if (diskRatio > 0.85) score -= Math.min(10, (diskRatio - 0.85) * 67)
  if (temp != null && temp > 75) score -= Math.min(10, temp - 75)
  score = Math.max(0, Math.min(100, Math.round(score)))

  const level = score >= 85 ? 'ok' : score >= 65 ? 'warn' : 'danger'
  const recommendations = []

  if (memRatio >= 0.85) {
    const candidate = (metrics?.processes || []).find(
      (item) => item?.id && !PROTECTED_PROCESSES.has(String(item.name || '').toLowerCase())
    )
    const usedGB = toGB(memUsed)
    const totalGB = toGB(memTotal)
    recommendations.push({
      key: 'memory',
      title: '内存占用偏高',
      detail: candidate
        ? `${candidate.name} 占用 ${toGB(candidate.mem)?.toFixed(2) ?? '--'} GB`
        : `${usedGB?.toFixed(1) ?? '--'} / ${totalGB?.toFixed(0) ?? '--'} GB`,
      tone: memRatio >= 0.92 ? 'danger' : 'warn',
      action: candidate
        ? { type: 'trim-process', pid: candidate.id, label: '整理' }
        : { type: 'open-task-manager', label: '查看进程' },
    })
  }

  if (cpu != null && cpu >= 85) {
    recommendations.push({
      key: 'cpu',
      title: 'CPU 占用偏高',
      detail: `当前 ${Math.round(cpu)}%，可查看高占用进程`,
      tone: cpu >= 95 ? 'danger' : 'warn',
      action: { type: 'open-task-manager', label: '查看进程' },
    })
  }

  if (diskRatio >= 0.9) {
    recommendations.push({
      key: 'disk',
      title: '磁盘空间不足',
      detail: `${metrics?.disk?.mount || 'C:'} 已使用 ${Math.round(diskRatio * 100)}%`,
      tone: diskRatio >= 0.96 ? 'danger' : 'warn',
      action: null,
    })
  }

  if (temp != null && temp >= 80) {
    recommendations.push({
      key: 'temp',
      title: '温度偏高',
      detail: `当前 ${temp.toFixed(1)}°C，注意散热`,
      tone: temp >= 90 ? 'danger' : 'warn',
      action: null,
    })
  }

  if (!recommendations.length) {
    recommendations.push({
      key: 'ok',
      title: '运行状态良好',
      detail: '未发现需要处理的项',
      tone: 'ok',
      action: null,
    })
  }

  return {
    score,
    level,
    cpu,
    temp,
    memRatio,
    diskRatio,
    recommendations: recommendations.slice(0, 2),
  }
}
