import test from 'node:test'
import assert from 'node:assert/strict'
import { createSampler, buildBluetoothDevices, buildSystemBattery, buildUsbDevices, parsePnputilCsv, summarizePowerSensors, summarizeSensors, summarizeVoltages } from '../server/sampler.js'

test('首次采样没有 CPU 基准时返回 null，避免误报 0%', () => {
  const sampler = createSampler()
  const frame = sampler.sample()

  assert.equal(frame.cpu, null)
  assert.ok(frame.cores.length > 0)
  assert.ok(frame.cores.every((core) => core === null))
})

test('reset 后重新建立采样基准', () => {
  const sampler = createSampler()
  sampler.sample()
  sampler.reset()

  assert.equal(sampler.sample().cpu, null)
})

test('采样帧包含前端所需字段', () => {
  const frame = createSampler().sample()

  for (const key of [
    'ts',
    'cpu',
    'cores',
    'memUsed',
    'memTotal',
    'disk',
    'rx',
    'tx',
    'uptime',
    'temp',
    'processes',
    'processCount',
    'latency',
    'power',
  ]) {
    assert.ok(key in frame, `缺少字段 ${key}`)
  }
  assert.equal(typeof frame.ts, 'number')
  assert.ok(Array.isArray(frame.processes))
})

test('整机功耗优先使用整机传感器', () => {
  const result = summarizePowerSensors([
    { hardware: '主板', name: 'System Power', value: 152.3 },
    { hardware: 'Intel Core i7-10700', name: 'CPU Package', value: 78.7 },
    { hardware: 'NVIDIA GeForce GTX 1060', name: 'GPU Package Power', value: 8.9 },
  ])

  assert.equal(result.watts, 152.3)
  assert.equal(result.whole, true)
  assert.equal(result.source, 'sensor')
})

test('没有整机传感器时汇总 CPU、内存与独显', () => {
  const result = summarizePowerSensors([
    { hardware: 'Intel Core i7-10700', name: 'CPU Package', value: 78.7 },
    { hardware: 'Intel Core i7-10700', name: 'CPU Cores', value: 77.6 },
    { hardware: 'Intel Core i7-10700', name: 'CPU Memory', value: 2 },
    { hardware: 'NVIDIA GeForce GTX 1060', name: 'GPU Package Power', value: 8.9 },
    { hardware: 'Intel(R) UHD Graphics 630', name: 'GPU Power', value: 3 },
  ])

  assert.equal(result.watts, 89.6)
  assert.equal(result.cpuWatts, 78.7)
  assert.equal(result.memWatts, 2)
  assert.equal(result.gpuWatts, 8.9)
  assert.equal(result.whole, false)
})

test('只有核心功耗时累加内存', () => {
  const result = summarizePowerSensors([
    { hardware: 'CPU', name: 'CPU Cores', value: 50 },
    { hardware: 'CPU', name: 'CPU Memory', value: 4 },
  ])

  assert.equal(result.watts, 54)
  assert.equal(result.cpuWatts, 50)
  assert.equal(result.gpuWatts, null)
})

test('没有可读功耗时返回 null', () => {
  assert.equal(summarizePowerSensors([]), null)
  assert.equal(summarizePowerSensors([{ hardware: 'CPU', name: 'Temperature', value: 50 }]), null)
})

test('提取 CPU、显卡、内存与电源主轨电压', () => {
  const result = summarizeVoltages([
    { hardware: 'Intel Core i7-10700', name: 'CPU Core', value: 1.372 },
    { hardware: 'Intel Core i7-10700', name: 'CPU Core #1', value: 1.377 },
    { hardware: 'NVIDIA GeForce GTX 1060', name: 'GPU Core Voltage', value: 0.65 },
    { hardware: 'Nuvoton NCT6687D', name: 'Vcore', value: 1.39 },
    { hardware: 'Nuvoton NCT6687D', name: 'DIMM', value: 1.356 },
    { hardware: 'Nuvoton NCT6687D', name: '+12V', value: 12.048 },
    { hardware: 'Nuvoton NCT6687D', name: '+5V', value: 5.12 },
    { hardware: 'Nuvoton NCT6687D', name: 'AVCC3', value: 3.372 },
    { hardware: 'Nuvoton NCT6687D', name: 'CMOS Battery', value: 3.132 },
  ])

  assert.deepEqual(result, {
    cpu: 1.37,
    gpu: 0.65,
    mem: 1.36,
    p12: 12.05,
    p5: 5.12,
    p3: 3.37,
  })
})

