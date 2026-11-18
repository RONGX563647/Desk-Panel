import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function runPowerShell(script, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout },
      (err, stdout) => resolve(err ? '' : String(stdout || ''))
    )
  })
}

function runCommand(file, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout) =>
      resolve(err ? '' : String(stdout || ''))
    )
  })
}

const USB_VID_PID = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i
const HID_VID_PID = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i
const MEDIA_CLASS = '{4d36e96c-e325-11ce-bfc1-08002be10318}'
const KEYBOARD_CLASS = '{4d36e96b-e325-11ce-bfc1-08002be10318}'
const MOUSE_CLASS = '{4d36e96f-e325-11ce-bfc1-08002be10318}'

// 2.4G 接收器对系统而言只是一个 USB 复合设备，键盘和鼠标是它下面并列的 HID 节点；
// 接收器自身不上报电量，所以这类设备的电量只能标为未知，不能猜测填充。
const RECEIVER_NAME = /(receiver|接收器|lightspeed|unifying|bolt|2\.4g|wireless)/i
const RESERVED_DESC = /^@.*;/
const INTERNAL_CONTAINER = '00000000-0000-0000-ffff-ffffffffffff'
// 罗技接收器会额外挂 7 个 Slot 虚拟容器，每个都带同一份型号名，必须剔除
const LAMPARRAY = /&LAMPARRAY/i
// 驱动给的通用名对用户没有意义，只用它们兜底，不当作型号展示
const GENERIC_NAME =
  /^(USB\s*(Composite Device|输入设备|Input Device)|HID[\s-]*(Keyboard|compliant mouse|Keyboard Device)|标准键盘|Microsoft)/i
// 只有「USB Receiver」这种裸名字时说明不了是哪家产品，要让位给总线描述
const BARE_RECEIVER = /^(USB|2\.4G|Wireless)?\s*(Receiver|接收器)$/i

const ROLE_LABELS = { keyboard: '键盘', mouse: '鼠标', audio: '音频' }

// INF 里是 "@oem42.inf,%ls2recvname%;LIGHTSPEED Receiver" 这种形式，取分号后的本地化字符串
function cleanDesc(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const parts = text.split(';')
  const tail = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  const cleaned = tail.trim()
  return RESERVED_DESC.test(cleaned) ? '' : cleaned
}

function roleOf(node) {
  const guid = String(node?.classGuid || '').toLowerCase()
  if (guid === KEYBOARD_CLASS) return 'keyboard'
  if (guid === MOUSE_CLASS) return 'mouse'
  if (guid === MEDIA_CLASS) return 'audio'
  const name = String(node?.className || '').toLowerCase()
  if (name === 'keyboard') return 'keyboard'
  if (name === 'mouse') return 'mouse'
  if (name === 'media') return 'audio'
  return ''
}

// 型号只在 BusReportedDeviceDesc 里有真值（"MCHOSE 2.4G Wireless"），
// FriendlyName 多数是驱动通用名，但厂商自带 INF 时会给出更准确的品牌名（"LIGHTSPEED Receiver"）
function modelName(node) {
  const friendly = cleanDesc(node?.name)
  const reported = cleanDesc(node?.busDesc)
  // 「USB Receiver」这种裸名说明不了是哪家产品，要让位给总线描述
  if (friendly && RECEIVER_NAME.test(friendly) && !BARE_RECEIVER.test(friendly)) return friendly
  return reported || friendly || cleanDesc(node?.deviceDesc)
}

// pnputil 的 Status 只有 Disconnected 代表设备已拔出；
// 被禁用的节点 Status 是 Error/Disabled，同时 ConfigFlags 置 1 或 ProblemCode 为 22
function nodeState(node) {
  const status = String(node?.status || '')
  const present = typeof node?.present === 'boolean' ? node.present : status !== 'Disconnected'
  const disabled =
    (Number(node?.configFlags) & 0x1) === 0x1 ||
    status === 'Disabled' ||
    Number(node?.problemCode) === 22
  return { present, disabled }
}

// pnputil 的 CSV 是「每个设备一行概要 + 每个属性一行」的扁平结构：
// 概要行只有前 10 列，属性行用 Key/Type/Value 三列补充。这里按 InstanceId 聚合回设备。
const CSV_FIELD = /(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g

function parseCsvLine(line) {
  const cells = []
  CSV_FIELD.lastIndex = 0
  let match
  while ((match = CSV_FIELD.exec(line))) {
    cells.push(match[1] != null ? match[1].replace(/""/g, '"') : match[2])
    if (CSV_FIELD.lastIndex >= line.length) break
  }
  return cells
}

export function parsePnputilCsv(text) {
  const nodes = new Map()

  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    const instanceId = String(cells[0] || '').replace(/^\uFEFF/, '')
    // 表头与不合规的行直接跳过
    if (!instanceId || instanceId === 'InstanceId') continue

    let node = nodes.get(instanceId)
    if (!node) {
      node = { instanceId, props: {} }
      nodes.set(instanceId, node)
    }

    if (cells[5]) {
      node.status = cells[5]
      node.className = cells[2] || ''
      node.classGuid = cells[3] || ''
      node.deviceDesc = cells[1] || ''
      continue
    }

    if (cells[12]) node.props[cells[12]] = cells[14] || ''
  }

  const result = []
  for (const node of nodes.values()) {
    // 已从系统中彻底移除的历史记录没有 Status，直接丢弃
    if (!node.status) continue
    const props = node.props
    result.push({
      instanceId: node.instanceId,
      status: node.status,
      className: node.className,
      classGuid: node.classGuid,
      deviceDesc: node.deviceDesc,
      name: props.DEVPKEY_NAME || props.DEVPKEY_Device_DeviceDesc || '',
      containerId: props.DEVPKEY_Device_ContainerId || '',
      busDesc: props.DEVPKEY_Device_BusReportedDeviceDesc || '',
      present: props.DEVPKEY_Device_IsPresent !== 'FALSE' && node.status !== 'Disconnected',
      configFlags: Number(props.DEVPKEY_Device_ConfigFlags || 0) || 0,
      problemCode: Number(props.DEVPKEY_Device_ProblemCode || 0) || 0,
    })
  }

  return result
}

