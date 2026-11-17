import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CodeIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  MonitorIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  TerminalIcon,
  VolumeDownIcon,
  VolumeUpIcon,
} from './icons.jsx'
import { WEEK, formatRate, formatUptime, levelOf, pad2, toGB } from './utils.js'
import { buildOptimizePlan } from './optimize.js'

function Tile({ area, label, meta, className = '', children }) {
  return (
    <section className={`tile tile--${area} ${className}`.trim()}>
      <header className="tile-head">
        <span className="tile-label">{label}</span>
        {meta ? <span className="tile-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  )
}

function MetricSkeleton({ spark = false }) {
  return (
    <div className="metric-skeleton">
      <div className="skeleton skeleton-value" />
      <div className="skeleton skeleton-bar" />
      {spark ? <div className="skeleton skeleton-spark" /> : null}
    </div>
  )
}

export const Clock = memo(function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer = 0
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 20)
    }
    const onVisible = () => {
      if (!document.hidden) setNow(new Date())
    }

    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 20)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <Tile area="clock" label="时间" meta="本地">
      <div className="clock-body">
        <div className="clock-time">
          {pad2(now.getHours())}
          <span className="colon">:</span>
          {pad2(now.getMinutes())}
          <span className="sec">{pad2(now.getSeconds())}</span>
        </div>
        <div className="clock-date">
          {now.getFullYear()}/{pad2(now.getMonth() + 1)}/{pad2(now.getDate())} · {WEEK[now.getDay()]}
        </div>
      </div>
    </Tile>
  )
})

export const Cpu = memo(function Cpu({ value, cores = [], model, temp, processCount, ready }) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
  const level = levelOf(pct)
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = pct == null ? circumference : circumference * (1 - pct / 100)
  const meta = ready ? ['实时', Number.isFinite(temp) ? `${Math.round(temp)}°C` : null].filter(Boolean).join(' · ') : '采样中'

  return (
    <Tile area="cpu" label="CPU" meta={meta}>
      <div className="ring-wrap">
        {pct == null ? (
          <div className="skeleton skeleton-ring" />
        ) : (
          <svg viewBox="0 0 140 140" className="ring" role="img" aria-label={`CPU 使用率 ${Math.round(pct)}%`}>
            <circle cx="70" cy="70" r={radius} className="ring-track" />
            <circle
              cx="70"
              cy="70"
              r={radius}
              className={`ring-value ${level}`}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
            />
          </svg>
        )}
        <div className="ring-text">
          <strong className={pct == null ? 'muted' : level}>{pct == null ? '--' : Math.round(pct)}</strong>
          <span>{pct == null ? '' : '%'}</span>
        </div>
      </div>

      <div className={`core-bars ${cores.length ? '' : 'is-empty'}`}>
        {cores.length ? (
          cores.slice(0, 16).map((c, i) => (
            <div className="core-bar" key={i}>
              <span className={levelOf(c)} style={{ height: `${c == null ? 4 : Math.max(3, c)}%` }} />
            </div>
          ))
        ) : (
          <span className="core-empty">等待首次采样…</span>
        )}
      </div>

      {model ? (
        <div className="tile-sub ellipsis" title={model}>
          {model}
          {Number.isFinite(processCount) ? ` · ${processCount} 进程` : ''}
        </div>
      ) : null}
    </Tile>
  )
})

export const Memory = memo(function Memory({ used, total, ready }) {
  const usedGB = toGB(used)
  const totalGB = toGB(total)
  const pct = usedGB != null && totalGB > 0 ? (usedGB / totalGB) * 100 : null
  const level = levelOf(pct)

  return (
    <Tile area="mem" label="内存" meta={pct == null ? '--' : `${pct.toFixed(0)}%`}>
      {!ready || usedGB == null || !totalGB ? (
        <MetricSkeleton />
      ) : (
        <>
          <div className="big-value">
            {usedGB.toFixed(1)}
            <span className="unit"> / {totalGB.toFixed(0)} GB</span>
          </div>
          <div
            className={`bar ${level}`}
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(pct)}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="tile-sub">
            {pct.toFixed(0)}% 已用 · 剩余 {Math.max(0, totalGB - usedGB).toFixed(1)} GB
          </div>
        </>
      )}
    </Tile>
  )
})

