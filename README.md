# Desk Panel

> 面向 Windows 本机的桌面仪表盘与服务控制台。手机、平板打开浏览器就能看机器状态、点快捷操作、启停开发服务、看编译日志。

![tech](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)
![tech](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![tech](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)
![license](https://img.shields.io/badge/License-MIT-green)

## 特性

**实时监控**
- CPU 使用率环形图 + 分核柱状条、内存、磁盘（多盘）、网络速率与曲线、GPU
- 温度、进程排行、延迟探测、系统信息、电源与电压、风扇转速、硬件详情
- 媒体播放控制与进度、USB / 蓝牙设备与电量、优化建议
- WebSocket 推送，页面无需轮询刷新

**快捷操作**
- 终端、文件管理器、浏览器、熄屏、睡眠、锁屏
- `open-path` 类型：用指定程序打开目录或项目（资源管理器 / VS Code / Trae / IDEA）
- 任意应用一键启动，支持带参数调用

**开发服务控制台**
- 在面板里一键启动 / 停止开发服务，配置只需 `{ name, cwd, command }`
- 后台 spawn 纳管进程，stdout / stderr 进 400 行环形缓冲，编译报错直接看
- 自动扫描本机监听端口并识别框架（Vite / Next / Nuxt / Webpack / Python / Spring 等）
- 点击端口弹出实时滚动日志浮窗，进程退出码与状态实时回流

**卡片翻面**
- 设备卡：正面设备列表，背面电池与无线设备电量总览
- 网络卡：正面实时速率，背面当前 / 峰值 / 均值 / 采样数
- 一块区域两张卡，省纵向空间

**其它**
- 深浅双主题、多页面布局、自动轮播、拖拽排布卡片
- 访问口令（URL 带 `?token=` 或 `Authorization: Bearer`）
- PWA 安装到桌面 / 主屏，支持触摸滑动切页
- AI 助手：接入任意 OpenAI 兼容网关，分析指标并给出优化建议

## 快速开始

需要 Node.js 18+（开发用 22 验证）。

```bash
npm install
npm run dev        # 同时启动后端 8787 与 Vite 5173
```

打开 <http://localhost:5173/>。生产模式：

```bash
npm run serve      # 构建前端后启动 8787
```

局域网访问：启动日志会打印本机所有网卡地址，手机连同一 Wi-Fi 直接用该地址打开即可。

## 打包桌面版

```bash
npm run build:desktop
```

产物在 `desktop/release/`：

- `DeskPanel/`：免安装目录，内置 `node.exe`，双击 `DeskPanel.exe` 启动托盘
- `DeskPanel-win64.zip`：可直接分发的压缩包

托盘程序会托管 8787 服务，提供「打开面板 / 启动服务 / 风扇工具 / 最小化到托盘」等菜单。打包依赖 .NET Framework 4.0 自带的 `csc.exe`，Windows 10/11 无需额外安装。

## 配置

配置保存在 `data/config.json`，也可在面板设置页可视化编辑。结构概览：

```jsonc
{
  "version": 6,
  "settings": {
    "theme": "dark",        // dark | light
    "metricsInterval": 60,  // 指标推送间隔（秒），5-300
    "autoRotate": 0,        // 自动轮播间隔（秒），0 为关闭
    "token": "",            // 访问口令，4-64 位字母数字_-，空为不校验
    "fanUrl": "http://127.0.0.1:8085"
  },
  "actions": [
    { "id": "vscode", "kind": "app", "label": "VS Code", "icon": "code",
      "target": "code", "args": [], "enabled": true },
    { "id": "open_project", "kind": "open-path", "label": "打开目录", "icon": "folder",
      "target": "E:\\code\\my-project", "args": ["explorer.exe"], "enabled": true }
  ],
  "layout": {
    "pages": [
      { "id": "main", "name": "主页", "components": ["clock", "cpu", "memory", "shortcuts"] }
    ]
  },
  "dev": {
    "services": [
      { "id": "svc_web", "name": "前端", "cwd": "E:\\code\\my-project",
        "command": "npm run dev", "port": 5173 }
    ]
  },
  "agent": {
    "enabled": false,
    "permission": "advice",              // advice 只给建议 | safe 可执行白名单动作
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "apiKey": ""
  }
}
```

动作类型 `kind`：

| kind | 说明 | `target` / `args` |
| --- | --- | --- |
| `app` | 启动应用 | `target` 为可执行文件或命令，`args` 为参数 |
| `url` | 打开网址 | `target` 必须以 `http://` 或 `https://` 开头 |
| `open-path` | 用指定程序打开路径 | `args[0]` 为打开程序（默认 `explorer.exe`），`target` 为路径 |
| `lock` | 锁屏 | 无 |
| `monitor-off` | 熄屏 | 无 |
| `sleep` | 睡眠 | 无 |

页面可用组件：`clock` `cpu` `gpu` `memory` `disk` `network` `temp` `processes` `devices` `latency` `system` `power` `fan` `sensors` `media` `optimize` `agent` `shortcuts` `dev`。

环境变量（优先级高于配置文件）：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 `8787` |
| `PANEL_TOKEN` | 访问口令，设置后锁定，无法在页面关闭 |
| `PANEL_METRICS_INTERVAL` | 指标推送间隔（秒） |

## 主要接口

除静态资源外所有接口在设置口令后都需要鉴权。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/info` | 主机信息与 Agent 配置 |
| GET | `/api/admin/config` | 读取完整配置 |
| PUT | `/api/admin/config` | 保存配置（带校验） |
| POST | `/api/action` | 执行快捷动作 |
| POST | `/api/admin/action/test` | 测试单个动作 |
| POST | `/api/media` | 媒体控制 |
| POST | `/api/optimize/run` | 执行优化建议 |
| POST | `/api/fan/set` | 设置风扇转速 |
| POST | `/api/devices/toggle` | 启用 / 停用设备 |
| POST | `/api/agent/analyze` | AI 分析并可选执行 |
| GET | `/api/dev/ports` | 扫描本机开发端口 |
| POST | `/api/dev/open` | 打开端口对应页面 |
| POST | `/api/dev/stop` | 按 PID 结束进程 |
| POST | `/api/dev/proc/start` | 启动开发服务 |
| POST | `/api/dev/proc/stop` | 停止开发服务 |
| GET | `/api/dev/proc` | 开发服务状态列表 |
| GET | `/api/dev/logs` | 拉取日志（`id`、`since` 增量） |

WebSocket 在 `/ws`，消息类型：`hello` `config` `media` `metrics` `devproc` `devlogs`。

## 项目结构

```
├── server/              后端（Express + ws）
│   ├── index.js         路由、鉴权、WebSocket 广播
│   ├── sampler.js       WMI / PowerShell 采集硬件指标
│   ├── actions.js       快捷动作执行器
│   ├── media.js         媒体状态与按键控制
│   ├── devports.js      端口扫描、打开、结束进程
│   ├── devprocs.js      开发服务进程管理与日志环形缓冲
│   ├── optimize.js      优化建议与进程清理
│   ├── agent.js         AI 分析、动作白名单与执行
│   ├── config.js        配置默认值、校验与迁移
│   └── logger.js        文件日志
├── src/                 前端（React + Vite）
│   ├── App.jsx          页面骨架、手势、轮播、动作触发
│   ├── widgets.jsx      全部卡片组件
│   ├── admin.jsx        设置页（动作/服务/布局/Agent/数据）
│   ├── usePanel.js      数据订阅与状态管理
│   └── styles.css       主题与全部样式
├── desktop/             桌面版托盘启动器（C# + PowerShell 构建）
├── public/              PWA 资源与 Service Worker
├── test/                node:test 单元测试
└── data/                运行时数据（配置、日志），已忽略
```

## 开发

```bash
npm test               # node:test，覆盖配置校验、指标解析、动作、Agent
npm run build          # 构建前端到 dist/
npm run build:desktop  # 构建桌面版
```

指标采集通过 WMI / `Get-CimInstance` 实现，部分字段（GPU 负载、风扇转速、电压）取决于主板与驱动是否暴露传感器；某卡片显示「不可用」属正常降级。

风扇卡片需要外部风扇服务，默认地址 `http://127.0.0.1:8085`，可在设置里改。

## License

[MIT](LICENSE)
