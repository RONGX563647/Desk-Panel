import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CodeIcon,
  FolderIcon,
  FullscreenIcon,
  GlobeIcon,
  LockIcon,
  MonitorIcon,
  MoonIcon,
  RefreshIcon,
  TerminalIcon,
  ThemeIcon,
} from './icons.jsx'
import { packRows } from './utils.js'
import { usePanel } from './usePanel.js'
import {
  Clock,
  Cpu,
  Devices,
  Disk,
  Fan,
  Gpu,
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

const ICON_OPTIONS = [
  { value: 'terminal', label: '终端', Icon: TerminalIcon },
  { value: 'folder', label: '文件夹', Icon: FolderIcon },
  { value: 'code', label: '代码', Icon: CodeIcon },
  { value: 'globe', label: '网址', Icon: GlobeIcon },
  { value: 'monitor', label: '显示器', Icon: MonitorIcon },
  { value: 'lock', label: '锁', Icon: LockIcon },
  { value: 'moon', label: '睡眠', Icon: MoonIcon },
]

const KIND_OPTIONS = [
  { value: 'app', label: '应用' },
  { value: 'open-path', label: '打开路径' },
  { value: 'url', label: '网址' },
  { value: 'lock', label: '锁屏' },
  { value: 'monitor-off', label: '熄屏' },
  { value: 'sleep', label: '睡眠' },
]

const KIND_SHORT = {
  app: '应用',
  'open-path': '打开路径',
  url: '网址',
  lock: '锁屏',
  'monitor-off': '熄屏',
  sleep: '睡眠',
}

const KIND_TARGET_HINT = {
  app: '如 notepad.exe 或 C:\\Tools\\app.exe',
  'open-path': '如 E:\\code\\webpanel 或 D:\\项目\\demo',
  url: 'https://example.com',
  lock: '系统动作，无需填写目标',
  'monitor-off': '系统动作，无需填写目标',
  sleep: '系统动作，无需填写目标',
}

const OPENERS = [
  { value: 'explorer.exe', label: '资源管理器' },
  { value: 'code', label: 'VS Code' },
  { value: 'trae', label: 'Trae' },
  { value: 'idea64.exe', label: 'IDEA' },
]

const DEFAULT_SETTINGS = {
  theme: 'dark',
  metricsInterval: 60,
  autoRotate: 0,
  token: '',
  fanUrl: 'http://127.0.0.1:8085',
}

const DEFAULT_AGENT = {
  enabled: false,
  permission: 'advice',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

const SECTIONS = [
  { key: 'actions', label: '动作管理', hint: '快捷按钮与系统动作', Icon: TerminalIcon },
  { key: 'services', label: '开发服务', hint: '一键启停与启动命令', Icon: CodeIcon },
  { key: 'layout', label: '页面布局', hint: '拖拽卡片与页面顺序', Icon: FullscreenIcon },
  { key: 'agent', label: 'Agent 网关', hint: 'AI 分析与优化建议', Icon: CodeIcon },
  { key: 'settings', label: '全局设置', hint: '主题、刷新、轮播与访问', Icon: ThemeIcon },
  { key: 'data', label: '数据与备份', hint: '导入导出与恢复默认', Icon: FolderIcon },
]

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
      { id: 'devices', label: '设备' },
      { id: 'latency', label: '延迟' },
      { id: 'system', label: '系统' },
      { id: 'power', label: '电源' },
      { id: 'sensors', label: '硬件详情' },
    ],
  },
  {
    title: '控制与其他',
    items: [
      { id: 'media', label: '媒体' },
      { id: 'optimize', label: '优化建议' },
      { id: 'agent', label: 'AI 助手' },
      { id: 'fan', label: '风扇' },
      { id: 'shortcuts', label: '快捷操作' },
      { id: 'dev', label: '开发视图' },
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
    components: ['clock', 'cpu', 'gpu', 'memory', 'disk', 'network', 'temp', 'system', 'devices', 'sensors'],
  },
  control: { label: '控制', components: ['clock', 'media', 'devices', 'shortcuts', 'network', 'latency'] },
  optimize: { label: '优化', components: ['optimize', 'agent', 'processes', 'shortcuts'] },
  minimal: { label: '极简', components: ['clock', 'memory', 'network', 'shortcuts'] },
}

const MAX_PAGES = 6

const STATUS_LABEL = { connecting: '连接中', online: '数据在线', weak: '数据延迟', offline: '离线' }

const noop = () => {}

function newAction(kind) {
  const label =
    kind === 'monitor-off'
      ? '熄屏'
      : kind === 'sleep'
        ? '睡眠'
        : kind === 'lock'
          ? '锁屏'
          : kind === 'url'
            ? '新网址'
            : kind === 'open-path'
              ? '打开目录'
              : '新应用'
  const icon =
    kind === 'monitor-off'
      ? 'monitor'
      : kind === 'sleep'
        ? 'moon'
        : kind === 'lock'
          ? 'lock'
          : kind === 'url'
            ? 'globe'
            : kind === 'open-path'
              ? 'folder'
              : 'terminal'
  return {
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    label,
    icon,
    target: '',
    args: kind === 'open-path' ? ['explorer.exe'] : [],
    enabled: true,
  }
}

function actionIssue(action) {
  if (!action.label || !action.label.trim()) return '请填写动作名称'
  if (action.kind === 'url' && !/^https?:\/\//i.test((action.target || '').trim())) {
    return '网址需以 http:// 或 https:// 开头'
  }
  if (action.kind === 'app' && !(action.target || '').trim()) return '请填写启动目标'
  if (action.kind === 'open-path' && !(action.target || '').trim()) return '请填写要打开的路径'
  return ''
}

