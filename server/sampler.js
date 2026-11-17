import fs from 'node:fs'
import os from 'node:os'
import si from 'systeminformation'

// CPU / 内存 / 磁盘走 Node 原生接口，1s 采样近乎零开销；
// 网络统计在 Windows 上只能靠 WMI，单独在后台异步轮询并自行算差值。
export function createSampler({ networkIntervalMs = 3000 } = {}) {
  let prevCpu = null
  let netPrev = null
  let netRate = { rx: 0, tx: 0 }
  let diskCache = { mount: 'C:', used: 0, size: 0 }
  let diskAt = 0
  let netTimer = null

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

  async function pollNetwork() {
    try {
      const list = await si.networkStats()
      const nic = list.find((n) => n.operstate === 'up' && n.rx_bytes > 0) || list[0]
      if (!nic) return
      const now = Date.now()
      if (netPrev && netPrev.iface === nic.iface) {
        const dt = (now - netPrev.t) / 1000
        if (dt > 0) {
          netRate = {
            rx: Math.max(0, Math.round((nic.rx_bytes - netPrev.rx) / dt)),
            tx: Math.max(0, Math.round((nic.tx_bytes - netPrev.tx) / dt)),
          }
        }
      }
      netPrev = { iface: nic.iface, rx: nic.rx_bytes, tx: nic.tx_bytes, t: now }
    } catch {
      /* 忽略：部分网卡读不到统计 */
    }
  }

  function startNetworkPolling() {
    if (netTimer) return
    netPrev = null
    pollNetwork()
    netTimer = setInterval(pollNetwork, networkIntervalMs)
  }

  function stopNetworkPolling() {
    clearInterval(netTimer)
    netTimer = null
    netPrev = null
    netRate = { rx: 0, tx: 0 }
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
      rx: netRate.rx,
      tx: netRate.tx,
      uptime: os.uptime(),
    }
  }

  return { sample, readDisk, startNetworkPolling, stopNetworkPolling, reset }
}