test('缺少电压传感器时返回 null', () => {
  assert.equal(summarizeVoltages([]), null)
  assert.equal(summarizeVoltages([{ hardware: 'CPU', name: 'CPU Core #1', value: 1.3 }]), null)
})

test('硬件详情汇总温度、电压、核心、磁盘、内存与网卡', () => {
  const summary = summarizeSensors([
    { hardware: 'Intel Core i7-10700', type: 'Temperature', name: 'Core Max', value: 71, unit: '°C' },
    { hardware: 'Intel Core i7-10700', type: 'Temperature', name: 'Core Average', value: 65.1, unit: '°C' },
    { hardware: 'Intel Core i7-10700', type: 'Temperature', name: 'CPU Package', value: 71, unit: '°C' },
    { hardware: 'Intel Core i7-10700', type: 'Temperature', name: 'CPU Core #1', value: 66, unit: '°C' },
    {
      hardware: 'Intel Core i7-10700',
      type: 'Temperature',
      name: 'CPU Core #1 Distance to TjMax',
      value: 34,
      unit: '°C',
    },
    { hardware: 'Intel Core i7-10700', type: 'Clock', name: 'CPU Core #1', value: 4606.3, unit: 'MHz' },
    { hardware: 'Intel Core i7-10700', type: 'Voltage', name: 'CPU Core #1', value: 1.381, unit: 'V' },
    { hardware: 'Intel Core i7-10700', type: 'Load', name: 'CPU Total', value: 23.2, unit: '%' },
    { hardware: 'Intel Core i7-10700', type: 'Power', name: 'CPU Package', value: 51.6, unit: 'W' },
    { hardware: 'Nuvoton NCT6687D', type: 'Voltage', name: '+12V', value: 12.024, unit: 'V' },
    { hardware: 'Nuvoton NCT6687D', type: 'Temperature', name: 'VRM MOS', value: 46, unit: '°C' },
    { hardware: 'Nuvoton NCT6687D', type: 'Fan', name: 'CPU Fan', value: 1498, unit: 'RPM' },
    { hardware: 'Nuvoton NCT6687D', type: 'Control', name: 'CPU Fan', value: 20, unit: '%' },
    {
      hardware: 'NVIDIA GeForce GTX 1060 3GB',
      type: 'Temperature',
      name: 'GPU Hot Spot',
      value: 45.9,
      unit: '°C',
    },
    { hardware: 'NVIDIA GeForce GTX 1060 3GB', type: 'Power', name: 'GPU Package', value: 9, unit: 'W' },
    {
      hardware: 'NVIDIA GeForce GTX 1060 3GB',
      type: 'SmallData',
      name: 'GPU Memory Used',
      value: 993,
      unit: 'MB',
    },
    {
      hardware: 'NVIDIA GeForce GTX 1060 3GB',
      type: 'SmallData',
      name: 'GPU Memory Total',
      value: 3072,
      unit: 'MB',
    },
    {
      hardware: 'WDC PC SN520 SDAPNUW-256G-1002',
      type: 'Temperature',
      name: 'Composite Temperature',
      value: 44,
      unit: '°C',
    },
    { hardware: 'WDC PC SN520 SDAPNUW-256G-1002', type: 'Level', name: 'Life', value: 91, unit: '%' },
    {
      hardware: 'WDC PC SN520 SDAPNUW-256G-1002',
      type: 'Factor',
      name: 'Power On Hours',
      value: 4691,
      unit: '',
    },
    {
      hardware: 'WDC PC SN520 SDAPNUW-256G-1002',
      type: 'Throughput',
      name: 'Read Rate',
      value: 3,
      unit: 'MB/s',
    },
    { hardware: 'Total Memory', type: 'Load', name: 'Memory', value: 85.8, unit: '%' },
    { hardware: 'Total Memory', type: 'Data', name: 'Memory Used', value: 13.6, unit: 'GB' },
    { hardware: 'DIMM #1', type: 'Data', name: 'Capacity', value: 8, unit: 'GB' },
    {
      hardware: 'DIMM #1',
      type: 'Timing',
      name: 'tCKAVGmin (Minimum Cycle Time)',
      value: 0.938,
      unit: 'ns',
    },
    { hardware: 'DIMM #1', type: 'Timing', name: 'tAA (CAS Latency Time)', value: 13.5, unit: 'ns' },
    { hardware: '以太网', type: 'Throughput', name: 'Download Speed', value: 31.9, unit: 'KB/s' },
    { hardware: '以太网', type: 'Throughput', name: 'Upload Speed', value: 104.7, unit: 'KB/s' },
  ])

  assert.equal(summary.available, true)
  assert.equal(summary.cpu.cores.length, 1)
  assert.deepEqual(summary.cpu.cores[0], {
    index: 1,
    temp: 66,
    clockMHz: 4606,
    voltage: 1.38,
    tjMax: 34,
  })
  assert.equal(summary.cpu.coreMax, 71)
  assert.equal(summary.cpu.totalLoad, 23.2)
  assert.equal(summary.gpus.length, 1)
  assert.equal(summary.gpus[0].hotspotTemp, 45.9)
  assert.equal(summary.gpus[0].memoryUsedMB, 993)
  assert.equal(summary.disks.length, 1)
  assert.equal(summary.disks[0].life, 91)
  assert.equal(summary.disks[0].powerOnHours, 4691)
  assert.equal(summary.disks[0].readRate, 3 * 1024 ** 2)
  assert.equal(summary.memory.total.load, 85.8)
  assert.equal(summary.memory.modules[0].speedMHz, 1066)
  assert.equal(summary.memory.modules[0].cas, 14)
  assert.equal(summary.networks[0].rx, Math.round(31.9 * 1024))
  assert.deepEqual(summary.fans[0], { name: 'CPU Fan', rpm: 1498, percent: 20 })
  assert.ok(summary.temperatures.every((item) => !/Distance to TjMax/.test(item.name)))
  assert.ok(summary.voltages.some((item) => item.name === '+12V' && item.value === 12.02))
})

