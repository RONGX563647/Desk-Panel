import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeWithAgent,
  executeAgentPlan,
  normalizeAgentEndpoint,
  parseAgentResponse,
} from '../server/agent.js'

test('Agent 网关地址自动补全 chat/completions', () => {
  assert.equal(normalizeAgentEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(
    normalizeAgentEndpoint('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  )
  assert.equal(normalizeAgentEndpoint(''), '')
})

test('Agent 返回只保留白名单动作和真实进程', () => {
  const processes = [
    { pid: 100, name: 'chrome', mem: 2_000_000, cpu: 10 },
    { pid: 200, name: 'code', mem: 1_000_000, cpu: 5 },
  ]
  const text = JSON.stringify({
    summary: '内存占用偏高',
    risk: 'medium',
    actions: [
      { type: 'trim-process', pid: 100, name: 'chrome', reason: '占用高' },
      { type: 'set-priority', pid: 200, level: 'idle', reason: '后台任务' },
      { type: 'trim-process', pid: 999, name: 'fake', reason: '不存在' },
      { type: 'kill-process', pid: 100, reason: '不允许' },
      { type: 'open-task-manager', reason: '查看详情' },
    ],
  })

  const result = parseAgentResponse(text, processes)
  assert.equal(result.summary, '内存占用偏高')
  assert.equal(result.risk, 'medium')
  assert.deepEqual(
    result.actions.map((action) => action.type),
    ['trim-process', 'set-priority', 'open-task-manager']
  )
  assert.equal(result.actions[0].label, '整理 chrome')
  assert.equal(result.actions[1].level, 'idle')
  assert.equal(result.actions[2].label, '打开任务管理器')
})

test('Agent 支持 fenced JSON 并限制动作数量', () => {
  const processes = [
    { pid: 1, name: 'a' },
    { pid: 2, name: 'b' },
    { pid: 3, name: 'c' },
    { pid: 4, name: 'd' },
  ]
  const payload = {
    summary: 'ok',
    risk: 'low',
    actions: processes.map((process) => ({ type: 'trim-process', pid: process.pid })),
  }
  const result = parseAgentResponse('```json\n' + JSON.stringify(payload) + '\n```', processes)
  assert.equal(result.actions.length, 3)
})

test('Agent 跳过受保护进程和自身进程', () => {
  const processes = [
    { pid: 5, name: 'lsass' },
    { pid: process.pid, name: 'node' },
    { pid: 6, name: 'chrome' },
  ]
  const text = JSON.stringify({
    summary: 'ok',
    risk: 'low',
    actions: [
      { type: 'trim-process', pid: 5 },
      { type: 'trim-process', pid: process.pid },
      { type: 'trim-process', pid: 6 },
    ],
  })
  const result = parseAgentResponse(text, processes)
  assert.deepEqual(
    result.actions.map((action) => action.pid),
    [6]
  )
})

test('Agent 解析结果带权限和自动执行上限', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ summary: 'ok', risk: 'low', actions: [] }) } }],
    }),
  })
  const result = await analyzeWithAgent({
    agent: { enabled: true, permission: 'advice', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock' },
    metrics: {},
    prompt: '测试',
    fetchFn,
  })
  assert.equal(result.permission, 'advice')
  assert.equal(result.autoLimit, 2)
})

test('Agent 非法 JSON 返回可读错误', () => {
  assert.throws(() => parseAgentResponse('not json', []), /格式异常/)
})

test('Agent 解析风扇与媒体动作', () => {
  const text = JSON.stringify({
    summary: '散热偏高',
    risk: 'medium',
    actions: [
      { type: 'fan-set', percent: 60, reason: '降温' },
      { type: 'fan-set', percent: 999, reason: '越界被夹到 100' },
      { type: 'media', command: 'playpause', reason: '暂停' },
      { type: 'media', command: 'bad-command', reason: '非法命令' },
    ],
  })
  const result = parseAgentResponse(text, [])
  assert.equal(result.actions.length, 3)
  assert.deepEqual(result.actions[0], { type: 'fan-set', percent: 60, label: '风扇设为 60%', reason: '降温' })
  assert.equal(result.actions[1].percent, 100)
  assert.equal(result.actions[2].label, '播放/暂停')
})

test('Agent 把采样器的 id 字段映射为 pid 传给模型', async () => {
  let sent = ''
  const fetchFn = async (url, options) => {
    sent = options.body
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ summary: 'ok', risk: 'low', actions: [] }) } }],
      }),
    }
  }
  await analyzeWithAgent({
    agent: { enabled: true, permission: 'safe', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock' },
    metrics: { processes: [{ id: 4321, name: 'chrome', mem: 100, cpu: 1 }] },
    prompt: '测试',
    fetchFn,
  })
  const userMessage = JSON.parse(sent).messages[1].content
  assert.match(userMessage, /"pid": 4321/)
})

test('Agent 把采样器的磁盘 size/used 换算为总量与占比', async () => {
  let sent = ''
  const fetchFn = async (url, options) => {
    sent = options.body
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ summary: 'ok', risk: 'low', actions: [] }) } }],
      }),
    }
  }
  await analyzeWithAgent({
    agent: { enabled: true, permission: 'safe', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock' },
    metrics: { disks: [{ mount: 'C:', size: 100, used: 75 }] },
    prompt: '测试',
    fetchFn,
  })
  const content = JSON.parse(sent).messages[1].content
  assert.match(content, /"mount": "C:"/)
  assert.match(content, /"usedPercent": 75/)
})

test('executeAgentPlan 真正执行并返回每项结果，单失败不中断', async () => {
  const calls = []
  const optimizer = {
    run: async ({ action, pid, level }) => {
      calls.push(['optimize', action, pid, level])
      if (action === 'trim-process' && pid === 9) throw new Error('进程不存在')
      return { action }
    },
  }
  const fan = async (percent) => {
    calls.push(['fan', percent])
    return { percent, count: 7 }
  }
  const media = async (command) => {
    calls.push(['media', command])
  }

  const executed = await executeAgentPlan({
    actions: [
      { type: 'trim-process', pid: 9, name: 'x', label: '整理 x' },
      { type: 'fan-set', percent: 55, label: '风扇设为 55%' },
      { type: 'media', command: 'playpause', label: '播放/暂停' },
    ],
    optimizer,
    fan,
    media,
  })

  assert.equal(executed.length, 3)
  assert.equal(executed[0].ok, false)
  assert.equal(executed[0].error, '进程不存在')
  assert.equal(executed[1].ok, true)
  assert.equal(executed[1].result.count, 7)
  assert.equal(executed[2].ok, true)
  assert.deepEqual(calls, [
    ['optimize', 'trim-process', 9, undefined],
    ['fan', 55],
    ['media', 'playpause'],
  ])
})