export const Disk = memo(function Disk({ disk, disks, ready }) {
  const source = Array.isArray(disks) && disks.length ? disks : disk ? [disk] : []
  const items = source
    .map((item) => {
      const sizeGB = toGB(item.size)
      const usedGB = toGB(item.used)
      const pct =
        sizeGB != null && usedGB != null && sizeGB > 0 ? Math.min(100, (usedGB / sizeGB) * 100) : null
      return { mount: item.mount || '--', sizeGB, usedGB, pct, level: levelOf(pct) }
    })
    .filter((item) => item.pct != null)
  const primary = items[0]

  return (
    <Tile area="disk" label="磁盘" meta={items.length > 1 ? `${items.length} 块盘` : primary?.mount || '--'}>
      {!ready || !primary ? (
        <MetricSkeleton />
      ) : items.length === 1 ? (
        <>
          <div className="big-value">
            {primary.usedGB.toFixed(1)}
            <span className="unit"> / {primary.sizeGB.toFixed(0)} GB</span>
          </div>
          <div
            className={`bar ${primary.level}`}
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(primary.pct)}
          >
            <span style={{ width: `${primary.pct}%` }} />
          </div>
          <div className="tile-sub">
            {primary.pct.toFixed(0)}% 已用 · 剩余{' '}
            {Math.max(0, primary.sizeGB - primary.usedGB).toFixed(1)} GB
          </div>
        </>
      ) : (
        <div className="disk-list">
          {items.map((item) => (
            <div className="disk-item" key={item.mount}>
              <div className="disk-head">
                <span className="disk-mount">{item.mount}</span>
                <span className="disk-size">
                  {item.usedGB.toFixed(1)} / {item.sizeGB.toFixed(0)} GB
                </span>
                <span className={`disk-pct ${item.level}`}>{item.pct.toFixed(0)}%</span>
              </div>
              <div className={`bar ${item.level}`}>
                <span style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Tile>
  )
})

export const Gpu = memo(function Gpu({ gpu, ready }) {
  const pct =
    gpu && Number.isFinite(gpu.utilization) ? Math.max(0, Math.min(100, gpu.utilization)) : null
  const memPct =
    gpu && gpu.memoryUsed != null && gpu.memoryTotal ? (gpu.memoryUsed / gpu.memoryTotal) * 100 : null
  const level = levelOf(pct ?? memPct)

  return (
    <Tile area="gpu" label="GPU" meta={gpu ? gpu.vendor || '实时' : ready ? '不可用' : '采样中'}>
      {!ready ? (
        <MetricSkeleton />
      ) : !gpu ? (
        <div className="keys-empty">当前平台未提供 GPU 信息</div>
      ) : (
        <>
          <div className="tile-sub ellipsis" title={gpu.model}>
            {gpu.model}
          </div>
          {pct != null ? (
            <>
              <div className="big-value">
                {Math.round(pct)}
                <span className="unit">
                  % 负载{Number.isFinite(gpu.temperature) ? ` · ${Math.round(gpu.temperature)}°C` : ''}
                </span>
              </div>
              <div
                className={`bar ${level}`}
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(pct)}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : (
            <div className="gpu-meta">
              负载信息不可用
              {Number.isFinite(gpu.temperature) ? ` · ${Math.round(gpu.temperature)}°C` : ''}
            </div>
          )}
          <div className="tile-sub">
            {memPct != null
              ? `显存 ${memPct.toFixed(0)}% · ${toGB(gpu.memoryUsed).toFixed(1)} / ${toGB(gpu.memoryTotal).toFixed(0)} GB`
              : '显存信息不可用'}
          </div>
        </>
      )}
    </Tile>
  )
})

export const Network = memo(function Network({ rx, tx, ts, ready }) {
  const [history, setHistory] = useState(() => Array(28).fill(0))
  const lastTs = useRef(0)

  useEffect(() => {
    if (!ready || !ts || ts === lastTs.current) return
    lastTs.current = ts
    const speed = (Number.isFinite(rx) ? rx : 0) + (Number.isFinite(tx) ? tx : 0)
    setHistory((prev) => [...prev.slice(1), speed])
  }, [ready, ts, rx, tx])

  const max = useMemo(() => Math.max(1, ...history), [history])

  return (
    <Tile area="net" label="网络" meta={ready ? '实时' : '采样中'}>
      {!ready ? (
        <MetricSkeleton spark />
      ) : (
        <>
          <div className="net-row">
            <span className="dot down" /> <span>↓ {formatRate(rx)}</span>
          </div>
          <div className="net-row">
            <span className="dot up" /> <span>↑ {formatRate(tx)}</span>
          </div>
          <div className="spark" aria-hidden="true">
            {history.map((v, i) => (
              <span key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
            ))}
          </div>
        </>
      )}
    </Tile>
  )
})

const tempLevel = (value) => (value >= 85 ? 'danger' : value >= 70 ? 'warn' : 'ok')

export const Temp = memo(function Temp({ cpuTemp, gpuTemp, ready }) {
  const entries = [
    { key: 'cpu', label: 'CPU', value: Number.isFinite(cpuTemp) ? cpuTemp : null },
    { key: 'gpu', label: 'GPU', value: Number.isFinite(gpuTemp) ? gpuTemp : null },
  ]
  const known = entries.filter((item) => item.value != null)

  return (
    <Tile area="temp" label="温度" meta={ready ? (known.length ? '实时' : '不可用') : '采样中'}>
      {!ready ? (
        <MetricSkeleton />
      ) : !known.length ? (
        <div className="keys-empty">当前设备未提供温度传感器</div>
      ) : (
        <div className="temp-list">
          {entries.map(({ key, label, value }) => (
            <div className="temp-item" key={key}>
              <div className="temp-head">
                <span className="temp-name">{label}</span>
                <span className={`temp-value ${value == null ? 'muted' : tempLevel(value)}`}>
                  {value == null ? '--' : `${Math.round(value)}°C`}
                </span>
              </div>
              <div className={`bar ${value == null ? '' : tempLevel(value)}`}>
                <span style={{ width: `${value == null ? 0 : Math.min(100, Math.max(3, value))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Tile>
  )
})

function formatCpuTime(seconds) {
  if (!Number.isFinite(seconds)) return '--'
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} 小时`
  if (seconds >= 60) return `${Math.round(seconds / 60)} 分`
  return `${Math.round(seconds)} 秒`
}

export const Processes = memo(function Processes({ list, ready }) {
  const [expanded, setExpanded] = useState(false)
  const all = Array.isArray(list) ? list.slice(0, 8) : []
  const items = expanded ? all : all.slice(0, 3)

  return (
    <Tile area="proc" label="进程" meta={ready ? (all.length ? `内存前 ${all.length}` : '不可用') : '采样中'}>
      {!ready ? (
        <MetricSkeleton />
      ) : items.length ? (
        <div className={`proc-list ${expanded ? 'is-expanded' : ''}`}>
          {items.map((item, index) => (
            <div className="proc-row" key={`${item.name}-${index}`}>
              <span className="proc-rank">{index + 1}</span>
              <span className="proc-name ellipsis" title={item.name}>
                {item.name}
              </span>
              <span className="proc-mem">{toGB(item.mem) != null ? `${toGB(item.mem).toFixed(2)} GB` : '--'}</span>
              <span className="proc-cpu">{formatCpuTime(item.cpu)}</span>
            </div>
          ))}
          {all.length > 3 ? (
            <button type="button" className="proc-more" onClick={() => setExpanded((prev) => !prev)}>
              {expanded ? '收起' : `查看全部 ${all.length} 个`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="keys-empty">进程信息不可用</div>
      )}
    </Tile>
  )
})

export const Optimize = memo(function Optimize({ metrics, info, ready, states = {}, onOptimize, onClearError }) {
  const plan = useMemo(() => buildOptimizePlan(metrics, info), [metrics, info])
  const errorEntry = Object.entries(states).find(([, item]) => item?.state === 'error')
  const [errorKey, error] = errorEntry || []

  return (
    <Tile area="opt" label="优化" meta={ready ? `健康 ${plan.score}` : '采样中'}>
      {!ready ? (
        <MetricSkeleton />
      ) : (
        <div className="opt-body">
          <div className={`opt-score ${plan.level}`} role="img" aria-label={`健康分 ${plan.score}`}>
            <strong>{plan.score}</strong>
            <span>{plan.level === 'ok' ? '良好' : plan.level === 'warn' ? '注意' : '偏高'}</span>
          </div>
          <div className="opt-list">
            {plan.recommendations.map((item) => {
              const primary = item.action
              const secondary = item.secondaryAction
              const primaryKey = primary ? `${primary.type}-${primary.pid || 'all'}` : null
              const secondaryKey = secondary ? `${secondary.type}-${secondary.pid || 'all'}` : null
              const primaryState = primaryKey ? states[primaryKey] : null
              const secondaryState = secondaryKey ? states[secondaryKey] : null
              const primaryBusy = primaryState?.state === 'pending'
              const secondaryBusy = secondaryState?.state === 'pending'
              return (
                <div className={`opt-item ${item.tone}`} key={item.key}>
                  <div className="opt-item-main">
                    <span className="opt-title">{item.title}</span>
                    <span className="opt-detail ellipsis" title={item.detail}>
                      {item.detail}
                      {secondary ? (
                        <>
                          <span className="opt-detail-sep"> · </span>
                          <button
                            type="button"
                            className="opt-link"
                            disabled={secondaryBusy}
                            aria-busy={secondaryBusy}
                            title="将该进程优先级降为 BelowNormal，不会结束进程"
                            onClick={() => onOptimize(secondary, secondaryKey, secondary.label)}
                          >
                            {secondaryBusy
                              ? '处理中'
                              : secondaryState?.state === 'ok'
                                ? '已完成'
                                : secondary.label}
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {primary ? (
                    <button
                      type="button"
                      className={`opt-action ${primaryState?.state || ''}`.trim()}
                      disabled={primaryBusy}
                      aria-busy={primaryBusy}
                      title={
                        primary.type === 'trim-process'
                          ? '仅整理该进程的工作集，不会结束进程'
                          : undefined
                      }
                      onClick={() => onOptimize(primary, primaryKey, primary.label)}
                    >
                      {primaryBusy ? '处理中' : primaryState?.state === 'ok' ? '已完成' : primary.label}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error ? (
        <div className="opt-alert" role="alert">
          <span className="ellipsis" title={error.message}>
            {error.message}
          </span>
          <button type="button" onClick={() => onClearError(errorKey)} aria-label="关闭优化错误提示">
            知道了
          </button>
        </div>
      ) : null}
    </Tile>
  )
})


export const Latency = memo(function Latency({ value, ts, ready }) {
  const [history, setHistory] = useState(() => Array(24).fill(null))
  const lastTs = useRef(0)

  useEffect(() => {
    if (!ready || !ts || ts === lastTs.current) return
    lastTs.current = ts
    setHistory((prev) => [...prev.slice(1), Number.isFinite(value) ? value : null])
  }, [ready, ts, value])

  const online = Number.isFinite(value)
  const quality = !online ? '超时' : value < 40 ? '优秀' : value < 80 ? '良好' : value < 150 ? '一般' : '较慢'
  const tone = !online ? 'danger' : value < 60 ? 'ok' : value < 120 ? 'warn' : 'danger'
  const max = useMemo(() => Math.max(120, ...history.filter((item) => Number.isFinite(item))), [history])
  const avg = useMemo(() => {
    const samples = history.filter((item) => Number.isFinite(item))
    if (!samples.length) return null
    return Math.round(samples.reduce((sum, item) => sum + item, 0) / samples.length)
  }, [history])

  return (
    <Tile area="lat" label="延迟" meta={ready ? (avg != null ? `均 ${avg} ms` : '223.5.5.5') : '采样中'}>
      {!ready ? (
        <MetricSkeleton spark />
      ) : (
        <>
          <div className="lat-row">
            <span className={`lat-value ${tone}`}>
              {online ? Math.round(value) : '--'}
              <span className="unit"> ms</span>
            </span>
            <span className={`lat-quality ${tone}`}>{quality}</span>
          </div>
          <div className="lat-spark" aria-hidden="true">
            {history.map((item, index) => (
              <span
                key={index}
                className={item == null ? 'loss' : ''}
                style={{ height: `${item == null ? 8 : Math.max(6, (item / max) * 100)}%` }}
              />
            ))}
          </div>
        </>
      )}
    </Tile>
  )
})

function formatBootTime(uptime) {
  if (!Number.isFinite(uptime)) return '--'
  const boot = new Date(Date.now() - uptime * 1000)
  return `${pad2(boot.getMonth() + 1)}/${pad2(boot.getDate())} ${pad2(boot.getHours())}:${pad2(boot.getMinutes())}`
}

export const System = memo(function System({ info, uptime, processCount, ready }) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef(0)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const copyIp = async (ip) => {
    try {
      await navigator.clipboard.writeText(ip)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 浏览器拒绝剪贴板时忽略 */
    }
  }

  const rows = [
    ['主机', info?.host],
    ['系统', info?.platform],
    ['架构', info?.arch],
    ['局域网', info?.ip],
    ['核心', Number.isFinite(info?.cores) ? `${info.cores} 线程` : ''],
    ['运行', ready ? formatUptime(uptime) : ''],
    ['开机', ready ? formatBootTime(uptime) : ''],
    ['进程', ready && Number.isFinite(processCount) ? `${processCount}` : ''],
  ]

  return (
    <Tile area="sys" label="系统" meta={info?.host || '本机'}>
      {!ready ? (
        <MetricSkeleton />
      ) : (
        <div className="sys-grid">
          {rows.map(([label, value]) => (
            <div className="sys-item" key={label}>
              <span className="sys-label">{label}</span>
              {label === '局域网' && value ? (
                <button type="button" className="sys-copy" onClick={() => copyIp(value)} title="点击复制地址">
                  {copied ? '已复制' : value}
                </button>
              ) : (
                <span className="sys-value ellipsis" title={value || '--'}>
                  {value || '--'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Tile>
  )
})

export const Power = memo(function Power({ power, ready }) {
  const present = !!power?.present
  const percent = present && Number.isFinite(power.percent) ? power.percent : null
  const charging = !!power?.charging
  const level = percent == null ? '' : percent <= 15 ? 'danger' : percent <= 30 ? 'warn' : 'ok'
  const detail = present ? (charging ? '正在充电' : '电池供电') : '交流供电'

  return (
    <Tile area="power" label="电源" meta={ready ? detail : '采样中'}>
      {!ready ? (
        <MetricSkeleton />
      ) : present ? (
        <>
          <div className="big-value">
            {percent == null ? '--' : percent}
            <span className="unit"> %</span>
          </div>
          <div
            className={`bar ${level}`}
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={percent ?? 0}
          >
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>
          <div className="tile-sub">{charging ? '外接电源 · 充电中' : '使用电池供电'}</div>
        </>
      ) : (
        <div className="power-ac">
          <span className="power-ac-badge">AC</span>
          <span>未检测到电池，正在使用交流供电</span>
        </div>
      )}
    </Tile>
  )
})

const MEDIA_STATUS = {  playing: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  closed: '未在播放',
  opening: '打开中',
  unavailable: '不可用',
}

const formatMediaTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`
}

export const Media = memo(function Media({ media, states = {}, onCommand }) {
  const available = !!media?.available
  const playing = media?.status === 'playing'
  const position = Number.isFinite(media?.position) ? media.position : 0
  const duration = Number.isFinite(media?.duration) ? media.duration : 0
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0
  const detail =
    available && media.artist
      ? [media.artist, media.album].filter(Boolean).join(' · ')
      : available
        ? media.source || ''
        : '打开任意播放器后自动识别'

  const controls = [
    { cmd: 'prev', Icon: PrevIcon, label: '上一首', needsSession: true },
    { cmd: 'playpause', Icon: playing ? PauseIcon : PlayIcon, label: playing ? '暂停' : '播放', needsSession: true },
    { cmd: 'next', Icon: NextIcon, label: '下一首', needsSession: true },
    { cmd: 'volume_down', Icon: VolumeDownIcon, label: '音量减', needsSession: false },
    { cmd: 'mute', Icon: MuteIcon, label: '静音', needsSession: false },
    { cmd: 'volume_up', Icon: VolumeUpIcon, label: '音量加', needsSession: false },
  ]

  return (
    <Tile area="media" label="媒体" meta={available ? MEDIA_STATUS[media.status] || '已连接' : '系统媒体'}>
      <div className={`media-track ${available ? '' : 'is-empty'}`}>
        <div className="media-title ellipsis" title={media?.title || ''}>
          {available ? media.title || '正在播放' : '未在播放'}
        </div>
        <div className="media-sub ellipsis" title={detail}>
          {detail}
        </div>
      </div>
      {available && duration > 0 ? (
        <div className="media-progress">
          <div className="bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="media-time">
            <span>{formatMediaTime(position)}</span>
            <span>{formatMediaTime(duration)}</span>
          </div>
        </div>
      ) : null}
      <div className="media-controls">
        {controls.map(({ cmd, Icon, label, needsSession }, index) => {
          const pending = states[cmd] === 'pending'
          const disabled = pending || (needsSession && !available)
          return (
            <button
              key={cmd}
              type="button"
              className={`media-btn ${states[cmd] || ''} ${index === 3 ? 'media-btn--gap' : ''}`.trim()}
              onClick={() => onCommand(cmd)}
              disabled={disabled}
              aria-busy={pending}
              aria-label={label}
              title={label}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </div>
    </Tile>
  )
})

const ICON_MAP = {
  terminal: TerminalIcon,
  folder: FolderIcon,
  code: CodeIcon,
  globe: GlobeIcon,
  lock: LockIcon,
  monitor: MonitorIcon,
}

export const Shortcuts = memo(function Shortcuts({ actions = [], states, onAction, onClearError }) {
  const errorEntry = Object.entries(states).find(([, s]) => s?.state === 'error')
  const [errorId, error] = errorEntry || []

  return (
    <Tile area="keys" label="快捷操作" meta={actions.length ? '点击执行' : '待配置'}>
      {actions.length ? (
        <div className="keys">
          {actions.map(({ id, label, icon, kind }) => {
            const Icon = ICON_MAP[icon] || TerminalIcon
            const st = states[id]
            const busy = st?.state === 'pending'
            const status = busy
              ? '执行中'
              : st?.state === 'ok'
                ? '已完成'
                : st?.state === 'error'
                  ? '失败'
                  : ''
            return (
              <button
                key={id}
                type="button"
                className={`key ${kind === 'lock' ? 'danger' : ''} ${st?.state || ''}`.trim()}
                onClick={() => onAction(id, label)}
                disabled={busy}
                aria-busy={busy}
              >
                <span className="key-icon">
                  <Icon size={20} />
                </span>
                <span className="key-label">{label}</span>
                <span className="key-status">{status || '\u00A0'}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="keys-empty">暂无可用动作，请在本机设置页添加</div>
      )}

      {error ? (
        <div className="keys-alert" role="alert">
          <span title={error.message}>{error.message}</span>
          <button type="button" onClick={() => onClearError(errorId)} aria-label="关闭错误提示">
            知道了
          </button>
        </div>
      ) : null}
    </Tile>
  )
})