function PreviewWidget({ id, metrics, info, media, actions, ready }) {
  switch (id) {
    case 'clock':
      return <Clock />
    case 'cpu':
      return (
        <Cpu
          value={metrics?.cpu}
          cores={metrics?.cores}
          model={info?.cpu}
          temp={metrics?.temp}
          processCount={metrics?.processCount}
          ready={ready}
        />
      )
    case 'gpu':
      return <Gpu gpu={metrics?.gpu} ready={ready} />
    case 'memory':
      return <Memory used={metrics?.memUsed} total={metrics?.memTotal} ready={ready} />
    case 'disk':
      return <Disk disk={metrics?.disk} disks={metrics?.disks} ready={ready} />
    case 'network':
      return <Network rx={metrics?.rx} tx={metrics?.tx} ts={metrics?.ts} ready={ready} />
    case 'temp':
      return <Temp cpuTemp={metrics?.temp} gpuTemp={metrics?.gpu?.temperature} ready={ready} />
    case 'processes':
      return <Processes list={metrics?.processes} ready={ready} />
    case 'devices':
      return <Devices devices={metrics?.devices} ready={ready} />
    case 'optimize':
      return (
        <Optimize
          metrics={metrics}
          info={info}
          ready={ready}
          states={{}}
          onOptimize={noop}
          onClearError={noop}
        />
      )
    case 'latency':
      return <Latency value={metrics?.latency} ts={metrics?.ts} ready={ready} />
    case 'system':
      return (
        <System
          info={info}
          uptime={metrics?.uptime}
          processCount={metrics?.processCount}
          ready={ready}
        />
      )
    case 'power':
      return <Power power={metrics?.power} ready={ready} />
    case 'sensors':
      return <Sensors sensors={metrics?.sensors} ready={ready} />
    case 'fan':
      return <Fan fan={metrics?.fan} ready={ready} state={{}} onFanPreset={noop} />
    case 'media':
      return (
        <Media
          media={media || { available: false, title: '', artist: '', album: '', status: 'closed' }}
          states={{}}
          onCommand={noop}
        />
      )
    case 'shortcuts':
      return <Shortcuts actions={actions} states={{}} onAction={noop} onClearError={noop} />
    default:
      return null
  }
}

