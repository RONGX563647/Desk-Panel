import { useCallback, useEffect, useMemo, useState } from 'react'
import { CodeIcon, FolderIcon, GlobeIcon, LockIcon, RefreshIcon, TerminalIcon } from './icons.jsx'
import { packRows } from './utils.js'

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

const COMPONENT_GROUPS = [
  {
    title: '资源监控',
    items: [
      { id: 'clock', label: '时间' },
      { id: 'cpu', label: 'CPU' },
      { id: 'gpu', label: 'GPU' },
      { id: 'memory', label: '内存' },
      { id: 'disk', label: '磁盘' },
      { id: 'network', label: '网络' },
      { id: 'temp', label: '温度' },
      { id: 'processes', label: '进程' },
      { id: 'latency', label: '延迟' },
      { id: 'system', label: '系统' },
      { id: 'power', label: '电源' },
    ],
  },
  {
    title: '控制与其他',
    items: [
      { id: 'media', label: '媒体' },
      { id: 'optimize', label: '优化建议' },
      { id: 'shortcuts', label: '快捷操作' },
    ],
  },
]

const COMPONENT_LABELS = Object.fromEntries(
  COMPONENT_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label]))
)

const TEMPLATES = {
  default: { label: '默认', components: ['clock', 'cpu', 'memory', 'network', 'shortcuts'] },
  monitor: {
    label: '全监控',
    components: ['clock', 'cpu', 'gpu', 'memory', 'disk', 'network', 'temp', 'system'],
  },
  control: { label: '控制', components: ['clock', 'media', 'shortcuts', 'network', 'latency'] },
  optimize: { label: '优化', components: ['optimize', 'processes', 'shortcuts'] },
  minimal: { label: '极简', components: ['clock', 'memory', 'network', 'shortcuts'] },
}