test('异常传感器读数会被过滤', () => {
  const summary = summarizeSensors([
    { hardware: 'KINGBANK KP330', type: 'Temperature', name: 'Temperature', value: 48, unit: '°C' },
    { hardware: 'KINGBANK KP330', type: 'Factor', name: 'Power On Hours', value: 11587, unit: '' },
    { hardware: 'KINGBANK KP330', type: 'Data', name: 'Free Space', value: 18446740000, unit: 'GB' },
    { hardware: 'KINGBANK KP330', type: 'Load', name: 'Used Space', value: -15367920000, unit: '%' },
    { hardware: 'Nuvoton NCT6687D', type: 'Temperature', name: 'Broken', value: 999, unit: '°C' },
  ])

  assert.equal(summary.disks[0].freeGB, null)
  assert.equal(summary.disks[0].usedPercent, null)
  assert.ok(summary.temperatures.every((item) => item.value !== 999))
})

test('没有传感器数据时标记为不可用', () => {
  const summary = summarizeSensors([])

  assert.equal(summary.available, false)
  assert.deepEqual(summary.temperatures, [])
  assert.deepEqual(summary.disks, [])
})

test('蓝牙设备带出电量、类型与地址', () => {
  const list = buildBluetoothDevices([
    {
      Name: 'MIMouse 2',
      InstanceId: 'BTHLE\\DEV_D10B0D644459\\7&30DB662F&0&D10B0D644459',
      Address: 'd10b0d644459',
      Category: 'Input.Mouse',
      Battery: 92,
    },
    {
      Name: 'KB-3.0',
      InstanceId: 'BTHENUM\\DEV_BC2000B55032\\7&33098524&0&BLUETOOTHDEVICE_BC2000B55032',
      Address: 'BC2000B55032',
      Category: ['Input.Keyboard'],
      Battery: null,
    },
    // 服务节点与重复记录不应计入设备列表
    {
      Name: '蓝牙 LE 通用属性服务',
      InstanceId: 'BTHLEDEVICE\\{0000180F-0000-1000-8000-00805F9B34FB}_554DEE4CD47E\\8&12EAB820&0&0020',
    },
    {
      Name: 'MIMouse 2',
      InstanceId: 'BTHLE\\DEV_D10B0D644459\\7&30DB662F&0&D10B0D644459',
      Battery: 92,
    },
  ])

  assert.equal(list.length, 2)
  assert.deepEqual(list[0], {
    name: 'MIMouse 2',
    class: '鼠标',
    address: 'D1:0B:0D:64:44:59',
    battery: 92,
  })
  assert.equal(list[1].battery, null)
  assert.equal(list[1].class, '键盘')
})