export default function AdminPanel() {
  const [config, setConfig] = useState(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [section, setSection] = useState('actions')
  const [activePage, setActivePage] = useState(0)
  const [previewPage, setPreviewPage] = useState(0)
  const [query, setQuery] = useState('')
  const [testStates, setTestStates] = useState({})
  const [serverMeta, setServerMeta] = useState({ configFile: 'data/config.json', envToken: false })
  const [savedAt, setSavedAt] = useState('')

  // 拖拽排序状态：组件、页面、动作各一套，避免互相干扰
  const [dragChip, setDragChip] = useState(null)
  const [overChip, setOverChip] = useState(null)
  const [overPageTab, setOverPageTab] = useState(null)
  const [dragPage, setDragPage] = useState(null)
  const [overPage, setOverPage] = useState(null)
  const [dragAction, setDragAction] = useState(null)
  const [overAction, setOverAction] = useState(null)

  const importRef = useRef(null)
  const { metrics, info, media, status } = usePanel()

  useEffect(() => {
    let alive = true
    fetch('/api/admin/config')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || '无法读取配置')
        return data
      })
      .then((data) => {
        if (!alive) return
        setConfig(data.config)
        setSavedSnapshot(JSON.stringify(data.config))
        setServerMeta({
          configFile: data.configFile || 'data/config.json',
          envToken: !!data.envToken,
        })
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

  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(config?.settings || {}) }),
    [config]
  )

  const agent = useMemo(
    () => ({ ...DEFAULT_AGENT, ...(config?.agent || {}) }),
    [config]
  )

  const updateAgent = useCallback((patch) => {
    setConfig((prev) =>
      prev ? { ...prev, agent: { ...DEFAULT_AGENT, ...(prev.agent || {}), ...patch } } : prev
    )
  }, [])

  const pages = config?.layout?.pages || []

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

  useEffect(() => {
    const total = pages.length
    if (!total) return
    setActivePage((prev) => Math.min(prev, total - 1))
    setPreviewPage((prev) => Math.min(prev, total - 1))
  }, [pages.length])

  // 操作提示短暂显示后自动消失
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 3600)
    return () => clearTimeout(timer)
  }, [notice])

  const discard = useCallback(() => {
    if (!savedSnapshot) return
    setConfig(JSON.parse(savedSnapshot))
    setError('')
    setNotice('已放弃未保存的修改')
    setTestStates({})
  }, [savedSnapshot])

  /* ---------- 动作 ---------- */

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

  const changeActionKind = useCallback((index, kind) => {
    const system = kind === 'lock' || kind === 'monitor-off' || kind === 'sleep'
    setConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        actions: prev.actions.map((action, i) => {
          if (i !== index) return action
          return {
            ...action,
            kind,
            target: system ? '' : action.target,
            args:
              kind === 'open-path'
                ? [action.args?.[0] || 'explorer.exe']
                : kind === 'app'
                  ? action.args || []
                  : [],
            icon:
              kind === 'url'
                ? 'globe'
                : kind === 'lock'
                  ? 'lock'
                  : kind === 'monitor-off'
                    ? 'monitor'
                    : kind === 'sleep'
                      ? 'moon'
                      : kind === 'open-path'
                        ? 'folder'
                        : action.icon,
          }
        }),
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

  const reorderAction = useCallback((from, to) => {
    setConfig((prev) => {
      if (!prev || from === to) return prev
      const actions = [...prev.actions]
      if (from < 0 || to < 0 || from >= actions.length || to >= actions.length) return prev
      const [moved] = actions.splice(from, 1)
      actions.splice(to, 0, moved)
      return { ...prev, actions }
    })
    setNotice('')
  }, [])

  const removeAction = useCallback(
    (index) => {
      if (!config) return
      const action = config.actions[index]
      if (!window.confirm(`确定删除动作「${action.label}」？删除并保存后手机端按钮会消失。`)) return
      setConfig({ ...config, actions: config.actions.filter((_, i) => i !== index) })
      setNotice('')
    },
    [config]
  )

  const addAction = useCallback((kind) => {
    setConfig((prev) => {
      if (!prev) return prev
      return { ...prev, actions: [...prev.actions, newAction(kind)] }
    })
    setSection('actions')
    setNotice('已新增动作，填写完成后可先试运行')
  }, [])

  /* ---------- 开发服务 ---------- */

  const services = config?.dev?.services || []

  const updateServices = useCallback((list) => {
    setConfig((prev) => {
      if (!prev) return prev
      return { ...prev, dev: { ...(prev.dev || { services: [] }), services: list } }
    })
    setNotice('')
  }, [])

  const addService = useCallback(() => {
    updateServices([
      ...services,
      {
        id: `svc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name: '新服务',
        cwd: '',
        command: 'npm run dev',
        port: 0,
      },
    ])
    setSection('services')
    setNotice('已新增开发服务，填写目录与命令后保存')
  }, [services, updateServices])

  const updateService = useCallback(
    (index, patch) => {
      updateServices(services.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    },
    [services, updateServices]
  )

  const removeService = useCallback(
    (index) => {
      const target = services[index]
      if (!target) return
      if (!window.confirm(`确定删除开发服务「${target.name}」？正在运行的进程不会被结束。`)) return
      updateServices(services.filter((_, i) => i !== index))
    },
    [services, updateServices]
  )

  const testAction = useCallback(async (action) => {
    const issue = actionIssue(action)
    if (issue) {
      setTestStates((prev) => ({ ...prev, [action.id]: { state: 'error', message: issue } }))
      return
    }
    setTestStates((prev) => ({ ...prev, [action.id]: { state: 'pending', message: '正在执行…' } }))
    try {
      const res = await fetch('/api/admin/action/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `执行失败（${res.status}）`)
      setTestStates((prev) => ({ ...prev, [action.id]: { state: 'ok', message: '执行成功' } }))
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [action.id]: { state: 'error', message: err.message || '执行失败' },
      }))
    }
  }, [])

  /* ---------- 布局 ---------- */

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
            if (has && page.components.length === 1) return page
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

  const reorderComponent = useCallback((pageIndex, fromId, toId) => {
    if (fromId === toId) return
    setConfig((prev) => {
      if (!prev?.layout) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: prev.layout.pages.map((page, index) => {
            if (index !== pageIndex) return page
            const from = page.components.indexOf(fromId)
            const to = page.components.indexOf(toId)
            if (from < 0 || to < 0) return page
            const components = [...page.components]
            components.splice(from, 1)
            components.splice(to, 0, fromId)
            return { ...page, components }
          }),
        },
      }
    })
    setNotice('')
  }, [])

  const moveComponentToPage = useCallback((fromPage, componentId, toPage) => {
    setConfig((prev) => {
      if (!prev?.layout || fromPage === toPage) return prev
      const pages = prev.layout.pages
      const source = pages[fromPage]
      const target = pages[toPage]
      if (!source || !target || !source.components.includes(componentId)) return prev
      if (source.components.length <= 1) return prev
      if (target.components.includes(componentId)) return prev
      return {
        ...prev,
        layout: {
          ...prev.layout,
          pages: pages.map((page, index) => {
            if (index === fromPage) {
              return { ...page, components: page.components.filter((id) => id !== componentId) }
            }
            if (index === toPage) {
              return { ...page, components: [...page.components, componentId] }
            }
            return page
          }),
        },
      }
    })
    setNotice('组件已移动到目标页面')
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

  const reorderPage = useCallback((from, to) => {
    setConfig((prev) => {
      if (!prev?.layout || from === to) return prev
      const pages = [...prev.layout.pages]
      if (from < 0 || to < 0 || from >= pages.length || to >= pages.length) return prev
      const [moved] = pages.splice(from, 1)
      pages.splice(to, 0, moved)
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

  const duplicatePage = useCallback(
    (index) => {
      if (!config?.layout || config.layout.pages.length >= MAX_PAGES) return
      const source = config.layout.pages[index]
      if (!source) return
      const pages = [...config.layout.pages]
      pages.splice(index + 1, 0, {
        id: `page_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name: `${source.name} 副本`.slice(0, 12),
        components: [...source.components],
      })
      setConfig({ ...config, layout: { ...config.layout, pages } })
      setActivePage(index + 1)
      setPreviewPage(index + 1)
      setNotice('已复制当前页面')
    },
    [config]
  )

  const removePage = useCallback(
    (index) => {
      if (!config?.layout || config.layout.pages.length <= 1) return
      const page = config.layout.pages[index]
      if (!window.confirm(`确定删除页面「${page.name}」？`)) return
      setConfig({
        ...config,
        layout: { ...config.layout, pages: config.layout.pages.filter((_, i) => i !== index) },
      })
      setActivePage(Math.max(0, index - 1))
      setNotice('')
    },
    [config]
  )

  /* ---------- 设置与数据 ---------- */

  const updateSettings = useCallback((patch) => {
    setConfig((prev) => {
      if (!prev) return prev
      return { ...prev, settings: { ...DEFAULT_SETTINGS, ...(prev.settings || {}), ...patch } }
    })
    setNotice('')
  }, [])

  const copyAccess = useCallback(async () => {
    const url = `${location.origin}/?token=${encodeURIComponent(settings.token)}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice('访问链接已复制')
    } catch {
      setError(`无法写入剪贴板，请手动复制：${url}`)
    }
  }, [settings.token])

  const exportConfig = useCallback(() => {
    if (!config) return
    const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `desk-panel-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('已导出当前编辑中的配置')
  }, [config])

  const importConfig = useCallback(async (file) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || !Array.isArray(parsed.actions) || !Array.isArray(parsed.layout?.pages)) {
        throw new Error('文件缺少 actions 或 layout.pages')
      }
      setConfig({
        version: parsed.version || 3,
        actions: parsed.actions,
        layout: parsed.layout,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      })
      setActivePage(0)
      setPreviewPage(0)
      setError('')
      setNotice('已导入配置，检查无误后点击保存')
    } catch (err) {
      setError(`导入失败：${err.message}`)
    }
  }, [])

  const resetDefaults = useCallback(async () => {
    if (!window.confirm('确定载入默认配置？当前编辑中的动作、布局与设置会被替换（尚未保存的内容）。')) {
      return
    }
    try {
      const res = await fetch('/api/admin/defaults')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `读取默认配置失败（${res.status}）`)
      setConfig(data.config)
      setActivePage(0)
      setPreviewPage(0)
      setError('')
      setNotice('已载入默认配置，保存后生效')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const save = useCallback(async () => {
    if (!config || saving) return
    const token = settings.token
    if (token && !TOKEN_PATTERN.test(token)) {
      setError('访问口令需为 4-64 位字母、数字、下划线或短横线')
      return
    }
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
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      setNotice('已保存，面板已同步')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [config, saving, settings.token])

  /* ---------- 渲染数据 ---------- */

  const filteredActions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return config?.actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => {
        if (!keyword) return true
        return `${action.label} ${action.target}`.toLowerCase().includes(keyword)
      })
  }, [config, query])

  const page = pages[Math.min(activePage, Math.max(0, pages.length - 1))] || null

  const previewPages = pages
  const previewIndex = Math.min(previewPage, Math.max(0, previewPages.length - 1))
  const preview = previewPages[previewIndex] || null
  const previewRows = preview ? packRows(preview.components) : []

  const previewActions = useMemo(
    () =>
      (config?.actions || [])
        .filter((action) => action.enabled !== false)
        .map(({ id, kind, label, icon }) => ({ id, kind, label, icon })),
    [config]
  )

  const ready = !!metrics
  const tokenIssue =
    settings.token && !TOKEN_PATTERN.test(settings.token)
      ? '访问口令需为 4-64 位字母、数字、下划线或短横线'
      : ''

  return (
    <div className="admin">
      <header className="admin-head">
        <div className="admin-brand">
          <div className="admin-title">
            面板设置
            <span className="admin-badge">仅本机</span>
          </div>
          <div className="admin-sub">
            {info?.host || '本机'} · {info?.ip || '等待局域网信息'} · 保存后设备立即生效
          </div>
        </div>
        <div className="admin-head-actions">
          <span className={`admin-save-state${dirty ? ' is-dirty' : ''}`}>
            {dirty ? '有未保存的修改' : savedAt ? `已保存 ${savedAt}` : '配置已同步'}
          </span>
          <a
            className="ghost admin-back"
            href={settings.token ? `/?token=${encodeURIComponent(settings.token)}` : '/'}
            target="_blank"
            rel="noreferrer"
          >
            打开面板
          </a>
          <button type="button" className="btn ghost" onClick={discard} disabled={!dirty || saving}>
            放弃修改
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </header>

      <div className="admin-shell">
        <aside className="admin-nav">
          <nav aria-label="设置分类">
            {SECTIONS.map(({ key, label, hint, Icon }) => (
              <button
                type="button"
                key={key}
                className={`admin-nav-item${section === key ? ' is-active' : ''}`}
                onClick={() => {
                  setSection(key)
                  setError('')
                }}
              >
                <span className="admin-nav-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="admin-nav-text">
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
                {key === 'actions' ? (
                  <span className="admin-nav-count">{config?.actions.length || 0}</span>
                ) : key === 'layout' ? (
                  <span className="admin-nav-count">{pages.length}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="admin-nav-card">
            <div className="admin-nav-state">
              <span className={`status ${status}`} aria-hidden="true" />
              <span>{STATUS_LABEL[status] || '连接中'}</span>
            </div>
            <dl>
              <div>
                <dt>配置文件</dt>
                <dd title={serverMeta.configFile}>{serverMeta.configFile}</dd>
              </div>
              <div>
                <dt>访问口令</dt>
                <dd>{serverMeta.envToken ? '环境变量锁定' : settings.token ? '已启用' : '未启用'}</dd>
              </div>
              <div>
                <dt>刷新间隔</dt>
                <dd>{settings.metricsInterval} 秒</dd>
              </div>
            </dl>
            <p className="admin-hint">设置接口仅限本机访问，局域网设备只能查看面板。</p>
          </div>
        </aside>

        <main className="admin-main">
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
          ) : !config ? null : (
            <>
              {section === 'actions' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>动作管理</h2>
                      <p>手机端只收到动作 ID，命令与参数保存在本机，不会下发到局域网设备。</p>
                    </div>
                    <div className="admin-panel-actions">
                      <button type="button" className="btn ghost" onClick={() => addAction('app')}>
                        + 应用
                      </button>
                      <button type="button" className="btn ghost" onClick={() => addAction('open-path')}>
                        + 打开路径
                      </button>
                      <button type="button" className="btn ghost" onClick={() => addAction('url')}>
                        + 网址
                      </button>
                      <button type="button" className="btn ghost" onClick={() => addAction('monitor-off')}>
                        + 熄屏
                      </button>
                      <button type="button" className="btn ghost" onClick={() => addAction('sleep')}>
                        + 睡眠
                      </button>
                      <button type="button" className="btn ghost" onClick={() => addAction('lock')}>
                        + 锁屏
                      </button>
                    </div>
                  </div>

                  {config.actions.length > 6 ? (
                    <input
                      className="input admin-search"
                      value={query}
                      placeholder="搜索动作名称或目标…"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  ) : null}

                  {filteredActions.length ? (
                    <div className="admin-actions">
                      {filteredActions.map(({ action, index }) => {
                        const test = testStates[action.id]
                        const issue = actionIssue(action)
                        const Icon = ICON_OPTIONS.find((item) => item.value === action.icon)?.Icon || TerminalIcon
                        const dragging = dragAction === index
                        const dropTarget =
                          overAction === index && dragAction !== null && dragAction !== index
                        return (
                          <article
                            className={`admin-action${dragging ? ' is-dragging' : ''}${
                              dropTarget ? ' is-drop-target' : ''
                            }`}
                            key={action.id}
                            onDragOver={(event) => {
                              if (dragAction === null) return
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'move'
                              if (overAction !== index) setOverAction(index)
                            }}
                            onDrop={(event) => {
                              if (dragAction === null) return
                              event.preventDefault()
                              reorderAction(dragAction, index)
                              setDragAction(null)
                              setOverAction(null)
                            }}
                          >
                            <div className="admin-action-row">
                              <span
                                className="drag-grip"
                                draggable
                                title="拖拽调整动作顺序"
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', action.id)
                                  setDragAction(index)
                                }}
                                onDragEnd={() => {
                                  setDragAction(null)
                                  setOverAction(null)
                                }}
                              >
                                ⠿
                              </span>
                              <span className="admin-action-icon" aria-hidden="true">
                                <Icon size={17} />
                              </span>
                              <input
                                className="input admin-action-name"
                                value={action.label}
                                maxLength={24}
                                aria-label="动作名称"
                                onChange={(e) => updateAction(index, { label: e.target.value })}
                              />
                              <select
                                className="input admin-action-kind"
                                value={action.kind}
                                aria-label="动作类型"
                                onChange={(e) => changeActionKind(index, e.target.value)}
                              >
                                {KIND_OPTIONS.map((item) => (
                                  <option key={item.value} value={item.value}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="input admin-action-icon-select"
                                value={action.icon}
                                aria-label="图标"
                                onChange={(e) => updateAction(index, { icon: e.target.value })}
                              >
                                {ICON_OPTIONS.map((item) => (
                                  <option key={item.value} value={item.value}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                              <label className="admin-switch">
                                <input
                                  type="checkbox"
                                  checked={action.enabled !== false}
                                  onChange={(e) => updateAction(index, { enabled: e.target.checked })}
                                />
                                <span>{action.enabled !== false ? '启用' : '停用'}</span>
                              </label>
                              <div className="admin-action-tools">
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
                                  className="icon-btn admin-test-btn"
                                  onClick={() => testAction(action)}
                                  disabled={action.kind === 'lock' || test?.state === 'pending'}
                                  title={action.kind === 'lock' ? '锁屏动作不支持试运行' : '使用当前编辑内容试运行'}
                                >
                                  {test?.state === 'pending' ? '执行中…' : '试运行'}
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

                            <div className="admin-action-row admin-action-row--detail">
                              <span className="admin-action-kind-badge">{KIND_SHORT[action.kind]}</span>
                              <input
                                className="input admin-action-target"
                                value={action.target || ''}
                                placeholder={KIND_TARGET_HINT[action.kind]}
                                disabled={action.kind === 'lock' || action.kind === 'monitor-off' || action.kind === 'sleep'}
                                aria-label="动作目标"
                                onChange={(e) => updateAction(index, { target: e.target.value })}
                              />
                              {action.kind === 'app' ? (
                                <input
                                  className="input admin-action-args"
                                  value={(action.args || []).join(' ')}
                                  placeholder="启动参数（空格分隔，可选）"
                                  aria-label="启动参数"
                                  onChange={(e) =>
                                    updateAction(index, {
                                      args: e.target.value.split(/\s+/).filter(Boolean),
                                    })
                                  }
                                />
                              ) : null}
                              {action.kind === 'open-path' ? (
                                <>
                                  <input
                                    className="input admin-action-args"
                                    list="panel-openers"
                                    value={action.args?.[0] || 'explorer.exe'}
                                    placeholder="打开方式，如 explorer.exe / idea64.exe"
                                    aria-label="打开方式"
                                    onChange={(e) => updateAction(index, { args: [e.target.value] })}
                                  />
                                  <datalist id="panel-openers">
                                    {OPENERS.map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))}
                                  </datalist>
                                </>
                              ) : null}
                              {test ? (
                                <span className={`admin-test admin-test--${test.state}`}>{test.message}</span>
                              ) : null}
                              {issue && !test ? <span className="admin-issue">{issue}</span> : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="admin-empty">
                      {query ? '没有匹配的动作，换个关键词试试。' : '还没有动作，先在上方新增一个。'}
                    </div>
                  )}

                  <p className="admin-hint admin-actions-hint">
                    拖拽 ⠿ 调整按钮顺序；试运行使用当前编辑中的内容，不会写入配置。
                  </p>
                </section>
              ) : null}

              {section === 'services' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>开发服务</h2>
                      <p>
                        保存后可在面板「开发视图」一键启动/停止，进程输出实时显示在日志浮窗中。
                        命令与目录只保存在本机。
                      </p>
                    </div>
                    <div className="admin-panel-actions">
                      <button type="button" className="btn ghost" onClick={addService}>
                        + 新增服务
                      </button>
                    </div>
                  </div>

                  {services.length ? (
                    <div className="admin-services">
                      {services.map((service, index) => (
                        <article className="admin-service" key={service.id}>
                          <div className="admin-service-head">
                            <input
                              className="input admin-service-name"
                              value={service.name}
                              placeholder="服务名称，如 前端"
                              aria-label="服务名称"
                              onChange={(e) => updateService(index, { name: e.target.value })}
                            />
                            <span className="admin-hint">端口</span>
                            <input
                              type="number"
                              className="input admin-number"
                              min={0}
                              max={65535}
                              value={service.port || 0}
                              aria-label="服务端口"
                              onChange={(e) => updateService(index, { port: Number(e.target.value) || 0 })}
                            />
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => removeService(index)}
                              aria-label={`删除 ${service.name}`}
                            >
                              删除
                            </button>
                          </div>
                          <div className="admin-service-body">
                            <label>
                              <span>工作目录</span>
                              <input
                                className="input"
                                value={service.cwd || ''}
                                placeholder="E:\\code\\webpanel（留空则用面板目录）"
                                onChange={(e) => updateService(index, { cwd: e.target.value })}
                              />
                            </label>
                            <label>
                              <span>启动命令</span>
                              <input
                                className="input"
                                value={service.command || ''}
                                placeholder="npm run dev"
                                onChange={(e) => updateService(index, { command: e.target.value })}
                              />
                            </label>
                          </div>
                          {!service.name.trim() || !service.command.trim() ? (
                            <span className="admin-issue">名称与启动命令不能为空</span>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="admin-empty">还没有开发服务，点击上方「新增服务」添加一个。</div>
                  )}

                  <p className="admin-hint admin-actions-hint">
                    端口用于把开发视图里扫描到的端口关联到日志浮窗；留 0 表示只按服务名查看日志。
                  </p>
                </section>
              ) : null}

              {section === 'layout' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>页面布局</h2>
                      <p>
                        拖拽卡片调整顺序，拖到页签可移动到其他页面；最多 {MAX_PAGES} 个页面，
                        设备端左右滑动循环切换。
                      </p>
                    </div>
                    <div className="admin-panel-actions">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={duplicatePage.bind(null, activePage)}
                        disabled={pages.length >= MAX_PAGES}
                      >
                        复制当前页
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={removePage.bind(null, activePage)}
                        disabled={pages.length <= 1}
                      >
                        删除当前页
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={addPage}
                        disabled={pages.length >= MAX_PAGES}
                      >
                        + 新增页面
                      </button>
                    </div>
                  </div>

                  <div className="admin-page-tabs" role="tablist" aria-label="页面顺序">
                    {pages.map((item, index) => {
                      const dragging = dragPage === index
                      const pageDrop = overPage === index && dragPage !== null && dragPage !== index
                      const chipDrop = overPageTab === index
                      return (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activePage === index}
                          key={item.id}
                          draggable
                          className={`admin-page-tab${activePage === index ? ' is-active' : ''}${
                            dragging ? ' is-dragging' : ''
                          }${pageDrop ? ' is-drop-target' : ''}${chipDrop ? ' is-chip-target' : ''}`}
                          onClick={() => {
                            setActivePage(index)
                            setPreviewPage(index)
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', item.id)
                            setDragPage(index)
                          }}
                          onDragEnd={() => {
                            setDragPage(null)
                            setOverPage(null)
                            setOverPageTab(null)
                          }}
                          onDragOver={(event) => {
                            if (dragChip) {
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'move'
                              if (overPageTab !== index) setOverPageTab(index)
                              return
                            }
                            if (dragPage !== null) {
                              event.preventDefault()
                              if (overPage !== index) setOverPage(index)
                            }
                          }}
                          onDrop={(event) => {
                            if (dragChip) {
                              event.preventDefault()
                              event.stopPropagation()
                              moveComponentToPage(dragChip.pageIndex, dragChip.id, index)
                              setDragChip(null)
                              setOverChip(null)
                              setOverPageTab(null)
                              return
                            }
                            if (dragPage !== null) {
                              event.preventDefault()
                              reorderPage(dragPage, index)
                              setDragPage(null)
                              setOverPage(null)
                            }
                          }}
                        >
                          <span className="admin-page-tab-index">{index + 1}</span>
                          <span className="admin-page-tab-name">{item.name}</span>
                          <span className="admin-page-tab-count">{item.components.length}</span>
                        </button>
                      )
                    })}
                    <span className="admin-page-tab-hint">
                      {pages.length} / {MAX_PAGES}
                    </span>
                  </div>

                  {page ? (
                    <>
                      <div className="admin-page-bar">
                        <label className="admin-field admin-page-name">
                          <span>页面名称</span>
                          <input
                            className="input"
                            value={page.name}
                            maxLength={12}
                            onChange={(e) => updatePage(activePage, { name: e.target.value })}
                          />
                        </label>
                        <label className="admin-field admin-page-template">
                          <span>套用模板</span>
                          <select
                            className="input"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) applyTemplate(activePage, e.target.value)
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
                        <span className="admin-hint admin-page-summary">
                          {page.components.length} 个组件 · 卡片会按顺序自动铺满
                        </span>
                      </div>

                      <div className="admin-canvas">
                        {packRows(page.components).map((row, rowIndex) => (
                          <div className="admin-canvas-row" key={rowIndex}>
                            {row.map(({ id, span }) => {
                              const dragging = dragChip?.pageIndex === activePage && dragChip.id === id
                              const dropTarget =
                                overChip?.pageIndex === activePage &&
                                overChip.id === id &&
                                dragChip !== null &&
                                dragChip.id !== id
                              return (
                                <div
                                  className={`admin-canvas-card${dragging ? ' is-dragging' : ''}${
                                    dropTarget ? ' is-over' : ''
                                  }`}
                                  key={id}
                                  style={{ flexGrow: span }}
                                  draggable
                                  title="拖拽调整顺序，拖到页签可移动到其他页面"
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('text/plain', id)
                                    setDragChip({ pageIndex: activePage, id })
                                  }}
                                  onDragEnd={() => {
                                    setDragChip(null)
                                    setOverChip(null)
                                    setOverPageTab(null)
                                  }}
                                  onDragOver={(event) => {
                                    if (!dragChip || dragChip.pageIndex !== activePage) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    event.dataTransfer.dropEffect = 'move'
                                    if (overChip?.id !== id) {
                                      setOverChip({ pageIndex: activePage, id })
                                    }
                                  }}
                                  onDrop={(event) => {
                                    if (!dragChip || dragChip.pageIndex !== activePage) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    reorderComponent(activePage, dragChip.id, id)
                                    setDragChip(null)
                                    setOverChip(null)
                                  }}
                                >
                                  <span className="canvas-grip" aria-hidden="true">
                                    ⠿
                                  </span>
                                  <span className="canvas-label">{COMPONENT_LABELS[id] || id}</span>
                                  <span className="canvas-span">{span}/12</span>
                                  <button
                                    type="button"
                                    className="canvas-remove"
                                    onClick={() => toggleComponent(activePage, id)}
                                    disabled={page.components.length === 1}
                                    aria-label={`移除 ${COMPONENT_LABELS[id] || id}`}
                                  >
                                    ×
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>

                      <div className="admin-palette">
                        {COMPONENT_GROUPS.map((group) => (
                          <div className="admin-group" key={group.title}>
                            <span className="admin-group-title">{group.title}</span>
                            <div className="admin-palette-grid">
                              {group.items.map((item) => {
                                const on = page.components.includes(item.id)
                                return (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className={`admin-comp${on ? ' is-on' : ''}`}
                                    onClick={() => toggleComponent(activePage, item.id)}
                                    disabled={on && page.components.length === 1}
                                    aria-pressed={on}
                                  >
                                    <span>{item.label}</span>
                                    <span className="admin-comp-mark" aria-hidden="true">
                                      {on ? '✓' : '+'}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="admin-empty">还没有页面，先新增一个。</div>
                  )}
                </section>
              ) : null}

              {section === 'agent' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>Agent 网关</h2>
                      <p>配置 OpenAI 兼容接口，让面板分析实时指标并给出可执行的优化建议。</p>
                    </div>
                  </div>

                  <div className="admin-settings">
                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>启用 Agent</strong>
                        <span>关闭后 AI 助手卡片只显示配置提示，不会发起请求</span>
                      </div>
                      <div className="admin-segmented">
                        <button
                          type="button"
                          className={!agent.enabled ? 'is-active' : ''}
                          onClick={() => updateAgent({ enabled: false })}
                        >
                          关闭
                        </button>
                        <button
                          type="button"
                          className={agent.enabled ? 'is-active' : ''}
                          onClick={() => updateAgent({ enabled: true })}
                        >
                          启用
                        </button>
                      </div>
                    </div>

                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>AI 权限</strong>
                        <span>仅建议只展示结论；安全自动优化会自动整理内存或降低优先级，最多 2 个动作，高风险时仍不自动执行</span>
                      </div>
                      <div className="admin-segmented">
                        <button
                          type="button"
                          className={agent.permission !== 'safe' ? 'is-active' : ''}
                          onClick={() => updateAgent({ permission: 'advice' })}
                        >
                          仅建议
                        </button>
                        <button
                          type="button"
                          className={agent.permission === 'safe' ? 'is-active' : ''}
                          onClick={() => updateAgent({ permission: 'safe' })}
                        >
                          安全自动优化
                        </button>
                      </div>
                    </div>

                    <div className="admin-setting admin-setting--token">
                      <div className="admin-setting-text">
                        <strong>网关地址</strong>
                        <span>OpenAI 兼容的 /v1 地址，例如 https://api.openai.com/v1</span>
                      </div>
                      <div className="admin-setting-control admin-setting-control--token">
                        <input
                          className="input"
                          type="url"
                          value={agent.baseUrl}
                          placeholder="https://api.openai.com/v1"
                          onChange={(e) => updateAgent({ baseUrl: e.target.value.trim() })}
                        />
                      </div>
                    </div>

                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>模型</strong>
                        <span>网关支持的模型名称，例如 gpt-4o-mini、deepseek-chat</span>
                      </div>
                      <div className="admin-setting-control">
                        <input
                          className="input"
                          type="text"
                          value={agent.model}
                          placeholder="gpt-4o-mini"
                          onChange={(e) => updateAgent({ model: e.target.value.trim() })}
                        />
                      </div>
                    </div>

                    <div className="admin-setting admin-setting--token">
                      <div className="admin-setting-text">
                        <strong>API Key</strong>
                        <span>只保存在本机配置中，不会下发给浏览器或其他设备</span>
                      </div>
                      <div className="admin-setting-control admin-setting-control--token">
                        <input
                          className="input"
                          type="password"
                          value={agent.apiKey}
                          placeholder="sk-..."
                          autoComplete="off"
                          onChange={(e) => updateAgent({ apiKey: e.target.value.trim() })}
                        />
                      </div>
                    </div>
                  </div>

                  <p className="admin-note">
                    支持 OpenAI、DeepSeek、Moonshot、Ollama、LM Studio 等兼容
                    <code>/chat/completions</code> 的服务。未设置访问口令时，Agent 只允许本机调用；
                    局域网设备使用前请先在全局设置里设置口令。
                  </p>
                </section>
              ) : null}

              {section === 'settings' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>全局设置</h2>
                      <p>保存后立即推送给所有已连接设备，无需重启服务。</p>
                    </div>
                  </div>

                  <div className="admin-settings">
                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>默认主题</strong>
                        <span>设备首次打开且未手动切换主题时使用</span>
                      </div>
                      <div className="admin-segmented">
                        <button
                          type="button"
                          className={settings.theme === 'dark' ? 'is-active' : ''}
                          onClick={() => updateSettings({ theme: 'dark' })}
                        >
                          深色
                        </button>
                        <button
                          type="button"
                          className={settings.theme === 'light' ? 'is-active' : ''}
                          onClick={() => updateSettings({ theme: 'light' })}
                        >
                          浅色
                        </button>
                      </div>
                    </div>

                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>刷新频率</strong>
                        <span>指标推送间隔，越大越省电（5–300 秒）</span>
                      </div>
                      <div className="admin-setting-control">
                        <input
                          type="number"
                          className="input admin-number"
                          min={5}
                          max={300}
                          value={settings.metricsInterval}
                          onChange={(e) => updateSettings({ metricsInterval: Number(e.target.value) || 5 })}
                        />
                        <span className="admin-hint">秒</span>
                      </div>
                    </div>

                    <div className="admin-setting">
                      <div className="admin-setting-text">
                        <strong>自动轮播</strong>
                        <span>面板打开后按间隔自动循环切页，0 表示关闭（最多 120 秒）</span>
                      </div>
                      <div className="admin-setting-control">
                        <input
                          type="number"
                          className="input admin-number"
                          min={0}
                          max={120}
                          value={settings.autoRotate}
                          onChange={(e) => updateSettings({ autoRotate: Number(e.target.value) || 0 })}
                        />
                        <span className="admin-hint">秒</span>
                      </div>
                    </div>

                    <div className="admin-setting admin-setting--token">
                      <div className="admin-setting-text">
                        <strong>风扇数据源</strong>
                        <span>
                          填 LibreHardwareMonitor 的 Web Server 地址；未安装时风扇卡片会显示未连接
                        </span>
                      </div>
                      <div className="admin-setting-control admin-setting-control--token">
                        <input
                          className="input"
                          type="text"
                          value={settings.fanUrl}
                          placeholder="http://127.0.0.1:8085"
                          onChange={(e) => updateSettings({ fanUrl: e.target.value })}
                        />
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => window.open(settings.fanUrl, '_blank', 'noopener')}
                        >
                          打开测试
                        </button>
                      </div>
                    </div>

                    <div className="admin-setting admin-setting--token">
                      <div className="admin-setting-text">
                        <strong>访问口令</strong>
                        <span>
                          {serverMeta.envToken
                            ? '已通过 PANEL_TOKEN 环境变量锁定，设置页无法修改'
                            : '留空表示局域网免口令；修改后已连接设备需用新链接重新打开'}
                        </span>
                      </div>
                      <div className="admin-setting-control admin-setting-control--token">
                        <input
                          className="input"
                          type="text"
                          value={settings.token}
                          placeholder="4-64 位字母、数字、_ 或 -"
                          disabled={serverMeta.envToken}
                          onChange={(e) => updateSettings({ token: e.target.value.trim() })}
                        />
                        {settings.token && !serverMeta.envToken ? (
                          <button type="button" className="ghost" onClick={copyAccess}>
                            复制访问链接
                          </button>
                        ) : null}
                      </div>
                      {tokenIssue ? <span className="admin-issue">{tokenIssue}</span> : null}
                    </div>
                  </div>

                  <p className="admin-note">
                    口令以明文保存在本机配置文件中，忘记时可以随时在这里清空；环境变量
                    <code>PANEL_TOKEN</code> 的优先级更高。
                  </p>
                </section>
              ) : null}

              {section === 'data' ? (
                <section className="admin-panel">
                  <div className="admin-panel-head">
                    <div>
                      <h2>数据与备份</h2>
                      <p>配置只保存在本机，导出后可用于备份或迁移到其他电脑。</p>
                    </div>
                  </div>

                  <div className="admin-data-grid">
                    <article className="admin-data-card">
                      <h3>导出配置</h3>
                      <p>下载当前编辑中的动作、布局与设置，包含尚未保存的修改。</p>
                      <button type="button" className="btn ghost" onClick={exportConfig}>
                        导出 JSON
                      </button>
                    </article>

                    <article className="admin-data-card">
                      <h3>导入配置</h3>
                      <p>选择之前导出的 JSON 文件，导入后检查无误再保存才会生效。</p>
                      <button type="button" className="btn ghost" onClick={() => importRef.current?.click()}>
                        选择文件
                      </button>
                      <input
                        ref={importRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          importConfig(file)
                          event.target.value = ''
                        }}
                      />
                    </article>

                    <article className="admin-data-card">
                      <h3>恢复默认</h3>
                      <p>载入出厂动作、单页布局与默认设置，适合配置混乱时重新开始。</p>
                      <button type="button" className="btn ghost admin-danger" onClick={resetDefaults}>
                        载入默认配置
                      </button>
                    </article>
                  </div>

                  <div className="admin-data-meta">
                    <div>
                      <span>配置文件</span>
                      <code>{serverMeta.configFile}</code>
                    </div>
                    <div>
                      <span>动作数量</span>
                      <strong>{config.actions.length}</strong>
                    </div>
                    <div>
                      <span>页面数量</span>
                      <strong>
                        {pages.length} / {MAX_PAGES}
                      </strong>
                    </div>
                    <div>
                      <span>最近保存</span>
                      <strong>{savedAt || '本次尚未保存'}</strong>
                    </div>
                  </div>

                  <p className="admin-note">
                    服务端会在每次保存前自动备份为 <code>config.json.bak</code>，配置损坏时会回退默认配置。
                  </p>
                </section>
              ) : null}
            </>
          )}
          {notice ? <div className="admin-flash">{notice}</div> : null}
        </main>

        <aside className="admin-preview" aria-label="实时预览">
          <div className="admin-preview-head">
            <div className="admin-preview-title">
              <strong>实时预览</strong>
              <span>{STATUS_LABEL[status] || '连接中'}</span>
            </div>
            <span className={`admin-preview-dot ${status}`} aria-hidden="true" />
          </div>

          <div className="admin-preview-tabs">
            {previewPages.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={previewIndex === index ? 'is-active' : ''}
                onClick={() => setPreviewPage(index)}
              >
                {item.name}
              </button>
            ))}
          </div>

          <div className="admin-preview-stage">
            <div className="admin-preview-device">
              <div className="admin-preview-topbar">
                <span className={`status ${status}`} aria-hidden="true" />
                <span className="admin-preview-host">{info?.host || 'Desk Panel'}</span>
                <span className="admin-preview-online">{ready ? '实时数据' : '等待数据'}</span>
              </div>
              <div className="admin-preview-grid">
                {previewRows.length ? (
                  previewRows.map((row, rowIndex) => (
                    <div className="grid-row admin-preview-row" key={rowIndex}>
                      {row.map(({ id, span }) => (
                        <div className="grid-cell" key={id} style={{ flexGrow: span }}>
                          <PreviewWidget
                            id={id}
                            metrics={metrics}
                            info={info}
                            media={media}
                            actions={previewActions}
                            ready={ready}
                          />
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="admin-empty">当前页面没有组件</div>
                )}
              </div>
            </div>
          </div>

          <p className="admin-hint admin-preview-note">
            预览使用实时数据，点击不会触发动作；布局修改无需保存即可看到效果。
          </p>
        </aside>
      </div>
    </div>
  )
}
