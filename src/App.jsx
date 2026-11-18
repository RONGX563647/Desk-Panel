import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePanel } from './usePanel.js'
import {
  Agent,
  Clock,
  Cpu,
  Devices,
  Disk,
  Fan,
  Gpu,
  Dev,
  Latency,
  Media,
  Memory,
  Network,
  Optimize,
  Power,
  Processes,
  Sensors,
  Shortcuts,
  System,
  Temp,
} from './widgets.jsx'
import InstallHint from './InstallHint.jsx'
import { CloseIcon, FullscreenIcon, SunIcon, ThemeIcon } from './icons.jsx'
import { formatClock, formatUptime, packRows, readAccessToken, wrapPage } from './utils.js'

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
const THEME_MANUAL_KEY = 'panel-theme-manual'
const THEME_COLOR = { dark: '#0b0f14', light: '#eef1f5' }

export default function App() {
  const { metrics, info, actions, layout, settings, media, dev, devLogs, loadDevLogs, status, lastUpdate, reconnect } =
    usePanel()
  const [toasts, setToasts] = useState([])
  const [actionStates, setActionStates] = useState({})
  const [mediaStates, setMediaStates] = useState({})
  const [optimizeStates, setOptimizeStates] = useState({})
  const [fanState, setFanState] = useState({ state: 'idle', percent: null, error: '' })
  const [agentState, setAgentState] = useState({ state: 'idle', result: null, error: '' })
  const [devState, setDevState] = useState({ state: 'idle', ports: [], error: '', pendingPid: 0 })
  const [pendingDevice, setPendingDevice] = useState('')
  const [screenOff, setScreenOff] = useState(false)
  const [activePage, setActivePage] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)
  const [wake, setWake] = useState(false)
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'))

  const token = useMemo(() => readAccessToken(), [])
  const ready = !!metrics

  const displayedActions = useMemo(() => {
    if (!screenOff) return actions || []
    let replaced = false
    return (actions || []).flatMap((action) => {
      if (action.kind !== 'monitor-off') return [action]
      if (replaced) return []
      replaced = true
      return [{ ...action, id: '__wake', label: '亮屏', kind: 'monitor-on' }]
    })
  }, [actions, screenOff])

  const toastIdRef = useRef(0)
  const toastTimers = useRef(new Map())
  const pendingActions = useRef(new Set())
  const actionTimers = useRef(new Map())
  const pendingMedia = useRef(new Set())
  const mediaTimers = useRef(new Map())
  const pendingOptimize = useRef(new Set())
  const optimizeTimers = useRef(new Map())
  const fanBusyRef = useRef(false)
  const agentBusyRef = useRef(false)
  const devBusyRef = useRef(false)
  const controllers = useRef(new Set())
  const aliveRef = useRef(true)
  const wakeRef = useRef(null)
  const gridRef = useRef(null)
  const swipeRef = useRef(null)
  const themeTouchedRef = useRef(false)

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
      optimizeTimers.current.forEach((t) => clearTimeout(t))
      optimizeTimers.current.clear()
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
    async (id, label, kind) => {
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
        if (kind === 'monitor-off') setScreenOff(true)
        if (kind === 'monitor-on') setScreenOff(false)
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

  const clearOptimizeError = useCallback((key) => {
    setOptimizeStates((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const runOptimize = useCallback(
    async (action, key, label) => {
      if (pendingOptimize.current.has(key)) return false
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法执行优化')
        return false
      }

      pendingOptimize.current.add(key)
      const prevTimer = optimizeTimers.current.get(key)
      if (prevTimer) {
        clearTimeout(prevTimer)
        optimizeTimers.current.delete(key)
      }
      setOptimizeStates((prev) => ({ ...prev, [key]: { state: 'pending' } }))

      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 15000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/optimize/run${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action.type, pid: action.pid, level: action.level }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `请求失败（${res.status}）`)
        if (!aliveRef.current) return false

        setOptimizeStates((prev) => ({ ...prev, [key]: { state: 'ok', result: data } }))
        const freed = Number(data.freed)
        pushToast(
          'success',
          Number.isFinite(freed) && freed > 0
            ? `${label}完成，释放 ${Math.round(freed / 1024 / 1024)} MB`
            : `${label}完成`
        )
        const timer = setTimeout(() => {
          optimizeTimers.current.delete(key)
          setOptimizeStates((prev) => {
            if (prev[key]?.state !== 'ok') return prev
            const next = { ...prev }
            delete next[key]
            return next
          })
        }, 2000)
        optimizeTimers.current.set(key, timer)
        return true
      } catch (err) {
        if (!aliveRef.current) return false
        const message =
          err.name === 'AbortError' ? '优化请求超时，请检查电脑端是否仍在运行' : err.message || '优化失败'
        setOptimizeStates((prev) => ({ ...prev, [key]: { state: 'error', message } }))
        pushToast('error', message)
        return false
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        pendingOptimize.current.delete(key)
      }
    },
    [pushToast, status, token]
  )

  const runFan = useCallback(
    async (percent) => {
      if (fanBusyRef.current) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法控制风扇')
        return
      }

      fanBusyRef.current = true
      setFanState({ state: 'pending', percent, error: '' })
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 9000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/fan/set${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ percent }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `请求失败（${res.status}）`)
        if (!aliveRef.current) return
        setFanState({ state: 'ok', percent: data.percent ?? null, error: '' })
        pushToast(
          'success',
          data.percent == null ? '风扇已恢复自动控制' : `风扇已设为 ${data.percent}%`
        )
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError'
            ? '风扇控制超时，请检查 LibreHardwareMonitor 是否在运行'
            : err.message === 'unauthorized'
              ? '访问口令无效，请在设置页复制访问链接后重新打开面板'
              : err.message || '风扇控制失败'
        setFanState({ state: 'error', percent, error: message })
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        fanBusyRef.current = false
      }
    },
    [pushToast, status, token]
  )

  const runAgent = useCallback(
    async (prompt) => {
      if (agentBusyRef.current) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法使用 AI 助手')
        return
      }

      agentBusyRef.current = true
      setAgentState({ state: 'loading', result: null, error: '' })
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 35000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/agent/analyze${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `请求失败（${res.status}）`)
        if (!aliveRef.current) return

        const executed = Array.isArray(data.executed) ? data.executed : []
        setAgentState({
          state: 'ok',
          result: data,
          error: '',
          executed,
        })

        for (const item of executed) {
          if (!aliveRef.current) break
          if (item.ok) pushToast('success', `${item.label}已执行`)
          else pushToast('error', `${item.label}执行失败：${item.error}`)
        }
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError' ? 'AI 分析超时，请检查网关是否可用' : err.message || 'AI 分析失败'
        setAgentState({ state: 'error', result: null, error: message })
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        agentBusyRef.current = false
      }
    },
    [pushToast, status, token]
  )

  const resetAgent = useCallback(() => {
    setAgentState({ state: 'idle', result: null, error: '' })
  }, [])

  const scanDevPorts = useCallback(
    async () => {
      if (devBusyRef.current) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法扫描端口')
        return
      }

      devBusyRef.current = true
      setDevState((prev) => ({ ...prev, state: 'pending', error: '' }))
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 25000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/dev/ports${query}`, { signal: controller.signal })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `扫描失败（${res.status}）`)
        if (!aliveRef.current) return
        setDevState({ state: 'ok', ports: data.ports || [], error: '', pendingPid: 0 })
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError' ? '端口扫描超时' : err.message || '端口扫描失败'
        setDevState((prev) => ({ ...prev, state: 'error', error: message }))
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        devBusyRef.current = false
      }
    },
    [pushToast, status, token]
  )

  const stopDevPort = useCallback(
    async (item) => {
      if (!item?.pid) return
      setDevState((prev) => ({ ...prev, pendingPid: item.pid, error: '' }))
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 12000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/dev/stop${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid: item.pid }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `结束失败（${res.status}）`)
        if (!aliveRef.current) return
        pushToast('success', `已结束 ${data.name || item.name}（端口 ${data.port || item.port}）`)
        setDevState((prev) => ({
          ...prev,
          ports: prev.ports.filter((port) => port.pid !== item.pid),
          pendingPid: 0,
        }))
        scanDevPorts()
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError' ? '结束进程超时' : err.message || '结束进程失败'
        setDevState((prev) => ({ ...prev, pendingPid: 0, error: message }))
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
      }
    },
    [pushToast, scanDevPorts, token]
  )

  const clearDevError = useCallback(() => {
    setDevState((prev) => ({ ...prev, error: '' }))
  }, [])

  // 断开/连接设备走 PnP 禁用与启用，服务端需要管理员权限
  const toggleDevice = useCallback(
    async (item, connect) => {
      if (!item?.id || pendingDevice) return
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法操作设备')
        return
      }

      setPendingDevice(item.id)
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 25000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/devices/toggle${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, connected: connect }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `操作失败（${res.status}）`)
        if (!aliveRef.current) return
        pushToast('success', `${connect ? '已连接' : '已断开'}：${item.name}`)
      } catch (err) {
        if (!aliveRef.current) return
        const message =
          err.name === 'AbortError'
            ? '设备操作超时，请确认以管理员身份运行'
            : err.message || '设备操作失败'
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
        if (aliveRef.current) setPendingDevice('')
      }
    },
    [pendingDevice, pushToast, status, token]
  )

  // 一键启停：spawn 在服务端，命令与工作目录不下发到前端
  const controlDevService = useCallback(
    async (id, verb) => {
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法操作开发服务')
        return
      }
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), verb === 'start' ? 12000 : 10000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/dev/proc/${verb}${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `操作失败（${res.status}）`)
        if (!aliveRef.current) return
        pushToast('success', verb === 'start' ? '已启动开发服务' : '已停止开发服务')
      } catch (err) {
        if (!aliveRef.current) return
        const message = err.name === 'AbortError' ? '操作超时' : err.message || '操作失败'
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
      }
    },
    [pushToast, status, token]
  )

  const loadServiceLogs = useCallback(
    async (id) => {
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const query = token ? `&token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/dev/logs?id=${encodeURIComponent(id)}${query}`, {
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) return
        if (!aliveRef.current) return
        loadDevLogs(id, data.lines || [])
      } catch {
        /* 日志补齐失败不影响实时推送 */
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
      }
    },
    [loadDevLogs, token]
  )

  // 「电脑」按钮：无论面板开在电脑还是平板上，都在电脑本机唤起浏览器
  const openDevInComputer = useCallback(
    async (port) => {
      if (status === 'offline') {
        pushToast('error', '连接已断开，无法打开端口')
        return
      }
      const controller = new AbortController()
      controllers.current.add(controller)
      const timeout = setTimeout(() => controller.abort(), 12000)

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`/api/dev/open${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port }),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `打开失败（${res.status}）`)
        if (!aliveRef.current) return
        pushToast('success', `已在电脑浏览器打开 ${port} 端口`)
      } catch (err) {
        if (!aliveRef.current) return
        const message = err.name === 'AbortError' ? '打开端口超时' : err.message || '打开端口失败'
        pushToast('error', message)
      } finally {
        clearTimeout(timeout)
        controllers.current.delete(controller)
      }
    },
    [pushToast, status, token]
  )

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
    if (!themeTouchedRef.current) return
    try {
      localStorage.setItem(THEME_KEY, theme)
      localStorage.setItem(THEME_MANUAL_KEY, '1')
    } catch {
      /* 隐私模式下忽略写入失败 */
    }
  }, [theme])

  // 未手动切换过主题的设备跟随本机设置页里的默认主题
  useEffect(() => {
    const preset = settings?.theme
    if (preset !== 'light' && preset !== 'dark') return
    let manual = null
    try {
      manual = localStorage.getItem(THEME_MANUAL_KEY)
    } catch {
      /* 隐私模式下忽略读取失败 */
    }
    if (manual === '1') return
    setTheme(preset)
  }, [settings?.theme])

  const toggleTheme = useCallback(() => {
    themeTouchedRef.current = true
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
    reconnect()
    pushToast('info', '正在重新连接…')
  }, [pushToast, reconnect])

  const displayLabel = wake
    ? isFullscreen
      ? '全屏常亮中'
      : '常亮中'
    : isFullscreen
      ? '全屏中'
      : '全屏常亮'
  const themeLabel = theme === 'light' ? '白色主题' : '深色主题'
  const themeAction = theme === 'light' ? '切换到深色主题' : '切换到白色极客主题'

  const pages = useMemo(() => {
    if (layout?.pages?.length) return layout.pages
    return [FALLBACK_PAGE]
  }, [layout])
  const pageIndex = Math.min(activePage, pages.length - 1)
  const page = pages[pageIndex]
  const rows = useMemo(() => packRows(page.components), [page])

  // 进入开发视图时自动扫描一次端口，之后由手动刷新控制
  const devScannedPage = useRef(-1)
  useEffect(() => {
    const hasDev = page.components.includes('dev')
    if (!hasDev) {
      devScannedPage.current = -1
      return
    }
    if (devScannedPage.current === pageIndex) return
    devScannedPage.current = pageIndex
    scanDevPorts()
  }, [page, pageIndex, scanDevPorts])

  useEffect(() => {
    setActivePage((prev) => Math.min(prev, pages.length - 1))
  }, [pages.length])

  const changePage = useCallback(
    (delta) => {
      setActivePage((prev) => wrapPage(Math.min(prev, pages.length - 1), delta, pages.length))
    },
    [pages.length]
  )

  // 自动轮播：在设置页开启后按间隔循环切页
  useEffect(() => {
    const seconds = Number(settings?.autoRotate) || 0
    if (seconds <= 0 || pages.length < 2) return undefined
    const timer = setInterval(() => {
      if (document.hidden) return
      setActivePage((prev) => wrapPage(Math.min(prev, pages.length - 1), 1, pages.length))
    }, Math.max(5, seconds) * 1000)
    return () => clearInterval(timer)
  }, [settings?.autoRotate, pages.length])

  // 鼠标拖拽切换（桌面端）
  const onPointerDown = useCallback(
    (event) => {
      if (event.pointerType !== 'mouse') return
      if (pages.length < 2) return
      if (event.target.closest('button, a, input, select, textarea')) return
      swipeRef.current = { x: event.clientX, y: event.clientY, t: Date.now() }
    },
    [pages.length]
  )

  const onPointerUp = useCallback(
    (event) => {
      if (event.pointerType !== 'mouse') return
      const start = swipeRef.current
      swipeRef.current = null
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Date.now() - start.t > 1000) return
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      changePage(dx < 0 ? 1 : -1)
    },
    [changePage]
  )

  // 触摸滑动切换：使用非 passive 监听，横向手势时阻止页面滚动，避免 pointercancel 吞掉事件
  useEffect(() => {
    const el = gridRef.current
    if (!el || pages.length < 2) return

    let start = null
    let axis = null

    const onTouchStart = (event) => {
      axis = null
      if (event.touches.length !== 1) {
        start = null
        return
      }
      // 触摸场景允许从任意位置起手（含按钮），仅以横向位移阈值判定切换
      const touch = event.touches[0]
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() }
    }

    const onTouchMove = (event) => {
      if (!start || event.touches.length !== 1) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (!axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      }
      if (axis === 'x' && event.cancelable) event.preventDefault()
    }

    const onTouchEnd = (event) => {
      const state = start
      const dir = axis
      start = null
      axis = null
      if (!state || dir !== 'x') return
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - state.x
      const dy = touch.clientY - state.y
      if (Date.now() - state.t > 1000) return
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      changePage(dx < 0 ? 1 : -1)
    }

    const onTouchCancel = () => {
      start = null
      axis = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchCancel)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [changePage, pages.length])

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
      case 'temp':
        return <Temp key="temp" cpuTemp={metrics?.temp} gpuTemp={metrics?.gpu?.temperature} ready={ready} />
      case 'processes':
        return <Processes key="processes" list={metrics?.processes} ready={ready} />
      case 'devices':
        return (
          <Devices
            key="devices"
            devices={metrics?.devices}
            ready={ready}
            onToggle={toggleDevice}
            pending={pendingDevice}
          />
        )
      case 'optimize':
        return (
          <Optimize
            key="optimize"
            metrics={metrics}
            info={info}
            ready={ready}
            states={optimizeStates}
            onOptimize={runOptimize}
            onClearError={clearOptimizeError}
          />
        )
      case 'latency':
        return <Latency key="latency" value={metrics?.latency} ts={metrics?.ts} ready={ready} />
      case 'system':
        return (
          <System
            key="system"
            info={info}
            uptime={metrics?.uptime}
            processCount={metrics?.processCount}
            ready={ready}
          />
        )
      case 'power':
        return <Power key="power" power={metrics?.power} ready={ready} />
      case 'sensors':
        return <Sensors key="sensors" sensors={metrics?.sensors} ready={ready} />
      case 'fan':
        return (
          <Fan
            key="fan"
            fan={metrics?.fan}
            ready={ready}
            state={fanState}
            onFanPreset={runFan}
          />
        )
      case 'media':
        return (
          <Media
            key="media"
            media={media || { available: false, title: '', artist: '', album: '', status: 'closed' }}
            states={mediaStates}
            onCommand={runMedia}
          />
        )
      case 'agent':
        return (
          <Agent
            key="agent"
            agent={info?.agent}
            ready={ready}
            state={agentState}
            onAnalyze={runAgent}
            onReset={resetAgent}
          />
        )
      case 'shortcuts':
        return (
          <Shortcuts
            key="shortcuts"
            actions={displayedActions}
            states={actionStates}
            onAction={runAction}
            onClearError={clearActionError}
          />
        )
      case 'dev':
        return (
          <Dev
            key="dev"
            state={devState}
            lanHost={info?.ip || ''}
            onScan={scanDevPorts}
            onStop={stopDevPort}
            onOpenComputer={openDevInComputer}
            onKillError={clearDevError}
            services={dev.services}
            proc={dev.proc}
            logs={devLogs}
            onStartService={(id) => controlDevService(id, 'start')}
            onStopService={(id) => controlDevService(id, 'stop')}
            onLoadLogs={loadServiceLogs}
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

      {status === 'offline' ? (
        <div className="net-hint net-hint--offline" role="status">
          <span>连接已断开 · 正在自动重连</span>
          <button type="button" className="net-hint-action" onClick={retry}>
            立即重试
          </button>
        </div>
      ) : status === 'weak' ? (
        <div className="net-hint" role="status">
          数据延迟 · 最后更新 {lastUpdate ? formatClock(lastUpdate) : '--'}
        </div>
      ) : null}

      <InstallHint />

      <main
        className="grid"
        ref={gridRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          if (event.pointerType === 'mouse') swipeRef.current = null
        }}
      >
        {rows.map((row, rowIndex) => (
          <div
            className={`grid-row${row.some((item) => item.id === 'sensors') ? ' grid-row--sensors' : ''}`}
            key={`${row[0]?.id || 'row'}-${rowIndex}`}
          >
            {row.map(({ id, span }) => (
              <div className={`grid-cell grid-cell--${id}`} key={id} style={{ flexGrow: span }}>
                {renderWidget(id)}
              </div>
            ))}
          </div>
        ))}
      </main>

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
