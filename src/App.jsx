import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePanel } from './usePanel.js'
import { Clock, Cpu, Disk, Gpu, Media, Memory, Network, Shortcuts } from './widgets.jsx'
import InstallHint from './InstallHint.jsx'
import { CloseIcon, FullscreenIcon, RefreshIcon, SunIcon, ThemeIcon } from './icons.jsx'
import { formatClock, formatUptime } from './utils.js'

const STATUS_TEXT = {
  connecting: '连接中',
  online: '在线',
  weak: '数据延迟',
  offline: '离线',
}

const FALLBACK_PAGE = {
  id: 'main',
  name: '主页',
  components: ['clock', 'cpu', 'memory', 'disk', 'network', 'shortcuts'],
}

const THEME_KEY = 'panel-theme'
const THEME_COLOR = { dark: '#0b0f14', light: '#eef1f5' }

export default function App() {
  const { metrics, info, actions, layout, media, status, lastUpdate, reconnect } = usePanel()
  const [toasts, setToasts] = useState([])
  const [actionStates, setActionStates] = useState({})
  const [mediaStates, setMediaStates] = useState({})
  const [activePage, setActivePage] = useState(0)
  const [offlineDismissed, setOfflineDismissed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)
  const [wake, setWake] = useState(false)
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'))

  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [])
  const ready = !!metrics

  const toastIdRef = useRef(0)
  const toastTimers = useRef(new Map())
  const pendingActions = useRef(new Set())
  const actionTimers = useRef(new Map())
  const pendingMedia = useRef(new Set())
  const mediaTimers = useRef(new Map())
  const controllers = useRef(new Set())
  const aliveRef = useRef(true)
  const wakeRef = useRef(null)
  const swipeRef = useRef(null)

  const dismissToast = useCallback((id) => {
    const timer = toastTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimers.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (type, text, ttl = 2400) => {
      const id = ++toastIdRef.current
      const item = { id, type, text }
      setToasts((prev) => [...prev.slice(-2), item])
      const timer = setTimeout(() => {
        toastTimers.current.delete(id)
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, ttl)
      toastTimers.current.set(id, timer)
    },
    []
  )

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      toastTimers.current.forEach((t) => clearTimeout(t))
      toastTimers.current.clear()
      actionTimers.current.forEach((t) => clearTimeout(t))
      actionTimers.current.clear()
      mediaTimers.current.forEach((t) => clearTimeout(t))
      mediaTimers.current.clear()
      controllers.current.forEach((c) => c.abort())
      controllers.current.clear()
      if (wakeRef.current) {
        wakeRef.current.release?.().catch(() => {})
        wakeRef.current = null
      }
    }
  }, [])

  const clearActionTimer = useCallback((id) => {
    const timer = actionTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      actionTimers.current.delete(id)
    }
  }, [])

  const runAction = useCallback(
    async (id, label) => {
      if (pendingActions.current.has(id)) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法执行操作')
        return
      }

      pendingActions.current.add(id)
      clearActionTimer(id)
      setActionStates((prev) => ({ ...prev, [id]: { state: 'pending' } }))

      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 8000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/action${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `请求失败（${res.status}）`)
        }
        if (!aliveRef.current) return
        setActionStates((prev) => ({ ...prev, [id]: { state: 'ok' } }))
        pushToast('success', `已执行：${label}`)
        const timer = setTimeout(() => {
          actionTimers.current.delete(id)
          setActionStates((prev) => {
            if (prev[id]?.state !== 'ok') return prev
            const next = { ...prev }
            delete next[id]
            return next
          })
        }, 1600)
        actionTimers.current.set(id, timer)
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError'
            ? '请求超时，请检查电脑端是否仍在运行'
            : err.message || '操作失败'
        setActionStates((prev) => ({ ...prev, [id]: { state: 'error', message } }))
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        pendingActions.current.delete(id)
      }
    },
    [clearActionTimer, pushToast, status, token]
  )

  const clearActionError = useCallback((id) => {
    setActionStates((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const runMedia = useCallback(
    async (command) => {
      if (pendingMedia.current.has(command)) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法控制媒体')
        return
      }

      pendingMedia.current.add(command)
      const prevTimer = mediaTimers.current.get(command)
      if (prevTimer) {
        clearTimeout(prevTimer)
        mediaTimers.current.delete(command)
      }
      setMediaStates((prev) => ({ ...prev, [command]: 'pending' }))

      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 8000)
      const clearState = (delay) => {
        const timer = setTimeout(() => {
          mediaTimers.current.delete(command)
          setMediaStates((prev) => {
            if (!prev[command]) return prev
            const next = { ...prev }
            delete next[command]
            return next
          })
        }, delay)
        mediaTimers.current.set(command, timer)
      }

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/media${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `请求失败（${res.status}）`)
        if (!aliveRef.current) return
        setMediaStates((prev) => ({ ...prev, [command]: 'ok' }))
        clearState(800)
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError' ? '媒体指令超时，请检查电脑端是否仍在运行' : err.message || '媒体指令失败'
        setMediaStates((prev) => ({ ...prev, [command]: 'error' }))
        pushToast('error', message)
        clearState(2200)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        pendingMedia.current.delete(command)
      }
    },
    [pushToast, status, token]
  )

  // 全屏 / 屏幕常亮
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const attachWake = useCallback((sentinel) => {
    wakeRef.current = sentinel
    setWake(true)
    sentinel.addEventListener('release', () => {
      if (wakeRef.current === sentinel) {
        wakeRef.current = null
        setWake(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!wake) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || wakeRef.current) return
      if (!('wakeLock' in navigator)) return
      navigator.wakeLock
        .request('screen')
        .then(attachWake)
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [attachWake, wake])

  // 主题切换
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* 隐私模式下忽略写入失败 */
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const toggleDisplay = useCallback(async () => {
    const active = !!document.fullscreenElement || !!wakeRef.current

    if (active) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
      } catch {
        /* 忽略退出全屏失败 */
      }
      const sentinel = wakeRef.current
      wakeRef.current = null
      setWake(false)
      if (sentinel) await sentinel.release().catch(() => {})
      pushToast('info', '已退出全屏常亮')
      return
    }

    try {
      await document.documentElement.requestFullscreen()
    } catch (err) {
      pushToast('error', `无法进入全屏：${err.message}`)
      return
    }

    let canWake = false
    if ('wakeLock' in navigator) {
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        attachWake(sentinel)
        canWake = true
      } catch {
        /* 浏览器拒绝常亮时保持全屏 */
      }
    }
    pushToast(canWake ? 'success' : 'info', canWake ? '已进入全屏并保持常亮' : '已进入全屏，未能保持常亮')
  }, [attachWake, pushToast])

  const retry = useCallback(() => {
    setOfflineDismissed(false)
    reconnect()
    pushToast('info', '正在重新连接…')
  }, [pushToast, reconnect])

  useEffect(() => {
    if (status !== 'offline') setOfflineDismissed(false)
  }, [status])

  const displayLabel = wake
    ? isFullscreen
      ? '全屏常亮中'
      : '常亮中'
    : isFullscreen
      ? '全屏中'
      : '全屏常亮'
  const lastSeen = lastUpdate ? formatClock(lastUpdate) : '尚未收到数据'
  const themeLabel = theme === 'light' ? '白色主题' : '深色主题'
  const themeAction = theme === 'light' ? '切换到深色主题' : '切换到白色极客主题'

  const pages = useMemo(() => {
    if (layout?.pages?.length) return layout.pages
    return [FALLBACK_PAGE]
  }, [layout])
  const pageIndex = Math.min(activePage, pages.length - 1)
  const page = pages[pageIndex]

  useEffect(() => {
    setActivePage((prev) => Math.min(prev, pages.length - 1))
  }, [pages.length])

  const changePage = useCallback(
    (delta) => {
      setActivePage((prev) => {
        const next = prev + delta
        return next < 0 || next >= pages.length ? prev : next
      })
    },
    [pages.length]
  )

  const onPointerDown = useCallback(
    (event) => {
      if (pages.length < 2) return
      if (event.target.closest('button, a, input, select, textarea')) return
      swipeRef.current = { x: event.clientX, y: event.clientY, t: Date.now() }
    },
    [pages.length]
  )

  const onPointerUp = useCallback(
    (event) => {
      const start = swipeRef.current
      swipeRef.current = null
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Date.now() - start.t > 900) return
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return
      changePage(dx < 0 ? 1 : -1)
    },
    [changePage]
  )

  const renderWidget = (id) => {
    switch (id) {
      case 'clock':
        return <Clock key="clock" />
      case 'cpu':
        return (
          <Cpu
            key="cpu"
            value={metrics?.cpu}
            cores={metrics?.cores}
            model={info?.cpu}
            temp={metrics?.temp}
            processCount={metrics?.processCount}
            ready={ready}
          />
        )
      case 'gpu':
        return <Gpu key="gpu" gpu={metrics?.gpu} ready={ready} />
      case 'memory':
        return <Memory key="memory" used={metrics?.memUsed} total={metrics?.memTotal} ready={ready} />
      case 'disk':
        return <Disk key="disk" disk={metrics?.disk} disks={metrics?.disks} ready={ready} />
      case 'network':
        return <Network key="network" rx={metrics?.rx} tx={metrics?.tx} ts={metrics?.ts} ready={ready} />
      case 'media':
        return (
          <Media
            key="media"
            media={media || { available: false, title: '', artist: '', album: '', status: 'closed' }}
            states={mediaStates}
            onCommand={runMedia}
          />
        )
      case 'shortcuts':
        return (
          <Shortcuts
            key="shortcuts"
            actions={actions}
            states={actionStates}
            onAction={runAction}
            onClearError={clearActionError}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`status ${status}`} aria-hidden="true" />
          <span className="brand-name">Desk Panel</span>
          <span className="host">{info?.host || '—'}</span>
          <span className={`conn-text ${status}`}>{STATUS_TEXT[status]}</span>
        </div>
        <div className="topbar-right">
          <span className="pill">{ready ? `运行 ${formatUptime(metrics?.uptime)}` : '运行 --'}</span>
          <button
            type="button"
            className={`ghost ${theme === 'light' ? 'active' : ''}`}
            onClick={toggleTheme}
            aria-pressed={theme === 'light'}
            aria-label={themeAction}
            title={themeAction}
          >
            <ThemeIcon size={15} />
            <span>{themeLabel}</span>
          </button>
          <button
            type="button"
            className={`ghost ${isFullscreen || wake ? 'active' : ''}`}
            onClick={toggleDisplay}
            aria-pressed={isFullscreen || wake}
            aria-label={displayLabel}
            title={displayLabel}
          >
            {wake ? <SunIcon size={15} /> : <FullscreenIcon size={15} />}
            <span>{displayLabel}</span>
          </button>
        </div>
      </header>

      {status === 'weak' ? (
        <div className="net-hint" role="status">
          数据延迟 · 最后更新 {lastUpdate ? formatClock(lastUpdate) : '--'}
        </div>
      ) : null}

      <InstallHint />

      {pages.length > 1 ? (
        <nav className="page-nav" aria-label="页面切换">
          <button
            type="button"
            className="page-arrow"
            onClick={() => changePage(-1)}
            disabled={pageIndex === 0}
            aria-label="上一页"
          >
            ‹
          </button>
          {pages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`page-dot ${index === pageIndex ? 'active' : ''}`}
              onClick={() => setActivePage(index)}
              aria-label={item.name}
              aria-current={index === pageIndex ? 'page' : undefined}
              title={item.name}
            />
          ))}
          <button
            type="button"
            className="page-arrow"
            onClick={() => changePage(1)}
            disabled={pageIndex === pages.length - 1}
            aria-label="下一页"
          >
            ›
          </button>
        </nav>
      ) : null}

      <main
        className="grid"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeRef.current = null
        }}
      >
        {page.components.map(renderWidget)}
      </main>

      {status === 'offline' && !offlineDismissed ? (
        <div className="overlay" role="alertdialog" aria-labelledby="offline-title">
          <div className="overlay-card">
            <strong id="offline-title">连接已断开</strong>
            <span>请确认电脑端代理仍在运行，或检查手机与电脑是否在同一网络。</span>
            <span className="overlay-meta">最后更新：{lastSeen}</span>
            <div className="overlay-actions">
              <button type="button" className="btn primary" onClick={retry}>
                <RefreshIcon size={15} />
                重试连接
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setOfflineDismissed(true)}
                disabled={!metrics}
              >
                查看缓存数据
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`} role="status">
            <span className="toast-text">{toast.text}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="关闭提示">
              <CloseIcon size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
