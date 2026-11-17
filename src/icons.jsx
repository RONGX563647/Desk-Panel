const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
  'aria-hidden': 'true',
}

function Svg({ size = 20, children }) {
  return (
    <svg {...base} width={size} height={size}>
      {children}
    </svg>
  )
}

export function TerminalIcon({ size }) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </Svg>
  )
}

export function FolderIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </Svg>
  )
}

export function CodeIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m13.5 6-3 12" />
    </Svg>
  )
}

export function GlobeIcon({ size }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z" />
    </Svg>
  )
}

export function LockIcon({ size }) {
  return (
    <Svg size={size}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </Svg>
  )
}

export function FullscreenIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </Svg>
  )
}

export function SunIcon({ size }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </Svg>
  )
}

export function ThemeIcon({ size }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function RefreshIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </Svg>
  )
}

export function CloseIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </Svg>
  )
}
