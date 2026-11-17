import fs from 'node:fs'
import os from 'node:os'
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

// CPU / 内存走 Node 原生接口，1 分钟一次近乎零开销；
// WMI 类接口在这类机器上单次可能耗时数十秒，因此只用轻量的 statfs、nvidia-smi、ACPI 温度和网络计数器。
export function createSampler({ networkIntervalMs = 30000, hardwareIntervalMs = 60000 } = {}) {
  let prevCpu = null
  let netPrev = null
  let netRate = { rx: 0, tx: 0 }
  let latency = null
  let diskCache = { mount: 'C:', used: 0, size: 0 }
  let diskList = null
  let diskAt = 0
  let hardware = { gpu: null, temp: null, processCount: null, processes: [], power: null }
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

  async function refreshPower() {
    const output = await runPowerShell(
      `$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus; if ($b) { @{ present = $true; percent = [int]$b.EstimatedChargeRemaining; status = [int]$b.BatteryStatus } | ConvertTo-Json -Compress } else { '{"present":false}' }`,
      8000
    )
    if (!output.trim()) return
    try {
      const data = JSON.parse(output)
      if (!data?.present) {
        hardware.power = { present: false, percent: null, status: 0, charging: false }
        return
      }
      const percent = toNumber(data.percent)
      const status = toNumber(data.status) ?? 0
      hardware.power = {
        present: true,
        percent: percent == null ? null : Math.max(0, Math.min(100, Math.round(percent))),
        status: Math.round(status),
        charging: [2, 6, 7, 8, 9].includes(Math.round(status)),
      }
    } catch {
      /* 输出不是合法 JSON 时忽略本次刷新 */
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
      await Promise.all([refreshDisks(), refreshGpu(), refreshCpuTemp(), refreshProcesses(), refreshPower()])
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
    return {
      ts: Date.now(),
      cpu: cpu.load,
      cores: cpu.cores,
      memUsed: os.totalmem() - os.freemem(),
      memTotal: os.totalmem(),
      disk,
      disks: diskList || [disk],
      gpu: hardware.gpu,
      temp: hardware.temp,
      processCount: hardware.processCount,
      processes: hardware.processes,
      power: hardware.power,
      rx: netRate.rx,
      tx: netRate.tx,
      latency,
      uptime: os.uptime(),
    }
  }

  return {
    sample,
    readDisk,
    startNetworkPolling,
    stopNetworkPolling,
    startHardwarePolling,
    stopHardwarePolling,
    reset,
  }
}
