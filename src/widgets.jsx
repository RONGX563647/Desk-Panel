import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CodeIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  TerminalIcon,
  VolumeDownIcon,
  VolumeUpIcon,
} from './icons.jsx'
import { WEEK, formatRate, levelOf, pad2, toGB } from './utils.js'

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

const MEDIA_STATUS = {
  playing: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  closed: '未在播放',
  opening: '打开中',
  unavailable: '不可用',
}

export const Media = memo(function Media({ media, states = {}, onCommand }) {
  const available = !!media?.available
  const playing = media?.status === 'playing'
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
