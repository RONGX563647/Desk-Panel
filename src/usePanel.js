import { useCallback, useEffect, useRef, useState } from 'react'

// 单条 WebSocket 长连接：在线/弱网/离线三态，断线指数退避，页面隐藏时暂停渲染。
export function usePanel() {
  const [metrics, setMetrics] = useState(null)
  const [info, setInfo] = useState(null)
  const [actions, setActions] = useState([])
  const [layout, setLayout] = useState(null)
  const [media, setMedia] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(0)

  const wsRef = useRef(null)
  const retryRef = useRef(0)
  const retryTimerRef = useRef(null)
  const aliveRef = useRef(false)
  const pendingRef = useRef(null)
  const lastMsgRef = useRef(0)

  const connect = useCallback(({ silent = false } = {}) => {
    if (!aliveRef.current) return
    clearTimeout(retryTimerRef.current)

    const old = wsRef.current
    if (old) {
      old.onopen = null
      old.onmessage = null
      old.onclose = null
      old.onerror = null
      try {
        old.close()
      } catch {
        /* 忽略关闭异常 */
      }
    }

    // 自动重连期间保持“离线”状态，避免反复弹出重连提示
    if (!silent) setStatus('connecting')

    const token = new URLSearchParams(location.search).get('token') || ''
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`${proto}://${location.host}/ws${query}`)
    wsRef.current = ws

    ws.onopen = () => {
      retryRef.current = 0
      lastMsgRef.current = Date.now()
      setStatus('online')
    }

    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.t === 'hello') {
        setInfo(msg.info)
        if (Array.isArray(msg.actions)) setActions(msg.actions)
        if (msg.layout?.pages?.length) setLayout(msg.layout)
        if (msg.media) setMedia(msg.media)
      }
      if (msg.t === 'config') {
        if (Array.isArray(msg.actions)) setActions(msg.actions)
        if (msg.layout?.pages?.length) setLayout(msg.layout)
      }
      if (msg.t === 'media' && msg.media) setMedia(msg.media)
      if (msg.t === 'metrics') {
        lastMsgRef.current = Date.now()
        setLastUpdate(lastMsgRef.current)
        if (msg.media) setMedia(msg.media)
        setStatus('online')
        // 页面不可见时不触发 React 渲染，回到前台再一次性补齐。
        if (document.hidden) pendingRef.current = msg
        else setMetrics(msg)
      }
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!aliveRef.current) return
      setStatus('offline')
      const delay = Math.min(1000 * 2 ** retryRef.current++, 8000)
      retryTimerRef.current = setTimeout(() => connect({ silent: true }), delay)
    }

    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* 忽略关闭异常 */
      }
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    connect()

    const onVisible = () => {
      if (document.hidden) return
      if (pendingRef.current) {
        setMetrics(pendingRef.current)
        pendingRef.current = null
        lastMsgRef.current = Date.now()
      }
      const ws = wsRef.current
      if (!ws || ws.readyState > 1) connect()
    }

    const heartbeat = setInterval(() => {
      if (document.hidden) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== 1) return
      const gap = Date.now() - (lastMsgRef.current || Date.now())
      // 推送间隔为 1 分钟，连续 5 分钟没有新数据才提示延迟
      setStatus(gap > 5 * 60 * 1000 ? 'weak' : 'online')
    }, 5000)

    document.addEventListener('visibilitychange', onVisible)
    return () => {
      aliveRef.current = false
      clearTimeout(retryTimerRef.current)
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        try {
          ws.close()
        } catch {
          /* 忽略关闭异常 */
        }
      }
      wsRef.current = null
    }
  }, [connect])

  const reconnect = useCallback(() => {
    retryRef.current = 0
    lastMsgRef.current = Date.now()
    connect()
  }, [connect])

  return { metrics, info, actions, layout, media, status, lastUpdate, reconnect }
}