// 输入设备容器把接收器与它背后的键鼠归到一起，因此按 ContainerId 分组即可还原对应关系
export function buildUsbDevices(nodes = []) {
  const containers = new Map()

  for (const node of nodes) {
    const instanceId = String(node?.instanceId || '')
    if (!instanceId || LAMPARRAY.test(instanceId)) continue
    // HID 总线里还混有蓝牙与 VHF 虚拟节点，它们由蓝牙卡片负责，不属于 USB 设备
    if (!/^(USB\\|HID\\VID_)/i.test(instanceId)) continue

    const container = String(node?.containerId || '').toLowerCase().replace(/[{}]/g, '')
    if (!container || container === INTERNAL_CONTAINER) continue

    if (!containers.has(container)) {
      containers.set(container, { roles: new Map(), receiver: null, present: false })
    }
    const group = containers.get(container)
    const { present, disabled } = nodeState(node)
    if (present) group.present = true

    const role = roleOf(node)
    if (role) {
      // 同一容器里同角色会出现多个 HID 集合（MI_00 与 MI_01&Col04），保留状态更健康的一个
      const current = group.roles.get(role)
      const name = modelName(node)
      if (!current || (present && !current.connected)) {
        group.roles.set(role, {
          role,
          label: ROLE_LABELS[role] || role,
          // 接收器下的键鼠节点只有 "HID Keyboard Device" 这种驱动通用名，
          // 平台没有各自的真实型号，宁可留空交给前端说明，也不展示无意义的名字
          name: GENERIC_NAME.test(name) ? '' : name,
          instanceId,
          connected: present,
          disabled,
        })
      }
      continue
    }

    if (!present) continue

    // 顶层 USB 节点（不带 MI_）承载整机型号；是否叫 Receiver 只影响展示措辞
    const isTopLevelUsb = /^USB\\/i.test(instanceId) && !/&MI_/i.test(instanceId)
    if (!isTopLevelUsb) continue

    const name = modelName(node)
    if (!name) continue
    const named = RECEIVER_NAME.test(name)
    if (!group.receiver || (named && !group.receiver.named)) {
      group.receiver = { name, instanceId, named, disabled }
    }
  }

  const result = []
  for (const [container, group] of containers) {
    // 没有任何键鼠/音频角色的容器（硬盘盒、集线器、读卡器）不属于设备卡片
    const roles = [...group.roles.values()]
    if (!roles.length || !group.present) continue

    const receiverName = group.receiver?.name || ''
    const namedReceiver = Boolean(receiverName) && group.receiver?.named
    const hostName = receiverName && !GENERIC_NAME.test(receiverName) ? receiverName : ''

    const vidpid = String(group.receiver?.instanceId || '').match(USB_VID_PID)
    const fallback = String(roles[0]?.instanceId || '').match(HID_VID_PID)
    const vid = vidpid ? vidpid[1] : fallback ? fallback[1] : ''
    const pid = vidpid ? vidpid[2] : fallback ? fallback[2] : ''

    const kinds = new Set(roles.map((role) => role.role))
    const kind = kinds.has('mouse') && kinds.has('keyboard')
      ? '键鼠套装'
      : kinds.has('mouse') ? '鼠标'
        : kinds.has('keyboard') ? '键盘'
          : kinds.has('audio') ? '音频' : 'USB 设备'

    const roleName = roles.map((role) => role.name).find((name) => name && !GENERIC_NAME.test(name)) || ''
    const name = hostName || roleName || kind

    const disabled = roles.every((role) => role.disabled)
    const connected = roles.some((role) => role.connected)

    result.push({
      id: container,
      name,
      kind,
      // link 决定卡片上标注「有线」还是「2.4G 接收器」，两者断开/连接方式相同
      link: namedReceiver ? 'receiver' : 'wired',
      receiver: namedReceiver,
      instanceId: group.receiver?.instanceId || '',
      vid: vid ? `VID_${vid.toUpperCase()}` : '',
      pid: pid ? `PID_${pid.toUpperCase()}` : '',
      roles: roles.map((role) => ({
        role: role.role,
        label: role.label,
        name: role.name,
        instanceId: role.instanceId,
        connected: role.connected,
        disabled: role.disabled,
      })),
      battery: null,
      connected,
      disabled,
    })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

// 系统电池状态：台式机通常没有，返回 null；笔记本可给出电量、充放电状态与剩余时间
const BATTERY_STATUS = {
  1: '放电中',
  2: '已接通电源',
  3: '充电中',
  4: '低电量',
  5: '严重低电量',
  6: '充电中',
  7: '充电中',
  8: '充电中',
  9: '已充满',
  10: '未知',
  11: '已接通电源',
}

export function buildSystemBattery(raw) {
  const item = Array.isArray(raw) ? raw[0] : raw
  if (!item) return null
  const percent = validPercent(item.EstimatedChargeRemaining)
  const status = BATTERY_STATUS[Number(item.BatteryStatus)] || ''
  const minutes = toNumber(item.EstimatedRunTime)
  return {
    name: String(item.Name || '系统电池').trim(),
    percent,
    status,
    charging: Number(item.BatteryStatus) >= 6 && Number(item.BatteryStatus) <= 9,
    minutes: minutes != null && minutes > 0 && minutes < 71582788 ? Math.round(minutes) : null,
  }
}

const BT_DEVICE_ID = /^BTH(?:LE|ENUM)\\DEV_([0-9A-F]{12})\\/i

const BT_CLASS_LABELS = {
  'input.mouse': '鼠标',
  'input.keyboard': '键盘',
  'input.hid': '输入',
  audio: '音频',
  'communication.phone': '手机',
  computer: '电脑',
  printing: '打印机',
  display: '显示',
  network: '网络',
}

function formatBtAddress(raw) {
  const hex = String(raw || '').replace(/[^0-9a-f]/gi, '').toUpperCase()
  return hex.length === 12 ? hex.match(/.{2}/g).join(':') : ''
}

function validPercent(value) {
  if (value == null || value === '') return null
  const num = toNumber(value)
  return num != null && num >= 0 && num <= 100 ? Math.round(num) : null
}

function normalizeBtCategory(value) {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw || '').trim().toLowerCase()
}

// 蓝牙外设的 BTHLE/BTHENUM DEV_ 节点只在设备在线时存在，可直接作为连接依据；
// 电池百分比来自 Windows 写入的 DEVPKEY 属性，仅 HID/手机等会提供
export function buildBluetoothDevices(raw = []) {
  const bluetooth = new Map()

  for (const item of raw) {
    const name = String(item?.Name || '').trim()
    const id = String(item?.InstanceId || item?.Id || '')
    const match = id.match(BT_DEVICE_ID)
    if (!name || !match) continue
    const address = formatBtAddress(item?.Address || match[1])
    const key = address || id.toLowerCase()
    if (bluetooth.has(key)) continue
    bluetooth.set(key, {
      name,
      class: BT_CLASS_LABELS[normalizeBtCategory(item?.Category)] || '蓝牙',
      address,
      battery: validPercent(item?.Battery),
    })
  }

  return [...bluetooth.values()].sort(
    (a, b) => (b.battery ?? -1) - (a.battery ?? -1) || a.name.localeCompare(b.name, 'zh-CN')
  )
}

// CPU / 内存走 Node 原生接口，1 分钟一次近乎零开销；
// WMI 类接口在这类机器上单次可能耗时数十秒，因此只用轻量的 statfs、nvidia-smi、ACPI 温度和网络计数器。

const POWER_COMPONENT = /(cpu|gpu|graphics|core|memory|dram|vrm|soc)/i
const POWER_TOTAL = /(psu|system|total|wall|platform|整机|平台)/i
// 核显功耗已被 CPU 封装包含，只统计独显，避免重复计算
const DISCRETE_GPU = /(nvidia|geforce|radeon rx|arc a|arc b)/i

function parseWatts(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const watts = Number.parseFloat(match[0])
  return Number.isFinite(watts) && watts >= 0 ? Math.round(watts * 10) / 10 : null
}

function collectPowerSensors(node, hardwareName, out) {
  if (!node || typeof node !== 'object') return
  const hardware = node.HardwareId ? node.Text : hardwareName
  if (node.Type === 'Power' && node.SensorId) {
    const value = parseWatts(node.RawValue ?? node.Value)
    if (value != null) out.push({ hardware: hardware || '', name: node.Text || 'Power', value })
  }
  for (const child of node.Children || []) collectPowerSensors(child, hardware, out)
}

function parseVolts(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const volts = Number.parseFloat(match[0])
  return Number.isFinite(volts) && volts > 0 ? Math.round(volts * 100) / 100 : null
}

function collectVoltageSensors(node, hardwareName, out) {
  if (!node || typeof node !== 'object') return
  const hardware = node.HardwareId ? node.Text : hardwareName
  if (node.Type === 'Voltage' && node.SensorId) {
    const value = parseVolts(node.RawValue ?? node.Value)
    if (value != null) out.push({ hardware: hardware || '', name: node.Text || 'Voltage', value })
  }
  for (const child of node.Children || []) collectVoltageSensors(child, hardware, out)
}

// 只挑关键电压：CPU、显卡、内存与电源主轨，避免卡片塞满十几个传感器
export function summarizeVoltages(sensors = []) {
  const list = Array.isArray(sensors) ? sensors : []

  function pick(test) {
    for (const sensor of list) {
      if (test(sensor)) return Math.round(sensor.value * 100) / 100
    }
    return null
  }

  const result = {}
  const cpu =
    pick((sensor) => /^cpu core$/i.test(sensor.name)) ||
    pick((sensor) => /^vcore$/i.test(sensor.name))
  const gpu = pick((sensor) => /gpu (core )?voltage/i.test(sensor.name))
  const mem = pick((sensor) => /^(dimm|dram|memory voltage)/i.test(sensor.name))
  const p12 = pick((sensor) => /^\+?12\s*v/i.test(sensor.name))
  const p5 = pick((sensor) => /^\+?5\s*v/i.test(sensor.name))
  const p3 = pick(
    (sensor) => /^\+?3(\.3)?\s*v/i.test(sensor.name) || /^avcc3$/i.test(sensor.name)
  )

  if (cpu != null) result.cpu = cpu
  if (gpu != null) result.gpu = gpu
  if (mem != null) result.mem = mem
  if (p12 != null) result.p12 = p12
  if (p5 != null) result.p5 = p5
  if (p3 != null) result.p3 = p3
  return Object.keys(result).length ? result : null
}

const SENSOR_TYPES = new Set([
  'Temperature',
  'Voltage',
  'Power',
  'Clock',
  'Load',
  'Level',
  'Factor',
  'Data',
  'SmallData',
  'Throughput',
  'Fan',
  'Control',
])

const RATE_FACTORS = { 'b/s': 1, 'kb/s': 1024, 'mb/s': 1024 ** 2, 'gb/s': 1024 ** 3 }
const SIZE_FACTORS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }

const TEMP_ORDER = { cpu: 0, gpu: 1, board: 2, storage: 3, other: 4 }
const VOLT_ORDER = { board: 0, cpu: 1, gpu: 2, storage: 3, other: 4 }

const round1 = (value) => Math.round(value * 10) / 10
const round2 = (value) => Math.round(value * 100) / 100

function parseSensorValue(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/)
  if (!match) return null
  const number = Number.parseFloat(match[1])
  if (!Number.isFinite(number)) return null
  return { value: number, unit: match[2].trim() }
}

// 递归收集 LHM 树里的全部传感器（数值 + 单位），供硬件详情卡片分组展示
function collectAllSensors(node, hardwareName, out) {
  if (!node || typeof node !== 'object') return
  const hardware = node.HardwareId ? node.Text : hardwareName
  if (node.SensorId && SENSOR_TYPES.has(node.Type)) {
    const parsed = parseSensorValue(node.Value)
    if (parsed) {
      out.push({
        hardware: hardware || '未知硬件',
        type: node.Type,
        name: node.Text || node.Type,
        value: parsed.value,
        unit: parsed.unit,
      })
    }
  }
  for (const child of node.Children || []) collectAllSensors(child, hardware, out)
}

function rateBytes(sensor) {
  if (!sensor) return null
  const factor = RATE_FACTORS[String(sensor.unit || '').toLowerCase()] || 1
  return Math.round(sensor.value * factor)
}

function sizeGB(sensor) {
  if (!sensor) return null
  const factor = SIZE_FACTORS[String(sensor.unit || '').toLowerCase()] || 1
  const gb = (sensor.value * factor) / 1024 ** 3
  // 个别磁盘 SMART 数据异常（负数或天文数字）直接丢弃，避免显示明显错误的值
  return gb > 0 && gb < 100000 ? round1(gb) : null
}

function percentOf(sensor) {
  if (!sensor || sensor.value < 0 || sensor.value > 100) return null
  return round1(sensor.value)
}

function hardwareKind(name, items) {
  const has = (type, pattern) =>
    items.some((sensor) => sensor.type === type && pattern.test(sensor.name))
  if (has('Level', /^life$/i) || has('Factor', /^power on hours$/i)) return 'disk'
  if (/^(total|virtual) memory$/i.test(name)) return 'memory'
  if (items.some((sensor) => sensor.type === 'Timing')) return 'memoryModule'
  if (has('Load', /^cpu total$/i) || has('Load', /^cpu core max$/i)) return 'cpu'
  if (has('Throughput', /^(upload|download) speed$/i)) return 'network'
  if (has('Power', /^gpu (package|power)$/i)) return 'gpu'
  if (has('Voltage', /^\+?12\s*v$/i) || has('Voltage', /^vcore$/i)) return 'board'
  return 'other'
}

function tempGroup(kind) {
  if (kind === 'cpu' || kind === 'gpu' || kind === 'board') return kind
  if (kind === 'disk' || kind === 'memoryModule') return 'storage'
  return 'other'
}

function voltGroup(kind) {
  if (kind === 'cpu' || kind === 'gpu' || kind === 'board') return kind
  if (kind === 'memoryModule') return 'storage'
  return 'other'
}

