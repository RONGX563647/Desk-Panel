import { isProtectedPid, isProtectedProcess } from './optimize.js'
import { MEDIA_COMMANDS } from './media.js'

const ALLOWED_ACTIONS = new Set([
  'trim-process',
  'set-priority',
  'open-task-manager',
  'fan-set',
  'media',
])
const ALLOWED_LEVELS = new Set(['below', 'idle'])
const MAX_ACTIONS = 3
const REQUEST_TIMEOUT = 30000
const MEDIA_LABELS = {
  playpause: '播放/暂停',
  next: '下一曲',
  prev: '上一曲',
  volume_up: '音量+',
  volume_down: '音量-',
  mute: '静音',
}

const SYSTEM_PROMPT = `你是 Desk Panel 的系统性能助手。你只能根据用户提供的实时指标分析，不得编造进程、温度、磁盘或负载数据。
只输出一个 JSON 对象，不要 Markdown，不要额外解释。格式：
{"summary":"一句话结论","risk":"low|medium|high","actions":[{"type":"trim-process","pid":123,"name":"chrome","reason":"占用较高","level":"below"}]}

可用动作：
1. trim-process：整理指定进程的工作集，pid 必须来自给出的 processes
2. set-priority：降低指定进程优先级，level 只能是 below 或 idle，pid 必须来自给出的 processes
3. open-task-manager：打开任务管理器
4. fan-set：设置风扇转速，percent 为 0-100，仅在用户明确要求调节风扇或散热时使用
5. media：控制媒体播放，command 只能是 playpause / next / prev / volume_up / volume_down / mute，仅在用户明确要求控制媒体时使用

最多给出 3 个动作。没有必要时 actions 为空数组。
当用户要求“优化 / 清理内存 / 降低负载 / 降温”等执行类请求时，你必须返回具体的可执行动作（trim-process 或 set-priority），并选用 processes 中真实存在的 pid，而不是只输出文字建议；只有当系统确实没有需要优化的对象时才返回空数组。
指标中的 disks 数组给出全部磁盘分区，汇报磁盘时必须逐个列出每个 mount 的已用容量和使用率，不得只报告其中一个分区。
不要建议结束进程、修改注册表、服务、驱动、超频、清空 standby list 或执行任意命令。`

function toProcessMap(processes) {
  const map = new Map()
  for (const item of Array.isArray(processes) ? processes : []) {
    const pid = Number(item?.pid)
    if (Number.isInteger(pid) && pid > 0) map.set(pid, item)
  }
  return map
}

function normalizeText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export function normalizeAgentEndpoint(baseUrl) {
  const value = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!value) return ''
  if (/\/chat\/completions$/i.test(value)) return value
  return `${value}/chat/completions`
}

export function parseAgentResponse(text, processes) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('模型返回格式异常')

  let payload
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('模型返回格式异常')
  }

  const byPid = toProcessMap(processes)
  const actions = []
  for (const item of Array.isArray(payload.actions) ? payload.actions : []) {
    if (actions.length >= MAX_ACTIONS) break
    const type = String(item?.type || '')
    if (!ALLOWED_ACTIONS.has(type)) continue
    const reason = normalizeText(item?.reason, 120)

    if (type === 'open-task-manager') {
      actions.push({ type, label: '打开任务管理器', reason })
      continue
    }

    if (type === 'fan-set') {
      const percent = Number(item?.percent)
      if (!Number.isFinite(percent)) continue
      const clamped = Math.max(0, Math.min(100, Math.round(percent)))
      actions.push({ type, percent: clamped, label: `风扇设为 ${clamped}%`, reason })
      continue
    }

    if (type === 'media') {
      const command = String(item?.command || '')
      if (!MEDIA_COMMANDS.includes(command)) continue
      actions.push({ type, command, label: MEDIA_LABELS[command] || command, reason })
      continue
    }

    const pid = Number(item?.pid)
    const process = byPid.get(pid)
    if (!process) continue
    if (isProtectedPid(pid) || isProtectedProcess(process.name)) continue

    if (type === 'trim-process') {
      actions.push({ type, pid, name: process.name, label: `整理 ${process.name}`, reason })
      continue
    }

    const level = ALLOWED_LEVELS.has(item?.level) ? item.level : 'below'
    actions.push({
      type,
      pid,
      name: process.name,
      level,
      label: `降低 ${process.name} 优先级`,
      reason,
    })
  }

  const risk = ['low', 'medium', 'high'].includes(payload.risk) ? payload.risk : 'low'
  return {
    summary: normalizeText(payload.summary, 600) || '当前没有发现明显异常。',
    risk,
    actions,
  }
}

