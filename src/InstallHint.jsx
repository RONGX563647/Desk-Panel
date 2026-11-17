import { useEffect, useState } from 'react'

const SNOOZE_KEY = 'panel-install-snooze'
const DAY = 24 * 60 * 60 * 1000

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isSnoozed() {
  try {
    return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0)
  } catch {
    return false
  }
}

function isMobile() {
  return (
    window.matchMedia?.('(pointer: coarse)').matches ||
    /android|iphone|ipad|ipod/i.test(navigator.userAgent)
  )
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export default function InstallHint() {
  const [visible, setVisible] = useState(() => !isStandalone() && !isSnoozed() && isMobile())
  const [promptEvent, setPromptEvent] = useState(null)
  const ios = isIOS()

  useEffect(() => {
    if (!visible) return
    const onPrompt = (event) => {
      event.preventDefault()
      setPromptEvent(event)
    }
    const onInstalled = () => setVisible(false)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [visible])

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * DAY))
    } catch {
      /* 隐私模式下忽略写入失败 */
    }
    setVisible(false)
  }

  const install = async () => {
    if (!promptEvent) return
    try {
      promptEvent.prompt()
      const choice = await promptEvent.userChoice
      if (choice?.outcome !== 'accepted') snooze()
      else setVisible(false)
    } catch {
      snooze()
    }
  }

  // 安卓等浏览器需要等待 beforeinstallprompt；iOS 没有该事件，直接给出操作说明
  if (!visible || (!ios && !promptEvent)) return null

  return (
    <div className="install-hint" role="status">
      <div className="install-text">
        <strong>添加到主屏幕</strong>
        <span>
          {ios ? '在 Safari 中点击分享 → 添加到主屏幕，即可全屏常亮显示。' : '安装后可从主屏直接全屏打开面板。'}
        </span>
      </div>
      <div className="install-actions">
        {!ios ? (
          <button type="button" className="btn primary" onClick={install}>
            添加
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={snooze}>
          稍后
        </button>
      </div>
    </div>
  )
}