test('异常电量读数不会显示', () => {
  const list = buildBluetoothDevices([
    { Name: 'A', InstanceId: 'BTHLE\\DEV_000000000001\\1', Battery: 255 },
    { Name: 'B', InstanceId: 'BTHLE\\DEV_000000000002\\1', Battery: -3 },
  ])

  assert.deepEqual(list.map((item) => item.battery), [null, null])
})

test('系统电池给出电量、充电状态与剩余时间', () => {
  assert.deepEqual(buildSystemBattery([{ Name: 'Li-ion', EstimatedChargeRemaining: 76, BatteryStatus: 2, EstimatedRunTime: 205 }]), {
    name: 'Li-ion',
    percent: 76,
    status: '已接通电源',
    charging: false,
    minutes: 205,
  })

  assert.equal(buildSystemBattery([{ EstimatedChargeRemaining: 40, BatteryStatus: 6, EstimatedRunTime: 71582788 }]).minutes, null)
  assert.equal(buildSystemBattery([]), null)
})

const CSV_HEADER =
  'InstanceId,DeviceDescription,ClassName,ClassGuid,ManufacturerName,Status,ProblemCode,ProblemStatus,DriverName,ExtensionDriverNames,Key,Type,Value'

function csvRows(instanceId, { status = 'Started', className = '', classGuid = '', desc = '', props = {} } = {}) {
  const rows = [`"${instanceId}","${desc}","${className}","${classGuid}","(Standard)",${status},,,,,,"`]
  for (const [key, value] of Object.entries(props)) rows.push(`"${instanceId}",,,,,,,,,,,,"${key}","String","${value}"`)
  return rows
}

test('pnputil CSV 按设备聚合属性，并剔除已移除记录', () => {
  const text = [
    CSV_HEADER,
    ...csvRows('USB\\VID_046D&PID_C53F\\5&1c9b0f99&0&9', {
      className: 'USB',
      classGuid: '{36fc9e60-c465-11cf-8056-444553540000}',
      desc: 'USB Composite Device',
      props: {
        DEVPKEY_Device_ContainerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
        DEVPKEY_Device_BusReportedDeviceDesc: 'MCHOSE 2.4G Wireless',
        DEVPKEY_Device_IsPresent: 'TRUE',
        DEVPKEY_NAME: 'MCHOSE 2.4G Wireless',
      },
    }),
    ...csvRows('HID\\VID_046D&PID_C53F&MI_00\\7&1db75835&0&0000', {
      className: 'Keyboard',
      classGuid: '{4d36e96b-e325-11ce-bfc1-08002be10318}',
      props: {
        DEVPKEY_Device_ContainerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
        DEVPKEY_Device_IsPresent: 'TRUE',
        DEVPKEY_NAME: 'HID Keyboard Device',
      },
    }),
    // 已从系统移除的历史节点没有 Status，必须丢弃
    '"USB\\VID_30FA&PID_0300\\6&279d3a0e&0&0000","","USB","","","",,,,,,\n',
  ].join('\n')

  const nodes = parsePnputilCsv(text)
  assert.equal(nodes.length, 2)

  const receiver = nodes.find((node) => node.instanceId.includes('VID_046D&PID_C53F\\5'))
  assert.equal(receiver.busDesc, 'MCHOSE 2.4G Wireless')
  assert.equal(receiver.present, true)
  assert.equal(receiver.className, 'USB')
})

test('接收器把背后的键盘与鼠标归入同一张卡片', () => {
  const devices = buildUsbDevices([
    {
      instanceId: 'USB\\VID_046D&PID_C53F\\5&1c9b0f99&0&9',
      status: 'Started',
      classGuid: '{36fc9e60-c465-11cf-8056-444553540000}',
      containerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
      name: 'USB Receiver',
      busDesc: 'MCHOSE 2.4G Wireless',
      present: true,
    },
    {
      instanceId: 'HID\\VID_046D&PID_C53F&MI_00\\7&1db75835&0&0000',
      status: 'Started',
      classGuid: '{4d36e96b-e325-11ce-bfc1-08002be10318}',
      containerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
      name: 'HID Keyboard Device',
      present: true,
    },
    {
      instanceId: 'HID\\VID_046D&PID_C53F&MI_01&Col01\\7&1db75835&0&0000',
      status: 'Started',
      classGuid: '{4d36e96f-e325-11ce-bfc1-08002be10318}',
      containerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
      name: 'HID-compliant mouse',
      present: true,
    },
  ])

  assert.equal(devices.length, 1)
  const [device] = devices
  assert.equal(device.name, 'MCHOSE 2.4G Wireless')
  assert.equal(device.kind, '键鼠套装')
  assert.equal(device.link, 'receiver')
  assert.equal(device.battery, null)
  assert.deepEqual(device.roles.map((role) => role.label), ['键盘', '鼠标'])
  assert.equal(device.connected, true)
  assert.equal(device.disabled, false)
})