function buildContext(metrics) {
  const disks = Array.isArray(metrics?.disks) ? metrics.disks : []
  const processes = Array.isArray(metrics?.processes) ? metrics.processes : []
  return {
    cpu: metrics?.cpu,
    cores: metrics?.cores,
    memory: {
      used: metrics?.memUsed,
      total: metrics?.memTotal,
    },
    disks: disks.map((disk) => {
      // 采样器用 size / used，兼容 total / free
      const total = disk.size ?? disk.total ?? 0
      const used = disk.used ?? (total - (disk.free ?? 0))
      return {
        mount: disk.mount,
        used,
        total,
        free: Math.max(0, total - used),
        usedPercent: total ? Math.round((used / total) * 100) : null,
      }
    }),
    gpu: metrics?.gpu,
    temp: metrics?.temp,
    uptime: metrics?.uptime,
    processes: processes
      .map((item) => ({
        // 采样器输出字段是 id，模型与动作统一使用 pid
        pid: item.pid ?? item.id,
        name: item.name,
        mem: item.mem,
        cpu: item.cpu,
      }))
      .filter((item) => Number.isInteger(item.pid) && item.pid > 0),
  }
}

function readContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('')
  }
  return typeof content === 'string' ? content : ''
}

export async function analyzeWithAgent({ agent, metrics, prompt, fetchFn = globalThis.fetch }) {
  if (!agent?.enabled) throw new Error('Agent 未启用，请先在管理页配置网关')
  if (typeof fetchFn !== 'function') throw new Error('当前 Node 版本不支持 fetch')

  const endpoint = normalizeAgentEndpoint(agent.baseUrl)
  if (!endpoint) throw new Error('Agent 网关地址为空')

  const question = normalizeText(prompt, 500) || '请分析当前电脑性能，并给出可执行的优化建议。'
  const context = buildContext(metrics)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (agent.apiKey) headers.Authorization = `Bearer ${agent.apiKey}`

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: agent.model,
        temperature: 0.2,
        max_tokens: 700,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `用户问题：${question}\n\n实时指标：\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Agent 网关鉴权失败，请检查 API Key')
      }
      throw new Error(`Agent 网关返回 ${response.status}`)
    }

    const payload = await response.json()
    const content = readContent(payload)
    if (!content) throw new Error('Agent 网关没有返回内容')
    const parsed = parseAgentResponse(content, context.processes)
    return {
      ...parsed,
      permission: agent.permission === 'safe' ? 'safe' : 'advice',
      autoLimit: 2,
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Agent 请求超时，请检查网关是否可用')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// 真正执行 Agent 给出的动作。optimizer / fan / media 由调用方注入，便于测试与复用
// 每个动作独立捕获异常，单个失败不影响其余动作继续执行
export async function executeAgentPlan({ actions = [], optimizer, fan, media }) {
  const executed = []
  for (const action of actions) {
    try {
      let result
      if (action.type === 'fan-set') {
        result = await fan(action.percent)
      } else if (action.type === 'media') {
        await media(action.command)
        result = { command: action.command }
      } else if (action.type === 'open-task-manager') {
        result = await optimizer.run({ action: 'open-task-manager' })
      } else {
        result = await optimizer.run({ action: action.type, pid: action.pid, level: action.level })
      }
      executed.push({ ...action, ok: true, result })
    } catch (err) {
      executed.push({ ...action, ok: false, error: err.message })
    }
  }
  return executed
}