function buildCpu(hardware, items) {
  const pick = (type, pattern) =>
    items.find((sensor) => sensor.type === type && pattern.test(sensor.name))
  const cores = new Map()
  for (const sensor of items) {
    const match = sensor.name.match(/^CPU Core #(\d+)/i)
    if (!match) continue
    const index = Number(match[1])
    if (!cores.has(index)) {
      cores.set(index, { index, temp: null, clockMHz: null, voltage: null, tjMax: null })
    }
    const core = cores.get(index)
    if (sensor.type === 'Temperature' && /Distance to TjMax$/i.test(sensor.name)) {
      core.tjMax = round1(sensor.value)
    } else if (sensor.type === 'Temperature' && /^CPU Core #\d+$/i.test(sensor.name)) {
      core.temp = round1(sensor.value)
    } else if (sensor.type === 'Clock') {
      core.clockMHz = Math.round(sensor.value)
    } else if (sensor.type === 'Voltage') {
      core.voltage = round2(sensor.value)
    }
  }
  const coreMax = pick('Temperature', /^core max$/i)
  const coreAverage = pick('Temperature', /^core average$/i)
  const packageTemp = pick('Temperature', /^cpu package$/i)
  const totalLoad = pick('Load', /^cpu total$/i)
  const power = pick('Power', /^cpu package$/i)
  return {
    model: hardware,
    coreMax: coreMax ? round1(coreMax.value) : null,
    coreAverage: coreAverage ? round1(coreAverage.value) : null,
    packageTemp: packageTemp ? round1(packageTemp.value) : null,
    totalLoad: totalLoad ? round1(totalLoad.value) : null,
    powerWatts: power ? round1(power.value) : null,
    cores: [...cores.values()].sort((a, b) => a.index - b.index),
  }
}

function buildGpu(hardware, items) {
  const pick = (type, pattern) =>
    items.find((sensor) => sensor.type === type && pattern.test(sensor.name))
  const pickTemperature = (pattern) => {
    const sensor = pick('Temperature', pattern)
    return sensor ? round1(sensor.value) : null
  }
  const pickLoad = (pattern) => {
    const sensor = pick('Load', pattern)
    return sensor ? round1(sensor.value) : null
  }
  const power = pick('Power', /^gpu (package|power)$/i)
  const voltage = pick('Voltage', /gpu (core )?voltage/i)
  const coreClock = pick('Clock', /^gpu core$/i)
  const memoryUsed = pick('SmallData', /^gpu memory used$/i)
  const memoryTotal = pick('SmallData', /^gpu memory total$/i)
  const fan = pick('Fan', /^gpu$/i)
  const fanControl = pick('Control', /^gpu fan$/i)
  return {
    name: hardware,
    integrated: !/nvidia|geforce|radeon rx|arc a|arc b/i.test(hardware),
    coreTemp: pickTemperature(/^gpu core$/i),
    hotspotTemp: pickTemperature(/hot ?spot/i),
    powerWatts: power ? round1(power.value) : null,
    coreVoltage: voltage ? round2(voltage.value) : null,
    coreClockMHz: coreClock ? Math.round(coreClock.value) : null,
    memoryUsedMB: memoryUsed ? Math.round(memoryUsed.value) : null,
    memoryTotalMB: memoryTotal ? Math.round(memoryTotal.value) : null,
    memoryLoad: pickLoad(/^gpu memory$/i),
    fanRpm: fan ? Math.round(fan.value) : null,
    fanPercent: fanControl ? Math.round(fanControl.value) : null,
    pcieRx: rateBytes(pick('Throughput', /gpu pcie rx/i)),
    pcieTx: rateBytes(pick('Throughput', /gpu pcie tx/i)),
  }
}

function buildDisk(hardware, items) {
  const pick = (type, pattern) =>
    items.find((sensor) => sensor.type === type && pattern.test(sensor.name))
  const temp = pick('Temperature', /temperature$/i)
  const hours = pick('Factor', /^power on hours$/i)
  const count = pick('Factor', /^power on count$/i)
  return {
    name: hardware,
    temp: temp ? round1(temp.value) : null,
    life: percentOf(pick('Level', /^life$/i)),
    spare: percentOf(pick('Level', /^available spare$/i)),
    powerOnHours: hours ? Math.round(hours.value) : null,
    powerOnCount: count ? Math.round(count.value) : null,
    usedPercent: percentOf(pick('Load', /^used space$/i)),
    readRate: rateBytes(pick('Throughput', /^read rate$/i)),
    writeRate: rateBytes(pick('Throughput', /^write rate$/i)),
    freeGB: sizeGB(pick('Data', /^free space$/i)),
    totalGB: sizeGB(pick('Data', /^total space$/i)),
    dataReadGB: sizeGB(pick('Data', /^data read$/i)),
    dataWrittenGB: sizeGB(pick('Data', /^data written$/i)),
  }
}

function buildMemory(hardware, items) {
  const pick = (type, pattern) =>
    items.find((sensor) => sensor.type === type && pattern.test(sensor.name))
  const load = pick('Load', /^memory$/i)
  return {
    load: load ? round1(load.value) : null,
    usedGB: sizeGB(pick('Data', /^memory used$/i)),
    availableGB: sizeGB(pick('Data', /^memory available$/i)),
  }
}

// DIMM 只给容量与两条关键时序，换算成常见的内存频率与 CAS 延迟
function buildMemoryModule(hardware, items) {
  const capacity = sizeGB(items.find((sensor) => sensor.type === 'Data' && /^capacity$/i.test(sensor.name)))
  const cycle = items.find((sensor) => /^tCKAVGmin/i.test(sensor.name))
  const casTime = items.find((sensor) => /^tAA/i.test(sensor.name))
  const speedMHz = cycle && cycle.value > 0 ? Math.round(1000 / cycle.value) : null
  const cas = cycle && casTime && cycle.value > 0 ? Math.round(casTime.value / cycle.value) : null
  if (capacity == null && speedMHz == null) return null
  return { name: hardware, capacityGB: capacity, speedMHz, cas }
}

function buildNetwork(hardware, items) {
  const pick = (pattern) =>
    items.find((sensor) => sensor.type === 'Throughput' && pattern.test(sensor.name))
  const utilization = items.find(
    (sensor) => sensor.type === 'Load' && /network utilization/i.test(sensor.name)
  )
  return {
    name: hardware,
    rx: rateBytes(pick(/download speed/i)),
    tx: rateBytes(pick(/upload speed/i)),
    utilization: utilization ? round1(utilization.value) : null,
  }
}

function buildFans(items) {
  const fans = new Map()
  for (const sensor of items) {
    if (sensor.type !== 'Fan' && sensor.type !== 'Control') continue
    if (!fans.has(sensor.name)) {
      fans.set(sensor.name, { name: sensor.name, rpm: null, percent: null })
    }
    const fan = fans.get(sensor.name)
    if (sensor.type === 'Fan') fan.rpm = Math.round(sensor.value)
    else fan.percent = Math.round(sensor.value)
  }
  return [...fans.values()]
}

// 把 LHM 的全部传感器整理成硬件详情卡片所需的分组结构
export function summarizeSensors(sensors = []) {
  const list = Array.isArray(sensors) ? sensors : []
  const groups = new Map()
  for (const sensor of list) {
    if (!groups.has(sensor.hardware)) groups.set(sensor.hardware, [])
    groups.get(sensor.hardware).push(sensor)
  }

  const summary = {
    available: list.length > 0,
    temperatures: [],
    voltages: [],
    cpu: null,
    gpus: [],
    disks: [],
    memory: { total: null, virtual: null, modules: [] },
    networks: [],
    fans: [],
  }

  for (const [hardware, items] of groups) {
    const kind = hardwareKind(hardware, items)
    if (kind === 'cpu') summary.cpu = buildCpu(hardware, items)
    else if (kind === 'gpu') summary.gpus.push(buildGpu(hardware, items))
    else if (kind === 'disk') summary.disks.push(buildDisk(hardware, items))
    else if (kind === 'memoryModule') {
      const module = buildMemoryModule(hardware, items)
      if (module) summary.memory.modules.push(module)
    } else if (kind === 'memory') {
      summary.memory[/^virtual/i.test(hardware) ? 'virtual' : 'total'] = buildMemory(hardware, items)
    } else if (kind === 'network') summary.networks.push(buildNetwork(hardware, items))
    else if (kind === 'board') summary.fans.push(...buildFans(items))

    for (const sensor of items) {
      if (sensor.type === 'Temperature') {
        if (/distance to tjmax|warning temperature|critical temperature/i.test(sensor.name)) continue
        if (sensor.value < -20 || sensor.value > 150) continue
        summary.temperatures.push({
          hardware,
          name: sensor.name,
          value: round1(sensor.value),
          group: tempGroup(kind),
        })
      } else if (sensor.type === 'Voltage') {
        if (sensor.value <= 0 || sensor.value > 30) continue
        summary.voltages.push({
          hardware,
          name: sensor.name,
          value: round2(sensor.value),
          group: voltGroup(kind),
        })
      }
    }
  }

  summary.temperatures.sort(
    (a, b) =>
      (TEMP_ORDER[a.group] ?? 9) - (TEMP_ORDER[b.group] ?? 9) ||
      a.hardware.localeCompare(b.hardware, 'zh-CN') ||
      a.name.localeCompare(b.name, 'zh-CN')
  )
  summary.voltages.sort(
    (a, b) =>
      (VOLT_ORDER[a.group] ?? 9) - (VOLT_ORDER[b.group] ?? 9) ||
      a.name.localeCompare(b.name, 'zh-CN')
  )
  summary.gpus.sort((a, b) => Number(a.integrated) - Number(b.integrated))
  summary.networks.sort((a, b) => (b.rx || 0) + (b.tx || 0) - ((a.rx || 0) + (a.tx || 0)))
  return summary
}

// 优先使用整机功耗传感器（PSU / System / 电池），否则汇总可测部件
export function summarizePowerSensors(sensors = []) {
  const list = Array.isArray(sensors) ? sensors : []
  const totalSensor = list.find(
    (sensor) => !POWER_COMPONENT.test(sensor.name) && POWER_TOTAL.test(sensor.name)
  )
  const packageSensor = list.find((sensor) => /^cpu package$/i.test(sensor.name))
  const coresSensor = list.find((sensor) => /^cpu cores$/i.test(sensor.name))
  const memorySensor = list.find((sensor) => /^cpu memory$/i.test(sensor.name))

  const cpuWatts = packageSensor?.value ?? coresSensor?.value ?? null
  const memWatts = memorySensor?.value ?? null

  const gpuByHardware = new Map()
  for (const sensor of list) {
    if (!DISCRETE_GPU.test(sensor.hardware)) continue
    const current = gpuByHardware.get(sensor.hardware)
    if (
      !current ||
      (/package/i.test(sensor.name) && !/package/i.test(current.name)) ||
      sensor.value > current.value
    ) {
      gpuByHardware.set(sensor.hardware, sensor)
    }
  }
  const gpuWatts = gpuByHardware.size
    ? Math.round([...gpuByHardware.values()].reduce((sum, sensor) => sum + sensor.value, 0) * 10) / 10
    : null

  if (totalSensor) {
    return { watts: totalSensor.value, cpuWatts, gpuWatts, memWatts, whole: true, source: 'sensor' }
  }

  if (cpuWatts == null && gpuWatts == null) return null

  const watts = Math.round(((cpuWatts || 0) + (memWatts || 0) + (gpuWatts || 0)) * 10) / 10
  return { watts, cpuWatts, gpuWatts, memWatts, whole: false, source: 'parts' }
}

export function createSampler({
  networkIntervalMs = 30000,
  hardwareIntervalMs = 60000,
  getFanUrl = () => 'http://127.0.0.1:8085',
} = {}) {
  let prevCpu = null
  let netPrev = null
  let netRate = { rx: 0, tx: 0 }
  let latency = null
  let diskCache = { mount: 'C:', used: 0, size: 0 }
  let diskList = null
  let diskAt = 0
  let lhmCache = { at: 0, url: '', tree: null }
  let hardware = {
    gpu: null,
    temp: null,
    processCount: null,
    processes: [],
    power: null,
    fan: null,
    sensors: null,
    devices: { usb: [], bluetooth: [], battery: null },
  }
  let hardwareBusy = false
  let networkBusy = false
  let netTimer = null
  let hardwareTimer = null

  function readCpu() {
    const snapshot = os.cpus().map((c) => {
      const t = c.times
      return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }
    })

    // 第一次采样没有可比较的基准，返回 null 让前端显示 "--"，避免误报 0%
    if (!prevCpu) {
      prevCpu = snapshot
      return { load: null, cores: Array(snapshot.length).fill(null) }
    }

    const cores = []
    let totalDelta = 0
    let idleDelta = 0

    for (let i = 0; i < snapshot.length; i++) {
      const prev = prevCpu[i]
      if (!prev) {
        cores.push(null)
        continue
      }
      const dTotal = snapshot[i].total - prev.total
      const dIdle = snapshot[i].idle - prev.idle
      if (dTotal <= 0) {
        cores.push(null)
        continue
      }
      cores.push(Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))))
      totalDelta += dTotal
      idleDelta += dIdle
    }

    prevCpu = snapshot
    const load = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
    return { load, cores }
  }

  function readDisk(force = false) {
    const now = Date.now()
    if (!force && now - diskAt < 10000) return diskCache
    try {
      const st = fs.statfsSync('C:\\')
      const size = st.blocks * st.bsize
      const free = st.bavail * st.bsize
      diskCache = { mount: 'C:', size, used: size - free }
      diskAt = now
    } catch {
      /* 读不到就沿用上一次的值 */
    }
    return diskCache
  }

  async function refreshDisks() {
    const found = await Promise.all(
      DRIVE_LETTERS.map(async (letter) => {
        try {
          const st = await fs.promises.statfs(`${letter}:\\`)
          const size = st.blocks * st.bsize
          if (!size) return null
          return { mount: `${letter}:`, size, used: size - st.bavail * st.bsize }
        } catch {
          return null
        }
      })
    )
    const disks = found.filter(Boolean)
    if (disks.length) diskList = disks
  }

  async function refreshNetwork() {
    const output = await runPowerShell(
      'Get-NetAdapterStatistics | Sort-Object ReceivedBytes -Descending | Select-Object -First 1 ReceivedBytes,SentBytes | ConvertTo-Json -Compress'
    )
    if (!output.trim()) return
    try {
      const data = JSON.parse(output)
      const rx = Number(data.ReceivedBytes)
      const tx = Number(data.SentBytes)
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) return
      const now = Date.now()
      if (netPrev) {
        const dt = (now - netPrev.t) / 1000
        if (dt > 0) {
          netRate = {
            rx: Math.max(0, Math.round((rx - netPrev.rx) / dt)),
            tx: Math.max(0, Math.round((tx - netPrev.tx) / dt)),
          }
        }
      }
      netPrev = { rx, tx, t: now }
    } catch {
      /* 输出不是合法 JSON 时忽略本次刷新 */
    }
  }

  function refreshGpu() {
    return new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        [
          '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err || !String(stdout).trim()) {
            resolve()
            return
          }
          const [model, utilization, memoryUsed, memoryTotal, temperature] = String(stdout)
            .trim()
            .split('\n')[0]
            .split(',')
            .map((item) => item.trim())
          hardware.gpu = model
            ? {
                model,
                vendor: 'NVIDIA',
                utilization: toNumber(utilization),
                memoryUsed: (toNumber(memoryUsed) ?? 0) * 1024 * 1024,
                memoryTotal: (toNumber(memoryTotal) ?? 0) * 1024 * 1024,
                temperature: toNumber(temperature),
              }
            : null
          resolve()
        }
      )
    })
  }

  // ACPI 热区温度，单位是 0.1K，单次约 0.3s，可安全放进 60s 轮询
  async function refreshCpuTemp() {
    const output = await runPowerShell(
      '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Measure-Object -Property CurrentTemperature -Maximum).Maximum',
      8000
    )
    const raw = toNumber(output.trim())
    if (raw == null || raw <= 0) {
      hardware.temp = null
      return
    }
    const celsius = raw / 10 - 273.15
    hardware.temp = celsius > -20 && celsius < 150 ? Math.round(celsius * 10) / 10 : null
  }

  // pnputil 一次导出 USB 与 HID 两条总线的全部属性（约 0.6s），
  // 既能拿到 BusReportedDeviceDesc 真实型号，也能用 Status 区分在插/已拔出/已禁用。
  // 注意输出文件是 UTF-16LE，必须显式按 utf16le 读，否则中文描述会变成乱码。
  async function refreshUsbDevices() {
    const stamp = `${process.pid}-${Date.now()}`
    const files = ['USB', 'HID'].map((bus) =>
      path.join(os.tmpdir(), `deskpanel-pnp-${bus}-${stamp}.csv`)
    )

    try {
      await Promise.all(
        files.map((file, index) =>
          runCommand(
            'pnputil.exe',
            ['/enum-devices', '/bus', index === 0 ? 'USB' : 'HID', '/properties', '/format', 'csv', '/output-file', file],
            15000
          )
        )
      )

      const nodes = []
      for (const file of files) {
        let text = ''
        try {
          text = fs.readFileSync(file, 'utf16le')
        } catch {
          continue
        }
        nodes.push(...parsePnputilCsv(text))
      }

      if (!nodes.length) return
      hardware.devices.usb = buildUsbDevices(nodes)
    } finally {
      for (const file of files) {
        try {
          fs.unlinkSync(file)
        } catch {
          /* 临时文件已不存在时忽略 */
        }
      }
    }
  }

  // BTHLE/BTHENUM 的 DEV_ 节点仅在设备在线时存在，因此用 PnP 枚举即可判断连接状态，
  // 同时读取 Windows 记录的电池百分比与设备类别，避免 WinRT 逐个握手带来的额外延迟
  async function refreshBluetoothDevices() {
    const script = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$OutputEncoding=[Text.Encoding]::UTF8
$nodes = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
  $_.InstanceId -like 'BTHLE\\DEV_*' -or $_.InstanceId -like 'BTHENUM\\DEV_*'
})
$batteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$result = @()
foreach ($node in $nodes) {
  $battery = $null
  $category = ''
  $address = ''
  try {
    $props = Get-PnpDeviceProperty -InstanceId $node.InstanceId -ErrorAction SilentlyContinue |
      Where-Object { $_.KeyName -eq $batteryKey -or $_.KeyName -eq 'DEVPKEY_DeviceContainer_Category' -or $_.KeyName -eq 'DEVPKEY_Bluetooth_DeviceAddress' }
    foreach ($prop in $props) {
      if ($prop.KeyName -eq $batteryKey) { $battery = $prop.Data }
      elseif ($prop.KeyName -eq 'DEVPKEY_DeviceContainer_Category') { $category = $prop.Data }
      elseif ($prop.KeyName -eq 'DEVPKEY_Bluetooth_DeviceAddress') { $address = $prop.Data }
    }
  } catch {}
  $result += [pscustomobject]@{
    Name = $node.FriendlyName
    InstanceId = $node.InstanceId
    Address = $address
    Category = $category
    Battery = $battery
  }
}
$result | ConvertTo-Json -Compress -Depth 3
`
    const output = await runPowerShell(script, 15000)
    if (!output.trim()) {
      hardware.devices.bluetooth = []
      return
    }
    try {
      const data = JSON.parse(output)
      const list = Array.isArray(data) ? data : data ? [data] : []
      hardware.devices.bluetooth = buildBluetoothDevices(list)
    } catch {
      hardware.devices.bluetooth = []
    }
  }

  // 系统电池：台式机查询结果为空，此时保持 null 让前端隐藏该区块
  async function refreshSystemBattery() {
    const output = await runPowerShell(
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object Name,EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress -Depth 3`,
      12000
    )
    if (!output.trim()) {
      hardware.devices.battery = null
      return
    }
    try {
      hardware.devices.battery = buildSystemBattery(JSON.parse(output))
    } catch {
      hardware.devices.battery = null
    }
  }

  async function refreshDevices() {
    await Promise.all([refreshUsbDevices(), refreshBluetoothDevices(), refreshSystemBattery()])
  }

  async function refreshProcesses() {
    const output = await runPowerShell(
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $all = Get-Process; @{ count = $all.Count; top = @($all | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 ProcessName,Id,WorkingSet64,CPU) } | ConvertTo-Json -Compress -Depth 3`,
      10000
    )
    if (!output.trim()) return
    try {
      const data = JSON.parse(output)
      const rawList = Array.isArray(data?.top) ? data.top : data?.top ? [data.top] : []
      const list = rawList
        .map((item) => ({
          id: Number.isInteger(item?.Id) ? item.Id : null,
          name: typeof item?.ProcessName === 'string' ? item.ProcessName : '',
          mem: toNumber(item?.WorkingSet64) ?? 0,
          cpu: toNumber(item?.CPU) ?? 0,
        }))
        .filter((item) => item.name && item.mem > 0)
      hardware.processes = list
      const count = toNumber(data?.count)
      if (count != null) hardware.processCount = Math.round(count)
    } catch {
      /* 输出不是合法 JSON 时忽略本次刷新 */
    }
  }

  // 同一轮硬件采集里风扇和功耗都会读 LHM，短缓存避免重复请求
  async function fetchLhmTree() {
    const url = (getFanUrl?.() || 'http://127.0.0.1:8085').replace(/\/+$/, '')
    const now = Date.now()
    if (lhmCache.tree && lhmCache.url === url && now - lhmCache.at < 5000) {
      return lhmCache.tree
    }
    const res = await fetch(`${url}/data.json`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const tree = await res.json()
    lhmCache = { at: now, url, tree }
    return tree
  }

  // 优先从 LibreHardwareMonitor 读取整机功耗传感器，其次汇总 CPU、内存与独显
  async function readLhmPower() {
    try {
      const tree = await fetchLhmTree()
      const sensors = []
      const voltageSensors = []
      collectPowerSensors(tree, '', sensors)
      collectVoltageSensors(tree, '', voltageSensors)
      const power = summarizePowerSensors(sensors)
      if (power) {
        const voltages = summarizeVoltages(voltageSensors)
        if (voltages) power.voltages = voltages
      }
      return power
    } catch {
      return null
    }
  }

  // 没有 LHM 时回退到 RAPL 计数器与 nvidia-smi
  async function readRaplPower() {
    const [meterOut, gpuOut] = await Promise.all([
      runPowerShell(
        "$s = (Get-Counter '\\Energy Meter(*)\\Power' -ErrorAction SilentlyContinue).CounterSamples; @{ psys = ($s | Where-Object { $_.InstanceName -match 'psys|platform' } | Select-Object -First 1).CookedValue; pkg = ($s | Where-Object { $_.InstanceName -eq 'rapl_package0_pkg' } | Select-Object -First 1).CookedValue; dram = ($s | Where-Object { $_.InstanceName -eq 'rapl_package0_dram' } | Select-Object -First 1).CookedValue } | ConvertTo-Json -Compress",
        6000
      ),
      runCommand('nvidia-smi', ['--query-gpu=power.draw', '--format=csv,noheader,nounits'], 4000),
    ])

    let psys = null
    let pkg = null
    let dram = null
    try {
      const data = JSON.parse(meterOut)
      psys = toNumber(data?.psys)
      pkg = toNumber(data?.pkg)
      dram = toNumber(data?.dram)
    } catch {
      /* 计数器不可用时只使用显卡功耗 */
    }

    const toWatts = (milliwatts) =>
      milliwatts != null && milliwatts > 0 ? Math.round((milliwatts / 1000) * 10) / 10 : null

    const cpuWatts = toWatts(pkg)
    const memWatts = toWatts(dram)
    const platformWatts = toWatts(psys)

    const gpus = gpuOut
      .split(/\r?\n/)
      .map((line) => Number.parseFloat(line.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0)
    const gpuWatts = gpus.length
      ? Math.round(gpus.reduce((sum, value) => sum + value, 0) * 10) / 10
      : null

    if (platformWatts != null) {
      return { watts: platformWatts, cpuWatts, gpuWatts, memWatts, whole: true, source: 'rapl' }
    }
    if (cpuWatts == null && gpuWatts == null) return null
    return {
      watts: Math.round(((cpuWatts || 0) + (memWatts || 0) + (gpuWatts || 0)) * 10) / 10,
      cpuWatts,
      gpuWatts,
      memWatts,
      whole: false,
      source: 'rapl',
    }
  }

  async function readDesktopPower() {
    const result = (await readLhmPower()) || (await readRaplPower())
    if (!result) return null
    return { present: false, percent: null, status: 0, charging: false, ...result }
  }

  async function refreshPower() {
    const output = await runPowerShell(
      `$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus; if ($b) { $s = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1; $d = 0; $c = 0; $v = 0; if ($s) { $d = [double]$s.DischargeRate; $c = [double]$s.ChargeRate; $v = [double]$s.Voltage }; @{ present = $true; percent = [int]$b.EstimatedChargeRemaining; status = [int]$b.BatteryStatus; dischargeRate = $d; chargeRate = $c; voltage = $v } | ConvertTo-Json -Compress } else { '{"present":false}' }`,
      8000
    )
    if (!output.trim()) return
    try {
      const data = JSON.parse(output)
      if (!data?.present) {
        hardware.power = (await readDesktopPower()) || {
          present: false,
          percent: null,
          status: 0,
          charging: false,
        }
        return
      }
      const percent = toNumber(data.percent)
      const status = Math.round(toNumber(data.status) ?? 0)
      const charging = [2, 6, 7, 8, 9].includes(status)
      // 电池放电功率就是整机功耗；充电时读到的只是充入电池的功率
      const dischargeRate = toNumber(data.dischargeRate)
      const chargeRate = toNumber(data.chargeRate)
      const batteryWatts =
        dischargeRate != null && dischargeRate > 0 && !charging
          ? Math.round((dischargeRate / 1000) * 10) / 10
          : chargeRate != null && chargeRate > 0
            ? Math.round((chargeRate / 1000) * 10) / 10
            : null
      const batteryVolts = toNumber(data.voltage)
      hardware.power = {
        present: true,
        percent: percent == null ? null : Math.max(0, Math.min(100, Math.round(percent))),
        status,
        charging,
        watts: batteryWatts,
        whole: batteryWatts != null && !charging,
        source: batteryWatts != null ? (charging ? 'charge' : 'battery') : null,
        voltages:
          batteryVolts != null && batteryVolts > 0
            ? { battery: Math.round((batteryVolts / 1000) * 100) / 100 }
            : null,
      }
    } catch {
      /* 输出不是合法 JSON 时忽略本次刷新 */
    }
  }

  function collectFanSensors(node, hardwareName, out) {
    if (!node || typeof node !== 'object') return
    const group = node.HardwareId ? node.Text : hardwareName
    if ((node.Type === 'Fan' || node.Type === 'Control') && node.SensorId) {
      const match = String(node.RawValue ?? node.Value ?? '').match(/-?\d+(?:\.\d+)?/)
      const value = match ? Number.parseFloat(match[0]) : null
      if (value != null && Number.isFinite(value)) {
        out.push({ type: node.Type, name: node.Text || node.Type, group: group || '主板', value })
      }
    }
    for (const child of node.Children || []) collectFanSensors(child, group, out)
  }

  // 风扇数据来自 LibreHardwareMonitor 的 Web Server（默认 8085），它负责底层 EC 访问
  async function refreshFan() {
    const url = (getFanUrl?.() || 'http://127.0.0.1:8085').replace(/\/+$/, '')
    try {
      const tree = await fetchLhmTree()
      const sensors = []
      collectFanSensors(tree, '', sensors)
      hardware.fan = {
        available: true,
        url,
        fans: sensors.filter((item) => item.type === 'Fan').slice(0, 6),
        controls: sensors.filter((item) => item.type === 'Control').slice(0, 6),
        at: Date.now(),
      }
    } catch (err) {
      hardware.fan = {
        available: false,
        url,
        fans: [],
        controls: [],
        error: err?.name === 'TimeoutError' ? '连接超时' : '未连接 LibreHardwareMonitor',
      }
    }
  }

  // 硬件详情卡片：一次读取 LHM 全量传感器，按温度、电压、核心、存储等分组
  async function refreshSensors() {
    const url = (getFanUrl?.() || 'http://127.0.0.1:8085').replace(/\/+$/, '')
    try {
      const res = await fetch(`${url}/data.json`, { signal: AbortSignal.timeout(2500) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const tree = await res.json()
      const sensors = []
      collectAllSensors(tree, '', sensors)
      hardware.sensors = { ...summarizeSensors(sensors), url, at: Date.now() }
    } catch (err) {
      hardware.sensors = {
        available: false,
        url,
        at: Date.now(),
        temperatures: [],
        voltages: [],
        cpu: null,
        gpus: [],
        disks: [],
        memory: { total: null, virtual: null, modules: [] },
        networks: [],
        fans: [],
        error: err?.name === 'TimeoutError' ? '连接超时' : '未连接 LibreHardwareMonitor',
      }
    }
  }

  async function refreshLatency() {
    const output = await runPowerShell(
      '$r = Test-Connection -ComputerName 223.5.5.5 -Count 1 -ErrorAction SilentlyContinue; if ($r) { $r.ResponseTime }',
      6000
    )
    const text = output.trim().split(/\r?\n/)[0] || ''
    if (!text) {
      latency = null
      return
    }
    const ms = toNumber(text)
    latency = ms != null && ms >= 0 ? Math.round(ms) : null
  }

  // 硬件采集可能偶发变慢，用忙碌标记避免轮询堆叠出大量 PowerShell 进程
  async function refreshHardware() {
    if (hardwareBusy) return
    hardwareBusy = true
    try {
      await Promise.all([
        refreshDisks(),
        refreshGpu(),
        refreshCpuTemp(),
        refreshProcesses(),
        refreshDevices(),
        refreshFan(),
        refreshSensors(),
      ])
      // 功耗放在其他采集之后，避免本进程启动的 PowerShell 把 CPU 功耗读数抬高
      await refreshPower()
    } finally {
      hardwareBusy = false
    }
  }

  function startNetworkPolling() {
    if (netTimer) return
    netPrev = null
    const tick = async () => {
      if (networkBusy) return
      networkBusy = true
      try {
        await Promise.all([refreshNetwork(), refreshLatency()])
      } finally {
        networkBusy = false
      }
    }
    tick()
    netTimer = setInterval(tick, networkIntervalMs)
  }

  function stopNetworkPolling() {
    clearInterval(netTimer)
    netTimer = null
    netPrev = null
    netRate = { rx: 0, tx: 0 }
    latency = null
  }

  function startHardwarePolling() {
    if (hardwareTimer) return
    refreshHardware()
    hardwareTimer = setInterval(refreshHardware, hardwareIntervalMs)
  }

  function stopHardwarePolling() {
    clearInterval(hardwareTimer)
    hardwareTimer = null
  }

  function reset() {
    prevCpu = null
    netPrev = null
    netRate = { rx: 0, tx: 0 }
  }

  function sample() {
    const cpu = readCpu()
    const disk = readDisk()
    // CPU 温度优先用 LHM 的 Package/Core Max（真实 DTS），ACPI 仅作回退
    const lhmCpu = hardware.sensors?.cpu
    const cpuTemp = Number.isFinite(lhmCpu?.packageTemp)
      ? lhmCpu.packageTemp
      : Number.isFinite(lhmCpu?.coreMax)
        ? lhmCpu.coreMax
        : hardware.temp
    return {
      ts: Date.now(),
      cpu: cpu.load,
      cores: cpu.cores,
      memUsed: os.totalmem() - os.freemem(),
      memTotal: os.totalmem(),
      disk,
      disks: diskList || [disk],
      gpu: hardware.gpu,
      temp: cpuTemp,
      processCount: hardware.processCount,
      processes: hardware.processes,
      power: hardware.power,
      fan: hardware.fan,
      sensors: hardware.sensors,
      devices: hardware.devices,
      rx: netRate.rx,
      tx: netRate.tx,
      latency,
      uptime: os.uptime(),
    }
  }

  // 断开/连接走 PnP 禁用与启用。禁用接收器节点等同于拔掉接收器，
  // 所以对键鼠套装只禁用键鼠自身的 HID 节点，接收器保持在线，重新启用才不会失败。
  async function setDeviceEnabled(containerId, enabled) {
    const device = (hardware.devices.usb || []).find(
      (item) => item.id.toLowerCase() === String(containerId || '').toLowerCase()
    )
    if (!device) throw new Error('未找到该设备，请刷新后重试')

    // 启用时优先恢复曾被禁用的节点，断开时只处理仍在线的节点
    const targets = device.roles.filter((role) => Boolean(role.instanceId))
    const ids = targets
      .filter((role) => (enabled ? role.disabled || !role.connected : !role.disabled))
      .map((role) => role.instanceId)
    const list = ids.length ? ids : targets.map((role) => role.instanceId)
    if (!list.length) throw new Error('该设备没有可控制的节点')

    const verb = enabled ? 'Enable-PnpDevice' : 'Disable-PnpDevice'
    const lines = list
      .map((id) => `try { ${verb} -InstanceId '${id.replace(/'/g, "''")}' -Confirm:$false -ErrorAction Stop; 'ok' } catch { 'ERR:' + $_.Exception.Message }`)
      .join('\n')

    const output = await runPowerShell(
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='Stop'\n${lines}`,
      20000
    )
    const errors = String(output || '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('ERR:'))
      .map((line) => line.slice(4).trim())

    if (errors.length === list.length) {
      throw new Error(errors[0] || '操作失败，可能需要以管理员身份运行')
    }

    await refreshUsbDevices()
    const fresh = (hardware.devices.usb || []).find((item) => item.id === device.id)
    return { id: device.id, connected: fresh ? fresh.connected : enabled, disabled: fresh?.disabled ?? !enabled }
  }

  return {
    sample,
    readDisk,
    refreshFan,
    setDeviceEnabled,
    startNetworkPolling,
    stopNetworkPolling,
    startHardwarePolling,
    stopHardwarePolling,
    reset,
  }
}