const MAX_PAGES = 5

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
  const [tab, setTab] = useState('actions')

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

  // 有未保存修改时离开页面给出提示
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const discard = useCallback(() => {
    if (!savedSnapshot) return
    setConfig(JSON.parse(savedSnapshot))
    setNotice('')
    setError('')
  }, [savedSnapshot])

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

  const updatePage = useCallback((index, patch) => {
    setConfig((prev) => {
      if (!prev?.layout) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: prev.layout.pages.map((page, i) => (i === index ? { ...page, ...patch } : page)),
        },
      }
    })
    setNotice('')
  }, [])

  const applyTemplate = useCallback(
    (index, key) => {
      const template = TEMPLATES[key]
      if (template) updatePage(index, { components: [...template.components] })
    },
    [updatePage]
  )

  const toggleComponent = useCallback((index, id) => {
    setConfig((prev) => {
      if (!prev?.layout) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: prev.layout.pages.map((page, i) => {
            if (i !== index) return page
            const has = page.components.includes(id)
            return {
              ...page,
              components: has ? page.components.filter((item) => item !== id) : [...page.components, id],
            }
          }),
        },
      }
    })
    setNotice('')
  }, [])

  const moveComponent = useCallback((pageIndex, componentId, delta) => {
    setConfig((prev) => {
      if (!prev?.layout) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: prev.layout.pages.map((page, index) => {
            if (index !== pageIndex) return page
            const components = [...page.components]
            const from = components.indexOf(componentId)
            const to = from + delta
            if (from < 0 || to < 0 || to >= components.length) return page
            ;[components[from], components[to]] = [components[to], components[from]]
            return { ...page, components }
          }),
        },
      }
    })
    setNotice('')
  }, [])

  const movePage = useCallback((index, delta) => {
    setConfig((prev) => {
      if (!prev?.layout) return prev
      const pages = [...prev.layout.pages]
      const target = index + delta
      if (target < 0 || target >= pages.length) return prev
      ;[pages[index], pages[target]] = [pages[target], pages[index]]
      return { ...prev, layout: { ...prev.layout, pages } }
    })
    setNotice('')
  }, [])

  const addPage = useCallback(() => {
    setConfig((prev) => {
      if (!prev?.layout || prev.layout.pages.length >= MAX_PAGES) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: [
            ...prev.layout.pages,
            {
              id: `page_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
              name: `页面 ${prev.layout.pages.length + 1}`,
              components: [...TEMPLATES.default.components],
            },
          ],
        },
      }
    })
    setNotice('')
  }, [])

  const removePage = useCallback(
    (index) => {
      if (!config?.layout || config.layout.pages.length <= 1) return
      const page = config.layout.pages[index]
      if (!window.confirm(`确定删除页面「${page.name}」？`)) return
      setConfig({
        ...config,
        layout: { ...config.layout, pages: config.layout.pages.filter((_, i) => i !== index) },
      })
      setNotice('')
    },
    [config]
  )

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
          <div className="admin-title">面板设置</div>
          <div className="admin-sub">仅本机可访问 · 保存后设备立即生效</div>
        </div>
        <a className="ghost admin-back" href="/">
          返回面板
        </a>
      </header>

      <nav className="admin-tabs" role="tablist" aria-label="设置分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'actions'}
          className={tab === 'actions' ? 'active' : ''}
          onClick={() => setTab('actions')}
        >
          快捷动作
          <span className="admin-tab-count">{config?.actions.length || 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'layout'}
          className={tab === 'layout' ? 'active' : ''}
          onClick={() => setTab('layout')}
        >
          页面布局
          <span className="admin-tab-count">{config?.layout?.pages.length || 0}</span>
        </button>
      </nav>

      <main className="admin-body">
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
          tab === 'actions' ? (
            <>
              <p className="admin-note">
                手机端只会收到动作 ID，命令与参数保存在本机 <code>data/config.json</code>，不会下发到局域网设备。
              </p>
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

            <div className="admin-footer admin-footer--inline">
              <button type="button" className="btn ghost" onClick={() => addAction('app')}>
                新增应用动作
              </button>
              <button type="button" className="btn ghost" onClick={() => addAction('url')}>
                新增网址动作
              </button>
            </div>
            </>
          ) : (
            <>
              <p className="admin-note">
                最多 {MAX_PAGES} 个页面，设备端左右滑动循环切换；每个页面至少保留一个组件，卡片会按顺序自动铺满。
              </p>

            {(config.layout?.pages || []).map((page, index) => {
              const pages = config.layout.pages
              return (
                <section className="admin-card" key={page.id}>
                  <div className="admin-row">
                    <label className="admin-field">
                      <span>页面名称</span>
                      <input
                        className="input"
                        value={page.name}
                        maxLength={12}
                        onChange={(e) => updatePage(index, { name: e.target.value })}
                      />
                    </label>
                    <label className="admin-field admin-field--icon">
                      <span>套用模板</span>
                      <select
                        className="input"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) applyTemplate(index, e.target.value)
                        }}
                      >
                        <option value="">选择模板</option>
                        {Object.entries(TEMPLATES).map(([key, template]) => (
                          <option key={key} value={key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="admin-order">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => movePage(index, -1)}
                        disabled={index === 0}
                        aria-label={`上移 ${page.name}`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => movePage(index, 1)}
                        disabled={index === pages.length - 1}
                        aria-label={`下移 ${page.name}`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => removePage(index)}
                        disabled={pages.length <= 1}
                        aria-label={`删除 ${page.name}`}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="admin-selected">
                    {page.components.map((componentId, order) => (
                      <span className="admin-chip" key={componentId}>
                        {COMPONENT_LABELS[componentId] || componentId}
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => moveComponent(index, componentId, -1)}
                          disabled={order === 0}
                          aria-label={`前移 ${COMPONENT_LABELS[componentId] || componentId}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => moveComponent(index, componentId, 1)}
                          disabled={order === page.components.length - 1}
                          aria-label={`后移 ${COMPONENT_LABELS[componentId] || componentId}`}
                        >
                          ↓
                        </button>
                      </span>
                    ))}
                    <span className="admin-hint">顺序决定卡片位置</span>
                  </div>

                  {COMPONENT_GROUPS.map((group) => (
                    <div className="admin-group" key={group.title}>
                      <span className="admin-group-title">{group.title}</span>
                      <div className="admin-components">
                        {group.items.map((item) => {
                          const checked = page.components.includes(item.id)
                          return (
                            <label className="admin-check" key={item.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={checked && page.components.length === 1}
                                onChange={() => toggleComponent(index, item.id)}
                              />
                              <span>{item.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  <div className="layout-preview" aria-hidden="true">
                    {packRows(page.components).map((row, rowIndex) => (
                      <div className="layout-preview-row" key={rowIndex}>
                        {row.map(({ id, span }) => (
                          <span className="layout-preview-cell" key={id} style={{ flexGrow: span }}>
                            {COMPONENT_LABELS[id] || id}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}

            <div className="admin-footer admin-footer--inline">
              <button
                type="button"
                className="btn ghost"
                onClick={addPage}
                disabled={(config.layout?.pages.length || 0) >= MAX_PAGES}
              >
                新增页面
              </button>
              <span className="admin-hint">
                已有 {config.layout?.pages.length || 0} / {MAX_PAGES} 个页面
              </span>
            </div>
            </>
          )
        ) : null}
      </main>

      <footer className="admin-savebar">
        <div className="admin-savebar-inner">
          <span className={dirty ? 'admin-dirty' : 'admin-hint'}>
            {dirty ? '有未保存的修改' : '配置已保存'}
          </span>
          {notice ? <span className="admin-notice">{notice}</span> : null}
          <button type="button" className="btn ghost" onClick={discard} disabled={!dirty || saving}>
            放弃修改
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </footer>
    </div>
  )
}
