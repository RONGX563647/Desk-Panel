import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CodeIcon, FolderIcon, GlobeIcon, LockIcon, TerminalIcon } from './icons.jsx'
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

export const Cpu = memo(function Cpu({ value, cores = [], model, ready }) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
  const level = levelOf(pct)
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = pct == null ? circumference : circumference * (1 - pct / 100)

  return (
    <Tile area="cpu" label="CPU" meta={ready ? '实时' : '采样中'}>
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

export const Disk = memo(function Disk({ disk, ready }) {
  const sizeGB = toGB(disk?.size)
  const usedGB = toGB(disk?.used)
  const pct = sizeGB != null && usedGB != null && sizeGB > 0 ? Math.min(100, (usedGB / sizeGB) * 100) : null
  const level = levelOf(pct)
  const mount = disk?.mount || '--'

  return (
    <Tile area="disk" label="磁盘" meta={mount}>
      {!ready || pct == null ? (
        <MetricSkeleton />
      ) : (
        <>
          <div className="big-value">
            {usedGB.toFixed(1)}
            <span className="unit"> / {sizeGB.toFixed(0)} GB</span>
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
            {pct.toFixed(0)}% 已用 · 剩余 {Math.max(0, sizeGB - usedGB).toFixed(1)} GB
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

const ACTIONS = [
  { id: 'terminal', label: '终端', Icon: TerminalIcon },
  { id: 'explorer', label: '文件', Icon: FolderIcon },
  { id: 'vscode', label: 'VS Code', Icon: CodeIcon },
  { id: 'browser', label: '浏览器', Icon: GlobeIcon },
  { id: 'lock', label: '锁屏', Icon: LockIcon, tone: 'danger' },
]

export const Shortcuts = memo(function Shortcuts({ states, onAction, onClearError }) {
  const errorEntry = Object.entries(states).find(([, s]) => s?.state === 'error')
  const [errorId, error] = errorEntry || []

  return (
    <Tile area="keys" label="快捷操作" meta="点击执行">
      <div className="keys">
        {ACTIONS.map(({ id, label, Icon, tone }) => {
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
              className={`key ${tone || ''} ${st?.state || ''}`.trim()}
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