test('罗技接收器附带的 LAMPARRAY 虚拟容器不产生多余设备', () => {
  const base = {
    status: 'Started',
    present: true,
    containerId: '{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf2}',
    busDesc: 'LIGHTSPEED Receiver',
  }
  const devices = buildUsbDevices([
    { ...base, instanceId: 'USB\\VID_046D&PID_C53F\\5&1c9b0f99&0&9', name: 'LIGHTSPEED Receiver' },
    {
      ...base,
      instanceId: 'HID\\VID_046D&PID_C53F&MI_00\\7&1db75835&0&0000',
      classGuid: '{4d36e96b-e325-11ce-bfc1-08002be10318}',
      name: 'HID Keyboard Device',
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      ...base,
      instanceId: `USB\\VID_046D&PID_C53F&LAMPARRAY\\7&22d5f6a&0&Slot0${index}`,
      containerId: `{3d4bd2d1-dc1f-11f1-8982-2cf05d9f7cf${index}}`,
      name: 'LIGHTSPEED Receiver',
    })),
  ])

  assert.equal(devices.length, 1)
  assert.equal(devices[0].name, 'LIGHTSPEED Receiver')
  assert.equal(devices[0].link, 'receiver')
  assert.equal(devices[0].kind, '键盘')
})

test('有线键鼠标记为有线连接，禁用后仍保留在列表中', () => {
  const devices = buildUsbDevices([
    {
      instanceId: 'USB\\VID_258A&PID_0033\\5&24b3d0e3&0&1',
      status: 'Started',
      classGuid: '{36fc9e60-c465-11cf-8056-444553540000}',
      containerId: '{9d0c1f7d-1111-2222-3333-444455556666}',
      name: 'Gaming Keyboard',
      present: true,
    },
    {
      instanceId: 'HID\\VID_258A&PID_0033&MI_00\\7&1a2b3c4d&0&0000',
      status: 'Error',
      problemCode: 22,
      classGuid: '{4d36e96b-e325-11ce-bfc1-08002be10318}',
      containerId: '{9d0c1f7d-1111-2222-3333-444455556666}',
      name: 'HID Keyboard Device',
      present: true,
    },
  ])

  assert.equal(devices.length, 1)
  assert.equal(devices[0].link, 'wired')
  assert.equal(devices[0].name, 'Gaming Keyboard')
  assert.equal(devices[0].disabled, true)
  assert.equal(devices[0].roles[0].disabled, true)
})

test('没有键鼠角色的容器（硬盘盒、集线器）不进入设备列表', () => {
  const devices = buildUsbDevices([
    {
      instanceId: 'USB\\VID_152D&PID_5790\\5&1c9b0f99&0&3',
      status: 'Started',
      containerId: '{aaaaaaaa-1111-2222-3333-444455556666}',
      name: 'JMS579',
      busDesc: 'USB 3.0 Mass Storage',
      present: true,
    },
  ])

  assert.deepEqual(devices, [])
})

test('已拔出的设备不显示', () => {
  const devices = buildUsbDevices([
    {
      instanceId: 'USB\\VID_25A7&PID_FA70\\5&1c9b0f99&0&4',
      status: 'Disconnected',
      containerId: '{bbbbbbbb-1111-2222-3333-444455556666}',
      name: '2.4G Wireless Receiver',
      present: false,
    },
    {
      instanceId: 'HID\\VID_25A7&PID_FA70&MI_00\\7&2c3d4e5f&0&0000',
      status: 'Disconnected',
      classGuid: '{4d36e96b-e325-11ce-bfc1-08002be10318}',
      containerId: '{bbbbbbbb-1111-2222-3333-444455556666}',
      name: 'HID Keyboard Device',
      present: false,
    },
  ])

  assert.deepEqual(devices, [])
})
