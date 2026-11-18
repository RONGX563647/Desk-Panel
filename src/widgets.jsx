import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CodeIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  MonitorIcon,
  MoonIcon,
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

// 正反两面共用一块区域，翻面后等价于两张卡片叠放，省纵向空间
function FlipTile({ area, label, meta, backLabel, backMeta, className = '', front, back }) {
  const [flipped, setFlipped] = useState(false)
  const flippable = !!back

  return (
    <section
      className={`tile tile--${area} tile-flip ${className} ${flipped ? 'is-flipped' : ''}`.trim()}
    >
      <header className="tile-head">
        <span className="tile-label">{flipped ? backLabel : label}</span>
        <span className="tile-meta">{flipped ? backMeta : meta}</span>
        {flippable ? (
          <button
            type="button"
            className="tile-flip-btn"
            onClick={() => setFlipped((prev) => !prev)}
            title={flipped ? `切回${label}` : `翻到${backLabel}`}
            aria-label={flipped ? `切回${label}` : `翻到${backLabel}`}
          >
            ⇄
          </button>
        ) : null}
      </header>
      <div className="flip-stage">
        <div className="flip-face">{front}</div>
        {flippable ? <div className="flip-face flip-face--back">{back}</div> : null}
      </div>
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
  const peak = useMemo(() => Math.max(...history), [history])
  const avg = useMemo(
    () => history.reduce((sum, value) => sum + value, 0) / (history.length || 1),
    [history]
  )

  const back = !ready ? (
    <MetricSkeleton />
  ) : (
    <div className="flip-stats">
      <div className="flip-stat">
        <span className="flip-stat-label">当前</span>
        <span className="flip-stat-value">
          ↓ {formatRate(rx)} · ↑ {formatRate(tx)}
        </span>
      </div>
      <div className="flip-stat">
        <span className="flip-stat-label">峰值</span>
        <span className="flip-stat-value">{formatRate(peak)}</span>
      </div>
      <div className="flip-stat">
        <span className="flip-stat-label">均值</span>
        <span className="flip-stat-value">{formatRate(avg)}</span>
      </div>
      <div className="flip-stat">
        <span className="flip-stat-label">样本</span>
        <span className="flip-stat-value">{history.length} 次采样</span>
      </div>
    </div>
  )

  return (
    <FlipTile
      area="net"
      label="网络"
      meta={ready ? '实时' : '采样中'}
      backLabel="流量统计"
      backMeta={ready ? `峰值 ${formatRate(peak)}` : '采样中'}
      back={back}
      front={
        !ready ? (
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
        )
      }
    />
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

function batteryLevel(percent) {
  if (!Number.isFinite(percent)) return ''
  if (percent <= 15) return 'danger'
  if (percent <= 30) return 'warn'
  return ''
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return ''
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours ? `${hours} 小时 ${rest} 分` : `${rest} 分`
}

const LINK_LABELS = { receiver: '2.4G 接收器', wired: '有线' }

// 同型号的键盘和鼠标在系统里共用接收器，各自型号无法区分，
// 因此角色行只负责说明「这是键盘/鼠标」，型号统一放在设备标题上
function DeviceRow({ item, busy, onToggle }) {
  const offline = item.disabled
  const roles = Array.isArray(item.roles) ? item.roles : []
  const hint = [
    item.name,
    LINK_LABELS[item.link] || '',
    item.kind,
    item.address,
    item.vid && item.pid ? `${item.vid} ${item.pid}` : '',
    item.instanceId,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`ds-row ${offline ? 'is-off' : ''}`} title={hint}>
      <div className="ds-main">
        <div className="ds-top">
          <span className="ds-name ellipsis">{item.name}</span>
          <span className="ds-link">{LINK_LABELS[item.link] || item.class || ''}</span>
        </div>
        <div className="ds-roles">
          {roles.length ? (
            roles.map((role) => (
              <span className={`ds-role ${role.connected ? '' : 'is-off'}`} key={role.instanceId || role.role}>
                <b>{role.label}</b>
                <span className="ellipsis">{role.name || '型号由接收器代报'}</span>
              </span>
            ))
          ) : (
            <span className="ds-role">
              <b>{item.kind || item.class || '设备'}</b>
            </span>
          )}
        </div>
      </div>

      <div className="ds-batt-cell">
        {Number.isFinite(item.battery) ? (
          <span className={`ds-batt-num ${batteryLevel(item.battery)}`}>{item.battery}%</span>
        ) : (
          <span className="ds-batt-unknown">电量未知</span>
        )}
        {offline ? <span className="ds-off-tag">已断开</span> : null}
      </div>

      {onToggle ? (
        <button
          type="button"
          className={`ds-toggle ${offline ? 'is-on' : ''}`}
          onClick={() => onToggle(item, offline)}
          disabled={busy}
        >
          {busy ? '…' : offline ? '连接' : '断开'}
        </button>
      ) : null}
    </div>
  )
}

function DeviceSection({ title, tone, items, battery, onToggle, pending, note }) {
  return (
    <section className="ds-section">
      <div className="ds-head">
        <span className={`ds-dot ${tone}`} />
        {title}
        <b>{items.length}</b>
        {note ? <span className="ds-note">{note}</span> : null}
      </div>
      {battery ? (
        <div className="ds-battery">
          <span className="ds-batt" aria-hidden="true">
            <i style={{ width: `${battery.percent ?? 0}%` }} />
          </span>
          <span className="ds-batt-text">
            {battery.percent == null ? '--' : `${battery.percent}%`}
            {battery.status ? ` · ${battery.status}` : ''}
          </span>
          {battery.minutes ? <span className="ds-kind">{formatMinutes(battery.minutes)}</span> : null}
        </div>
      ) : null}
      <div className="ds-list">
        {items.length ? (
          items.map((item, index) => {
            const key = item.id || `${item.name}-${index}`
            return (
              <DeviceRow
                item={item}
                key={key}
                busy={pending === key}
                onToggle={onToggle}
              />
            )
          })
        ) : (
          <span className="ds-none">无</span>
        )}
      </div>
    </section>
  )
}

export const Devices = memo(function Devices({ devices, ready, onToggle, pending }) {
  const usb = Array.isArray(devices?.usb) ? devices.usb : []
  const bluetooth = Array.isArray(devices?.bluetooth) ? devices.bluetooth : []
  const battery = devices?.battery || null
  const total = usb.length + bluetooth.length
  const batteries = [...usb, ...bluetooth].filter((item) => Number.isFinite(item.battery))
  const lowest = batteries.length ? Math.min(...batteries.map((item) => item.battery)) : null
  const wireless = batteries.slice().sort((a, b) => a.battery - b.battery)
  const receivers = usb.filter((item) => item.link === 'receiver')
  const wired = usb.filter((item) => item.link !== 'receiver')
  // 背面板列出全部外设：没有电量的也要出现，否则用户会以为设备没被识别
  const powered = [...usb, ...bluetooth]

  // 正面看连了哪些设备，背面看电量分布：两块信息不常用，翻面即可省一半高度
  const back = !ready ? (
    <MetricSkeleton />
  ) : (
    <div className="ds-power">
      <div className="ds-power-sys">
        <div className="ds-power-head">
          <span>系统电池</span>
          <strong
            className={
              !battery || !Number.isFinite(battery.percent)
                ? ''
                : battery.percent <= 15
                  ? 'danger'
                  : battery.percent <= 30
                    ? 'warn'
                    : ''
            }
          >
            {battery && Number.isFinite(battery.percent) ? `${battery.percent}%` : '--'}
          </strong>
        </div>
        {battery ? (
          <>
            <div className={`bar ${batteryLevel(battery.percent)}`}>
              <span style={{ width: `${Math.min(100, Math.max(0, battery.percent ?? 0))}%` }} />
            </div>
            <div className="ds-power-sub">
              {[battery.status, Number.isFinite(battery.minutes) ? formatMinutes(battery.minutes) : '']
                .filter(Boolean)
                .join(' · ') || '未提供剩余时间'}
            </div>
          </>
        ) : (
          <div className="ds-power-sub">当前设备无电池（交流供电）</div>
        )}
      </div>

      {powered.length ? (
        <div className="ds-power-list">
          {powered.map((item, index) => {
            const known = Number.isFinite(item.battery)
            const label = item.link ? LINK_LABELS[item.link] : item.class
            return (
              <div className="ds-power-item" key={item.id || `${item.name}-${index}`}>
                <div className="ds-power-item-head">
                  <span className="ds-power-name ellipsis">
                    {item.name}
                    {label ? <em className="ds-power-tag">{label}</em> : null}
                  </span>
                  {known ? (
                    <span className={`ds-batt-num ${batteryLevel(item.battery)}`}>{item.battery}%</span>
                  ) : (
                    <span className="ds-batt-unknown">未知</span>
                  )}
                </div>
                {known ? (
                  <div className={`bar ${batteryLevel(item.battery)}`}>
                    <span style={{ width: `${Math.min(100, Math.max(0, item.battery))}%` }} />
                  </div>
                ) : (
                  <div className="ds-power-sub">
                    {item.link === 'receiver' ? '接收器不向系统上报电量' : '系统未提供电量'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ds-power-none">没有可读取电量的无线设备</div>
      )}
    </div>
  )

  return (
    <FlipTile
      area="devices"
      label="设备"
      meta={
        ready
          ? `USB ${usb.length} · 蓝牙 ${bluetooth.length}${lowest == null ? '' : ` · 最低 ${lowest}%`}`
          : '采样中'
      }
      backLabel="电量"
      backMeta={
        ready
          ? `${battery && Number.isFinite(battery.percent) ? `系统 ${battery.percent}%` : '无电池'}${
              wireless.length ? ` · 无线 ${wireless.length}` : ''
            }`
          : '采样中'
      }
      back={back}
      front={
        !ready ? (
          <MetricSkeleton />
        ) : total === 0 && !battery ? (
          <div className="ds-empty">未发现已连接设备</div>
        ) : (
          <div className="ds-grid">
            {receivers.length ? (
              <DeviceSection
                title="2.4G 接收器"
                tone="wired"
                items={receivers}
                onToggle={onToggle}
                pending={pending}
              />
            ) : null}
            {wired.length ? (
              <DeviceSection
                title="有线 / USB"
                tone="wired"
                items={wired}
                onToggle={onToggle}
                pending={pending}
              />
            ) : null}
            {!receivers.length && !wired.length ? (
              <DeviceSection title="USB / 接收器" tone="wired" items={usb} onToggle={onToggle} pending={pending} />
            ) : null}
            <DeviceSection title="蓝牙" tone="bt" items={bluetooth} battery={battery} />
          </div>
        )
      }
    />
  )
})

export const Processes = memo(function Processes({ list, ready }) {  const [expanded, setExpanded] = useState(false)
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


const AGENT_PRESETS = [
  {
    label: '一键优化',
    prompt: '立即执行一键优化：整理内存占用最高进程的工作集，并降低 CPU 占用最高进程的优先级。',
  },
  {
    label: '内存清理',
    prompt: '立即清理内存：整理内存占用最高的几个进程的工作集（trim-process），不要只给建议。',
  },
  {
    label: 'CPU 降载',
    prompt: '立即降低 CPU 负载：把 CPU 占用最高的进程优先级设为 below 或 idle（set-priority），不要只给建议。',
  },
  {
    label: '磁盘检查',
    prompt: '检查磁盘空间和占用情况，报告最占空间的盘和异常。',
  },
]

export const Agent = memo(function Agent({ agent, ready, state = {}, onAnalyze, onReset }) {
  const loading = state.state === 'loading'
  const executed = Array.isArray(state.executed) ? state.executed : []
  const doneCount = executed.filter((item) => item.ok).length
  const result = state.result
  const error = state.error
  const busy = loading

  const riskLabel = { low: '低风险', medium: '中风险', high: '高风险' }

  return (
    <Tile
      area="agent"
      label="AI 助手"
      meta={agent?.enabled ? `${agent.model} · ${agent.permission === 'safe' ? '自动' : '仅建议'}` : '未配置'}
    >
      {!agent?.enabled ? (
        <div className="agent-empty">在管理页启用 Agent 网关后，可分析当前性能并给出优化建议。</div>
      ) : !ready ? (
        <MetricSkeleton />
      ) : loading ? (
        <div className="agent-loading">
          <span className="spinner" />
          正在分析实时指标…
        </div>
      ) : result ? (
        <div className="agent-result">
          <div className="agent-summary">
            <span className={`agent-risk ${result.risk || 'low'}`}>
              {riskLabel[result.risk] || '低风险'}
            </span>
            <span className="agent-summary-text">{result.summary}</span>
          </div>
          <div className="agent-tags">
            {result.actions?.length ? (
              result.actions.map((action, index) => {
                const item = executed[index]
                const status = item ? (item.ok ? 'done' : 'failed') : 'pending'
                return (
                  <span
                    className={`agent-tag is-${status}`}
                    key={`${action.type}-${action.pid || action.command || action.percent || index}`}
                    title={action.reason || action.label}
                  >
                    {action.label}
                  </span>
                )
              })
            ) : (
              <span className="agent-none">暂无需要执行的动作</span>
            )}
          </div>
          <div className="agent-actions">
            <span className="agent-auto">
              {executed.length
                ? `已执行 ${doneCount}/${executed.length} 个动作`
                : agent?.permission !== 'safe'
                  ? '仅建议模式，未自动执行'
                  : '未执行优化动作'}
            </span>
            <button type="button" className="agent-reset" onClick={onReset} disabled={busy}>
              重新分析
            </button>
          </div>
        </div>
      ) : (
        <div className="agent-presets">
          {AGENT_PRESETS.map((preset) => (
            <button
              type="button"
              className="agent-preset"
              key={preset.label}
              disabled={busy}
              onClick={() => onAnalyze(preset.prompt)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <div className="agent-error" role="alert">
          <span className="ellipsis" title={error}>
            {error}
          </span>
          <button type="button" onClick={onReset}>
            重试
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
  const watts = Number.isFinite(power?.watts) ? power.watts : null
  const whole = !!power?.whole
  const cpuWatts = !present && Number.isFinite(power?.cpuWatts) ? power.cpuWatts : null
  const gpuWatts = !present && Number.isFinite(power?.gpuWatts) ? power.gpuWatts : null
  const memWatts = !present && Number.isFinite(power?.memWatts) ? power.memWatts : null
  const level = percent == null ? '' : percent <= 15 ? 'danger' : percent <= 30 ? 'warn' : 'ok'
  const detail = present
    ? charging
      ? '正在充电'
      : '电池供电'
    : watts != null
      ? whole
        ? '整机'
        : '部件功耗'
      : '交流供电'
  const breakdown = [
    cpuWatts == null ? '' : `CPU ${cpuWatts} W`,
    gpuWatts == null ? '' : `显卡 ${gpuWatts} W`,
    memWatts == null ? '' : `内存 ${memWatts} W`,
  ]
    .filter(Boolean)
    .join(' · ')
  const voltages = power?.voltages || {}
  const voltageText = [
    Number.isFinite(voltages.cpu) ? `CPU ${voltages.cpu} V` : '',
    Number.isFinite(voltages.gpu) ? `显卡 ${voltages.gpu} V` : '',
    Number.isFinite(voltages.mem) ? `内存 ${voltages.mem} V` : '',
    Number.isFinite(voltages.p12) ? `+12V ${voltages.p12} V` : '',
    Number.isFinite(voltages.p5) ? `+5V ${voltages.p5} V` : '',
    Number.isFinite(voltages.p3) ? `+3.3V ${voltages.p3} V` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const batteryVolts = Number.isFinite(voltages.battery) ? voltages.battery : null

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
          <div className="tile-sub">
            {watts != null
              ? `${charging ? '充电功率' : '整机功耗'} ${watts} W`
              : charging
                ? '外接电源 · 充电中'
                : '使用电池供电'}
            {batteryVolts != null ? ` · 电池 ${batteryVolts} V` : ''}
          </div>
        </>
      ) : watts != null ? (
        <>
          <div className="big-value">
            {watts}
            <span className="unit"> W</span>
          </div>
          {breakdown ? <div className="tile-sub">{breakdown}</div> : null}
          {voltageText ? (
            <div className="tile-sub power-voltages">电压 {voltageText}</div>
          ) : null}
          <div className="tile-sub">{whole ? '整机功耗传感器' : '仅统计可测部件'}</div>
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

export const Fan = memo(function Fan({ fan, ready, state = {}, onFanPreset }) {
  const available = !!fan?.available
  const fans = available ? fan.fans || [] : []
  const controls = available ? fan.controls || [] : []
  const top = fans[0]
  const pending = state.state === 'pending'
  const auto = state.state === 'ok' && state.percent == null
  const primary = controls.find((item) => !/pump/i.test(item.name)) || controls[0]
  const currentPercent = primary ? Math.round(primary.value) : null
  const [draft, setDraft] = useState(currentPercent)
  const draftRef = useRef(currentPercent)
  const applyTimerRef = useRef(null)
  const applied = Number.isFinite(state.percent) ? state.percent : currentPercent
  const dirty = Number.isFinite(draft) && Number.isFinite(applied) && draft !== applied

  // 采样刷新时不覆盖尚未下发的加减结果
  useEffect(() => {
    if (pending || dirty) return
    const next = Number.isFinite(state.percent) ? state.percent : currentPercent
    setDraft(next)
    draftRef.current = next
  }, [currentPercent, dirty, pending, state.percent])

  useEffect(() => () => clearTimeout(applyTimerRef.current), [])

  // 加减后短暂防抖再下发，连续点击只发送最终值；按钮比滑杆更不容易误触
  const step = (delta) => {
    if (pending || !controls.length) return
    const base = Number.isFinite(draftRef.current) ? draftRef.current : currentPercent
    if (!Number.isFinite(base)) return
    const next = Math.max(0, Math.min(100, base + delta))
    if (next === base) return
    setDraft(next)
    draftRef.current = next
    clearTimeout(applyTimerRef.current)
    applyTimerRef.current = setTimeout(() => onFanPreset?.(next), 800)
  }

  const restoreAuto = () => {
    clearTimeout(applyTimerRef.current)
    onFanPreset?.(null)
  }

  return (
    <Tile
      area="fan"
      label="风扇"
      meta={!ready ? '采样中' : pending ? '设置中…' : available ? `${fans.length} 路转速` : '未连接'}
    >
      {!ready ? (
        <MetricSkeleton />
      ) : available ? (
        <>
          <div className="fan-top">
            <div className="big-value">
              {top ? Math.round(top.value) : '--'}
              <span className="unit"> RPM</span>
            </div>
            {currentPercent != null ? <span className="fan-current">{currentPercent}%</span> : null}
          </div>
          {fans.length ? (
            <div className="fan-list">
              {fans.slice(0, 3).map((item, index) => (
                <span className="fan-row" key={`${item.group}-${item.name}-${index}`}>
                  <span className="ellipsis">{item.name}</span>
                  <strong>{Math.round(item.value)}</strong>
                </span>
              ))}
            </div>
          ) : null}
          <div className="fan-control">
            <div className="fan-stepper" role="group" aria-label="风扇转速">
              <button
                type="button"
                className="fan-step"
                aria-label="降低转速"
                disabled={pending || !controls.length || (draft ?? 0) <= 0}
                onClick={() => step(-5)}
              >
                −
              </button>
              <span className="fan-value" aria-live="polite">
                {pending ? '设置中…' : `${draft ?? '--'}%`}
              </span>
              <button
                type="button"
                className="fan-step"
                aria-label="提高转速"
                disabled={pending || !controls.length || (draft ?? 100) >= 100}
                onClick={() => step(5)}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={`fan-auto${auto ? ' is-active' : ''}`}
              disabled={pending || !controls.length}
              onClick={restoreAuto}
            >
              自动
            </button>
          </div>
          {state.state === 'error' ? <div className="tile-sub fan-error">{state.error}</div> : null}
        </>
      ) : (
        <div className="fan-offline">
          <div className="fan-offline-title">未检测到风扇数据</div>
          <div className="fan-offline-hint">
            安装并运行 LibreHardwareMonitor，在设置中开启远程 Web Server（8085）后自动读取
          </div>
        </div>
      )}
    </Tile>
  )
})

const SENSOR_TABS = [
  { key: 'temp', label: '温度' },
  { key: 'volt', label: '电压' },
  { key: 'cpu', label: 'CPU' },
  { key: 'storage', label: '存储' },
  { key: 'other', label: '其他' },
]

const fmtTemp = (value) => (Number.isFinite(value) ? `${value.toFixed(1)}°C` : '--')
const fmtVolt = (value) => (Number.isFinite(value) ? `${value.toFixed(2)} V` : '--')
const fmtMHz = (value) => (Number.isFinite(value) ? `${(value / 1000).toFixed(2)} GHz` : '--')
const fmtGB = (value) => (Number.isFinite(value) ? `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB` : '--')
const fmtHours = (hours) => {
  if (!Number.isFinite(hours)) return '--'
  const days = Math.max(0, Math.round(hours / 24))
  return days >= 365 ? `${(days / 365).toFixed(1)} 年` : `${days} 天`
}

const sensorTempLevel = (value) => {
  if (!Number.isFinite(value)) return ''
  if (value >= 90) return 'danger'
  if (value >= 70) return 'warn'
  return 'ok'
}

const voltLevel = (name, value) => {
  if (!Number.isFinite(value)) return ''
  if (/^\+?12\s*v$/i.test(name)) return value < 11.4 || value > 12.6 ? 'danger' : 'ok'
  if (/^\+?5\s*v$/i.test(name)) return value < 4.75 || value > 5.25 ? 'danger' : 'ok'
  if (/^(avcc3|\+?3(?:\.3)?\s*v)$/i.test(name)) return value < 3.14 || value > 3.47 ? 'warn' : 'ok'
  if (/cmos battery/i.test(name)) return value < 2.8 ? 'danger' : value < 3 ? 'warn' : 'ok'
  return ''
}

function sensorLabel(item) {
  if (item.group === 'cpu' && !/^cpu/i.test(item.name)) return `CPU ${item.name}`
  if (item.group === 'gpu' && !/^gpu/i.test(item.name)) return `GPU ${item.name}`
  if (item.group === 'board') return `主板 ${item.name}`
  if (item.group === 'storage') return `${item.hardware} ${item.name}`
  return item.name
}

export const Sensors = memo(function Sensors({ sensors, ready }) {
  const [tab, setTab] = useState('temp')
  const available = !!sensors?.available
  const temperatures = sensors?.temperatures || []
  const voltages = sensors?.voltages || []
  const cpu = sensors?.cpu || null
  const gpus = sensors?.gpus || []
  const disks = sensors?.disks || []
  const memory = sensors?.memory || { modules: [] }
  const networks = sensors?.networks || []
  const fans = sensors?.fans || []
  const total =
    temperatures.length +
    voltages.length +
    (cpu?.cores?.length || 0) +
    disks.length +
    gpus.length +
    networks.length +
    fans.length

  return (
    <Tile
      area="sensors"
      label="硬件详情"
      meta={!ready ? '采样中' : available ? `${total} 项 · 每 60 秒` : '未连接'}
      className="tile--sensors"
    >
      {!ready ? (
        <MetricSkeleton />
      ) : !available ? (
        <div className="fan-offline">
          <div className="fan-offline-title">未检测到硬件传感器</div>
          <div className="fan-offline-hint">
            安装并运行 LibreHardwareMonitor，开启远程 Web Server（8085）后自动读取
          </div>
        </div>
      ) : (
        <>
          <div className="sensors-tabs" role="tablist" aria-label="硬件详情分类">
            {SENSOR_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`sensors-tab${tab === item.key ? ' is-active' : ''}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="sensors-body">
            {tab === 'temp' ? (
              temperatures.length ? (
                <div className="sensors-grid">
                  {temperatures.map((item, index) => (
                    <div className="sensor-row" key={`${item.hardware}-${item.name}-${index}`}>
                      <span className="sensor-name ellipsis">{sensorLabel(item)}</span>
                      <strong className={`sensor-value ${sensorTempLevel(item.value)}`}>
                        {fmtTemp(item.value)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="sensors-empty">没有读取到温度传感器</span>
              )
            ) : null}

            {tab === 'volt' ? (
              voltages.length ? (
                <div className="sensors-grid">
                  {voltages.map((item, index) => (
                    <div className="sensor-row" key={`${item.hardware}-${item.name}-${index}`}>
                      <span className="sensor-name ellipsis">{item.name}</span>
                      <strong className={`sensor-value ${voltLevel(item.name, item.value)}`}>
                        {fmtVolt(item.value)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="sensors-empty">没有读取到电压传感器</span>
              )
            ) : null}

            {tab === 'cpu' ? (
              cpu ? (
                <>
                  <div className="sensor-stats">
                    <span>
                      <em>最高</em>
                      <strong className={sensorTempLevel(cpu.coreMax)}>{fmtTemp(cpu.coreMax)}</strong>
                    </span>
                    <span>
                      <em>平均</em>
                      <strong className={sensorTempLevel(cpu.coreAverage)}>{fmtTemp(cpu.coreAverage)}</strong>
                    </span>
                    <span>
                      <em>封装</em>
                      <strong className={sensorTempLevel(cpu.packageTemp)}>{fmtTemp(cpu.packageTemp)}</strong>
                    </span>
                    <span>
                      <em>功耗</em>
                      <strong>{Number.isFinite(cpu.powerWatts) ? `${cpu.powerWatts} W` : '--'}</strong>
                    </span>
                  </div>
                  <div className="cpu-cores">
                    {cpu.cores.map((core) => (
                      <div className="cpu-core" key={core.index}>
                        <span className="cpu-core-name">C{core.index}</span>
                        <span className={sensorTempLevel(core.temp)}>{fmtTemp(core.temp)}</span>
                        <span>{fmtMHz(core.clockMHz)}</span>
                        <span>{Number.isFinite(core.voltage) ? `${core.voltage.toFixed(2)} V` : '--'}</span>
                        <span title="距 TjMax 的温度余量">
                          {Number.isFinite(core.tjMax) ? `${core.tjMax.toFixed(0)}° 余量` : '--'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <span className="sensors-empty">没有读取到 CPU 传感器</span>
              )
            ) : null}

            {tab === 'storage' ? (
              <>
                {disks.map((disk) => (
                  <div className="sensor-disk" key={disk.name}>
                    <div className="sensor-disk-head">
                      <span className="ellipsis">{disk.name}</span>
                      <strong className={sensorTempLevel(disk.temp)}>{fmtTemp(disk.temp)}</strong>
                    </div>
                    <div className="sensor-disk-meta">
                      {Number.isFinite(disk.life) ? <span>寿命 {Math.round(disk.life)}%</span> : null}
                      {Number.isFinite(disk.powerOnHours) ? (
                        <span>通电 {fmtHours(disk.powerOnHours)}</span>
                      ) : null}
                      {Number.isFinite(disk.readRate) || Number.isFinite(disk.writeRate) ? (
                        <span>
                          读 {formatRate(disk.readRate)} · 写 {formatRate(disk.writeRate)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!disks.length ? <span className="sensors-empty">没有读取到硬盘传感器</span> : null}

                <div className="sensor-memory">
                  {memory.total ? (
                    <div className="sensor-row">
                      <span className="sensor-name">物理内存</span>
                      <strong className="sensor-value">
                        {Number.isFinite(memory.total.load) ? `${memory.total.load}%` : '--'}
                        {Number.isFinite(memory.total.usedGB) && Number.isFinite(memory.total.availableGB)
                          ? ` · 已用 ${fmtGB(memory.total.usedGB)} / 可用 ${fmtGB(memory.total.availableGB)}`
                          : ''}
                      </strong>
                    </div>
                  ) : null}
                  {memory.virtual ? (
                    <div className="sensor-row">
                      <span className="sensor-name">虚拟内存</span>
                      <strong className="sensor-value">
                        {Number.isFinite(memory.virtual.load) ? `${memory.virtual.load}%` : '--'}
                        {Number.isFinite(memory.virtual.usedGB)
                          ? ` · 已用 ${fmtGB(memory.virtual.usedGB)}`
                          : ''}
                      </strong>
                    </div>
                  ) : null}
                  {memory.modules.map((module) => (
                    <div className="sensor-row" key={module.name}>
                      <span className="sensor-name ellipsis">{module.name}</span>
                      <strong className="sensor-value">
                        {[
                          fmtGB(module.capacityGB),
                          Number.isFinite(module.speedMHz) ? `${module.speedMHz} MHz` : '',
                          Number.isFinite(module.cas) ? `CL${module.cas}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </strong>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {tab === 'other' ? (
              <div className="sensor-groups">
                <div className="sensor-group">
                  <span className="sensor-group-title">显卡</span>
                  {gpus.map((gpu) => (
                    <div className="sensor-line" key={gpu.name}>
                      <span className="ellipsis">{gpu.name}</span>
                      <span>
                        {fmtTemp(gpu.coreTemp)}
                        {Number.isFinite(gpu.hotspotTemp) ? ` · 热点 ${fmtTemp(gpu.hotspotTemp)}` : ''}
                        {Number.isFinite(gpu.powerWatts) ? ` · ${gpu.powerWatts} W` : ''}
                        {Number.isFinite(gpu.memoryUsedMB) && Number.isFinite(gpu.memoryTotalMB)
                          ? ` · 显存 ${gpu.memoryUsedMB}/${gpu.memoryTotalMB} MB`
                          : ''}
                      </span>
                    </div>
                  ))}
                  {!gpus.length ? <span className="sensors-empty">没有读取到显卡传感器</span> : null}
                </div>

                <div className="sensor-group">
                  <span className="sensor-group-title">风扇</span>
                  {fans.map((fan) => (
                    <div className="sensor-line" key={fan.name}>
                      <span className="ellipsis">{fan.name}</span>
                      <span>
                        {Number.isFinite(fan.rpm) ? `${fan.rpm} RPM` : '--'}
                        {Number.isFinite(fan.percent) ? ` · ${fan.percent}%` : ''}
                      </span>
                    </div>
                  ))}
                  {!fans.length ? <span className="sensors-empty">没有读取到风扇传感器</span> : null}
                </div>

                <div className="sensor-group">
                  <span className="sensor-group-title">网卡</span>
                  {networks.map((net) => (
                    <div className="sensor-line" key={net.name}>
                      <span className="ellipsis">{net.name}</span>
                      <span>
                        ↓ {formatRate(net.rx)} · ↑ {formatRate(net.tx)}
                      </span>
                    </div>
                  ))}
                  {!networks.length ? <span className="sensors-empty">没有读取到网卡传感器</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        </>
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
  moon: MoonIcon,
}

export const Shortcuts = memo(function Shortcuts({ actions = [], states, onAction, onClearError }) {
  const errorEntry = Object.entries(states).find(([, s]) => s?.state === 'error')
  const [errorId, error] = errorEntry || []

  return (
    <Tile area="keys" label="快捷操作" meta={actions.length ? '点击执行' : '待配置'}>
      {actions.length ? (
        <div className={`keys${actions.length > 6 ? ' keys--dense' : ''}`}>
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
                onClick={() => onAction(id, label, kind)}
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

const DEV_STATUS = {
  healthy: { text: '健康', tone: 'ok' },
  open: { text: '非 HTTP', tone: 'warn' },
  error: { text: '异常', tone: 'bad' },
  closed: { text: '未响应', tone: 'muted' },
}

const PROC_STATUS = {
  running: { text: '运行中', tone: 'ok' },
  starting: { text: '启动中', tone: 'warn' },
  exited: { text: '已退出', tone: 'muted' },
  error: { text: '启动失败', tone: 'bad' },
  idle: { text: '未启动', tone: 'muted' },
}

function formatMem(bytes) {
  const value = Number(bytes) || 0
  if (value <= 0) return ''
  return `${(value / 1024 / 1024).toFixed(0)} MB`
}

// 日志浮窗：固定在右下角，随 WS 增量滚动，只在打开时补齐历史
function DevLogPanel({ title, tone, lines = [], onClose }) {
  const bodyRef = useRef(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const node = bodyRef.current
    if (!node || !pinned) return
    node.scrollTop = node.scrollHeight
  }, [lines, pinned])

  const onScroll = () => {
    const node = bodyRef.current
    if (!node) return
    setPinned(node.scrollHeight - node.scrollTop - node.clientHeight < 40)
  }

  return (
    <div className="log-panel" role="dialog" aria-label={`${title} 日志`}>
      <header className="log-head">
        <span className={`dev-dot is-${tone}`} aria-hidden="true" />
        <span className="log-title">{title}</span>
        <span className="log-meta">{lines.length} 行</span>
        {pinned ? null : (
          <button type="button" className="log-btn" onClick={() => setPinned(true)}>
            回到底部
          </button>
        )}
        <button type="button" className="log-btn" onClick={onClose} aria-label="关闭日志">
          关闭
        </button>
      </header>
      <div className="log-body" ref={bodyRef} onScroll={onScroll}>
        {lines.length ? (
          lines.map((line) => (
            <div key={line.n ?? `${line.t}-${line.text}`} className={`log-line is-${line.s || 'out'}`}>
              {line.text}
            </div>
          ))
        ) : (
          <div className="log-empty">暂无输出，启动服务后这里会实时滚动</div>
        )}
      </div>
    </div>
  )
}

export const Dev = memo(function Dev({
  state = {},
  lanHost = '',
  onScan,
  onStop,
  onOpenComputer,
  onKillError,
  services = [],
  proc = [],
  logs = {},
  onStartService,
  onStopService,
  onLoadLogs,
}) {
  const [confirm, setConfirm] = useState(null)
  const [side, setSide] = useState('ports')
  const [logTarget, setLogTarget] = useState(null)
  const [pendingService, setPendingService] = useState('')

  const ports = Array.isArray(state.ports) ? state.ports : []
  const scanning = state.state === 'pending'
  const scanned = state.state === 'ok'

  useEffect(() => {
    if (!confirm) return undefined
    const timer = setTimeout(() => setConfirm(null), 6000)
    return () => clearTimeout(timer)
  }, [confirm])

  // 服务被删除或页面切换后自动关闭浮窗，避免停留在空日志上
  useEffect(() => {
    if (!logTarget) return
    if (!services.some((item) => item.id === logTarget)) setLogTarget(null)
  }, [logTarget, services])

  const procOf = (id) => proc.find((item) => item.id === id) || null
  const running = proc.filter((item) => item.status === 'running' || item.status === 'starting').length

  const meta =
    side === 'ports'
      ? scanning
        ? '扫描中…'
        : scanned
          ? `${ports.length} 个端口`
          : '未扫描'
      : `${running}/${services.length} 运行中`

  const openLog = (id) => {
    setLogTarget(id)
    onLoadLogs?.(id)
  }

  const renderPorts = () => (
    <>
      <div className="dev-bar">
        <button type="button" className="dev-scan" onClick={onScan} disabled={scanning}>
          {scanning ? '扫描中…' : '重新扫描'}
        </button>
        <span className="dev-hint">
          {scanned ? '点击端口查看实时日志' : '进入页面自动扫描一次，端口变化后请手动刷新'}
        </span>
      </div>

      {state.error ? (
        <div className="keys-alert" role="alert">
          <span title={state.error}>{state.error}</span>
          <button type="button" onClick={onKillError} aria-label="关闭错误提示">
            知道了
          </button>
        </div>
      ) : null}

      {scanning && !ports.length ? (
        <div className="dev-empty">正在扫描本机监听端口…</div>
      ) : ports.length ? (
        <div className="dev-list">
          {ports.map((item) => {
            const status = DEV_STATUS[item.status] || DEV_STATUS.closed
            const busy = state.pendingPid === item.pid
            const asking = confirm === item.pid
            const linked = services.find((service) => service.port === item.port)
            return (
              <div key={`${item.port}-${item.pid}`} className={`dev-row is-${status.tone}`}>
                <button
                  type="button"
                  className="dev-port"
                  onClick={() => linked && openLog(linked.id)}
                  disabled={!linked}
                  title={linked ? `查看 ${linked.name} 实时日志` : '该端口未关联开发服务'}
                >
                  <span className="dev-port-num">{item.port}</span>
                  <span className={`dev-dot is-${status.tone}`} aria-hidden="true" />
                </button>

                <div className="dev-main">
                  <div className="dev-title">
                    <span className="dev-name">{item.label}</span>
                    <span className={`dev-badge is-${status.tone}`}>{status.text}</span>
                    {item.lan ? <span className="dev-badge is-lan">对外</span> : null}
                  </div>
                  <div className="dev-sub">
                    <span>{item.name || '未知进程'}</span>
                    <span className="dev-sep">·</span>
                    <span>PID {item.pid || '—'}</span>
                    {formatMem(item.mem) ? (
                      <>
                        <span className="dev-sep">·</span>
                        <span>{formatMem(item.mem)}</span>
                      </>
                    ) : null}
                    {item.statusCode ? (
                      <>
                        <span className="dev-sep">·</span>
                        <span>HTTP {item.statusCode}</span>
                      </>
                    ) : null}
                    {Number.isFinite(item.latency) && item.status !== 'closed' ? (
                      <>
                        <span className="dev-sep">·</span>
                        <span>{item.latency} ms</span>
                      </>
                    ) : null}
                  </div>
                  {item.cmd ? (
                    <div className="dev-cmd" title={item.cmd}>
                      {item.cmd}
                    </div>
                  ) : null}
                </div>

                <div className="dev-actions">
                  {item.status === 'healthy' || item.status === 'open' ? (
                    <>
                      <button
                        type="button"
                        className="dev-open"
                        onClick={() => onOpenComputer?.(item.port)}
                        title={`在电脑浏览器打开 127.0.0.1:${item.port}`}
                      >
                        电脑
                      </button>
                      {item.lan && lanHost ? (
                        <a
                          className="dev-open"
                          href={`http://${lanHost}:${item.port}/`}
                          target="_blank"
                          rel="noreferrer"
                          title={`在平板/手机浏览器打开 ${lanHost}:${item.port}`}
                        >
                          平板
                        </a>
                      ) : (
                        <span
                          className="dev-open is-off"
                          title={lanHost ? '该服务未监听 0.0.0.0，局域网无法访问' : '未获取到本机局域网地址'}
                        >
                          平板
                        </span>
                      )}
                    </>
                  ) : null}
                  {asking ? (
                    <>
                      <button
                        type="button"
                        className="dev-kill is-danger"
                        onClick={() => {
                          setConfirm(null)
                          onStop?.(item)
                        }}
                        disabled={busy}
                      >
                        {busy ? '结束中…' : '确认结束'}
                      </button>
                      <button type="button" className="dev-kill" onClick={() => setConfirm(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="dev-kill"
                      onClick={() => setConfirm(item.pid)}
                      disabled={busy || item.protected || !item.pid}
                      title={item.protected ? '系统进程，不允许结束' : `结束 ${item.name} (PID ${item.pid})`}
                    >
                      {busy ? '结束中…' : '结束'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="dev-empty">{scanned ? '没有发现正在运行的开发端口' : '尚未扫描'}</div>
      )}
    </>
  )

  const renderServices = () => {
    if (!services.length) {
      return <div className="dev-empty">还没有配置开发服务，请在本机设置页添加</div>
    }
    return (
      <div className="dev-list">
        {services.map((service) => {
          const info = procOf(service.id)
          const status = PROC_STATUS[info?.status] || PROC_STATUS.idle
          const live = info?.status === 'running' || info?.status === 'starting'
          const busy = pendingService === service.id
          return (
            <div key={service.id} className={`dev-row is-${status.tone}`}>
              <button
                type="button"
                className="dev-port"
                onClick={() => openLog(service.id)}
                title={`查看 ${service.name} 实时日志`}
              >
                <span className="dev-port-num">{service.port || '—'}</span>
                <span className={`dev-dot is-${status.tone}`} aria-hidden="true" />
              </button>

              <div className="dev-main">
                <div className="dev-title">
                  <span className="dev-name">{service.name}</span>
                  <span className={`dev-badge is-${status.tone}`}>{status.text}</span>
                  {info?.pid ? <span className="dev-badge is-lan">PID {info.pid}</span> : null}
                </div>
                <div className="dev-sub">
                  <span>{info?.lastLine || '尚未启动'}</span>
                </div>
              </div>

              <div className="dev-actions">
                <button type="button" className="dev-open" onClick={() => openLog(service.id)}>
                  日志
                </button>
                {live ? (
                  <button
                    type="button"
                    className="dev-kill is-danger"
                    disabled={busy}
                    onClick={async () => {
                      setPendingService(service.id)
                      await onStopService?.(service.id)
                      setPendingService('')
                    }}
                  >
                    {busy ? '停止中…' : '停止'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dev-kill is-start"
                    disabled={busy}
                    onClick={async () => {
                      setPendingService(service.id)
                      await onStartService?.(service.id)
                      setPendingService('')
                    }}
                  >
                    {busy ? '启动中…' : '启动'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const logService = logTarget ? services.find((item) => item.id === logTarget) : null
  const logProc = logTarget ? procOf(logTarget) : null
  const logStatus = PROC_STATUS[logProc?.status] || PROC_STATUS.idle

  return (
    <section className="tile tile--dev">
      <header className="tile-head">
        <span className="tile-label">开发视图</span>
        <span className="tile-meta">{meta}</span>
        <div className="tile-switch" role="tablist" aria-label="开发视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={side === 'ports'}
            className={side === 'ports' ? 'active' : ''}
            onClick={() => setSide('ports')}
          >
            端口
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={side === 'services'}
            className={side === 'services' ? 'active' : ''}
            onClick={() => setSide('services')}
          >
            服务
          </button>
        </div>
      </header>

      <div className={`dev-stage is-${side}`}>
        <div className="dev-face">{renderPorts()}</div>
        <div className="dev-face">{renderServices()}</div>
      </div>

      {logService ? (
        <DevLogPanel
          title={`${logService.name}${logService.port ? ` · ${logService.port}` : ''}`}
          tone={logStatus.tone}
          lines={logs[logService.id] || []}
          onClose={() => setLogTarget(null)}
        />
      ) : null}
    </section>
  )
})
