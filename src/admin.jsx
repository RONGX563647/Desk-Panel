import { useCallback, useEffect, useMemo, useState } from 'react'
import { CodeIcon, FolderIcon, GlobeIcon, LockIcon, RefreshIcon, TerminalIcon } from './icons.jsx'

const ICON_OPTIONS = [
  { value: 'terminal', label: '终端', Icon: TerminalIcon },
  { value: 'folder', label: '文件夹', Icon: FolderIcon },
  { value: 'code', label: '代码', Icon: CodeIcon },
  { value: 'globe', label: '网址', Icon: GlobeIcon },
  { value: 'lock', label: '锁', Icon: LockIcon },
]

const KIND_LABEL = {
  app: '启动目标（可执行文件或命令）',
  url: '网址',
  lock: '目标',
}

const KIND_TARGET_HINT = {
  app: '如 notepad.exe 或 C:\\Tools\\app.exe',
  url: 'https://example.com',
  lock: '锁定当前会话（系统动作）',
}

function newAction(kind) {
  return {
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    label: kind === 'url' ? '新网址' : '新应用',
    icon: kind === 'url' ? 'globe' : 'terminal',
    target: '',
    args: [],
    enabled: true,
  }
}

export default function AdminPanel() {
  const [config, setConfig] = useState(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/admin/config')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || '无法读取配置')
        return data.config
      })
      .then((next) => {
        if (!alive) return
        setConfig(next)
        setSavedSnapshot(JSON.stringify(next))
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const dirty = useMemo(
    () => !!config && JSON.stringify(config) !== savedSnapshot,
    [config, savedSnapshot]
  )

  const updateAction = useCallback((index, patch) => {
    setConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        actions: prev.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)),
      }
    })
    setNotice('')
  }, [])

  const moveAction = useCallback((index, delta) => {
    setConfig((prev) => {
      if (!prev) return prev
      const next = [...prev.actions]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, actions: next }
    })
    setNotice('')
  }, [])

  const removeAction = useCallback(
    (index) => {
      if (!config) return
      const action = config.actions[index]
      if (!window.confirm(`确定删除动作「${action.label}」？删除后手机端按钮会立即消失。`)) return
      setConfig({ ...config, actions: config.actions.filter((_, i) => i !== index) })
      setNotice('')
    },
    [config]
  )

  const addAction = useCallback((kind) => {
    setConfig((prev) => (prev ? { ...prev, actions: [...prev.actions, newAction(kind)] } : prev))
    setNotice('')
  }, [])

  const save = useCallback(async () => {
    if (!config || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `保存失败（${res.status}）`)
      setConfig(data.config)
      setSavedSnapshot(JSON.stringify(data.config))
      setNotice('已保存，手机端已同步')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [config, saving])

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <div className="admin-title">动作设置</div>
          <div className="admin-sub">仅本机可访问 · 保存后手机端立即生效</div>
        </div>
        <a className="ghost admin-back" href="/">
          返回面板
        </a>
      </header>

      <main className="admin-body">
        <p className="admin-note">
          手机端只会收到动作 ID，命令与参数保存在本机 <code>data/config.json</code>，不会下发到局域网设备。
        </p>

        {error ? (
          <div className="admin-alert" role="alert">
            <span>{error}</span>
            <button type="button" className="ghost" onClick={() => window.location.reload()}>
              <RefreshIcon size={14} />
              重新加载
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="admin-empty">正在读取配置…</div>
        ) : config ? (
          <>
            {config.actions.length ? (
              config.actions.map((action, index) => {
                const Icon = ICON_OPTIONS.find((item) => item.value === action.icon)?.Icon || TerminalIcon
                return (
                  <section className="admin-card" key={action.id}>
                    <div className="admin-row">
                      <span className="admin-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <label className="admin-field">
                        <span>名称</span>
                        <input
                          className="input"
                          value={action.label}
                          maxLength={24}
                          onChange={(e) => updateAction(index, { label: e.target.value })}
                        />
                      </label>
                      <label className="admin-field admin-field--icon">
                        <span>图标</span>
                        <select
                          className="input"
                          value={action.icon}
                          onChange={(e) => updateAction(index, { icon: e.target.value })}
                        >
                          {ICON_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field admin-field--toggle">
                        <input
                          type="checkbox"
                          checked={action.enabled !== false}
                          onChange={(e) => updateAction(index, { enabled: e.target.checked })}
                        />
                        <span>启用</span>
                      </label>
                      <div className="admin-order">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => moveAction(index, -1)}
                          disabled={index === 0}
                          aria-label={`上移 ${action.label}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => moveAction(index, 1)}
                          disabled={index === config.actions.length - 1}
                          aria-label={`下移 ${action.label}`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => removeAction(index)}
                          aria-label={`删除 ${action.label}`}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    <div className="admin-row">
                      <label className="admin-field admin-field--grow">
                        <span>{KIND_LABEL[action.kind]}</span>
                        <input
                          className="input"
                          value={action.kind === 'lock' ? '' : action.target}
                          placeholder={KIND_TARGET_HINT[action.kind]}
                          disabled={action.kind === 'lock'}
                          onChange={(e) => updateAction(index, { target: e.target.value })}
                        />
                      </label>
                      {action.kind === 'app' ? (
                        <label className="admin-field admin-field--grow">
                          <span>启动参数（空格分隔）</span>
                          <input
                            className="input"
                            value={action.args.join(' ')}
                            placeholder="可选"
                            onChange={(e) =>
                              updateAction(index, {
                                args: e.target.value.split(/\s+/).filter(Boolean),
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </div>

                    {action.kind === 'lock' ? (
                      <div className="admin-hint">系统动作，目标固定为锁定当前会话。</div>
                    ) : null}
                  </section>
                )
              })
            ) : (
              <div className="admin-empty">还没有动作，先在下方新增一个。</div>
            )}

            <div className="admin-footer">
              <button type="button" className="btn ghost" onClick={() => addAction('app')}>
                新增应用动作
              </button>
              <button type="button" className="btn ghost" onClick={() => addAction('url')}>
                新增网址动作
              </button>
              {dirty ? <span className="admin-dirty">有未保存的修改</span> : null}
              {notice ? <span className="admin-notice">{notice}</span> : null}
              <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>
                {saving ? '保存中…' : '保存配置'}
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
