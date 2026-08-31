import type { SVGProps } from 'react'

/** Minimal inline icon set (stroke-based, 24px grid) — no icon dependency. */
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type P = SVGProps<SVGSVGElement>

export const IconHome = (p: P) => (
  <svg {...base} {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></svg>
)
export const IconList = (p: P) => (
  <svg {...base} {...p}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></svg>
)
export const IconTarget = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
)
export const IconWallet = (p: P) => (
  <svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5" /><circle cx="17" cy="13" r="1.25" /></svg>
)
export const IconChart = (p: P) => (
  <svg {...base} {...p}><path d="M4 4v16h16" /><path d="M8 14v3M12 10v7M16 6v11" /></svg>
)
export const IconSettings = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.7-1.3-2-3.4-2 .8a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.1a7.6 7.6 0 0 0-2.6 1.5l-2-.8-2 3.4L4.6 10.5a7.6 7.6 0 0 0 0 3l-1.7 1.3 2 3.4 2-.8a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.5-2.1a7.6 7.6 0 0 0 2.6-1.5l2 .8 2-3.4-1.7-1.3Z" /></svg>
)
export const IconPlus = (p: P) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>)
export const IconSearch = (p: P) => (<svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>)
export const IconClose = (p: P) => (<svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>)
export const IconArrowUp = (p: P) => (<svg {...base} {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>)
export const IconArrowDown = (p: P) => (<svg {...base} {...p}><path d="M12 5v14M6 13l6 6 6-6" /></svg>)
export const IconSwap = (p: P) => (<svg {...base} {...p}><path d="M7 4 3 8l4 4" /><path d="M3 8h14a4 4 0 0 1 0 8h-1" /><path d="m17 20 4-4-4-4" /></svg>)
export const IconTrash = (p: P) => (<svg {...base} {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>)
export const IconEdit = (p: P) => (<svg {...base} {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>)
export const IconChevron = (p: P) => (<svg {...base} {...p}><path d="m9 6 6 6-6 6" /></svg>)
export const IconDownload = (p: P) => (<svg {...base} {...p}><path d="M12 3v12M7 11l5 5 5-5" /><path d="M5 21h14" /></svg>)
export const IconUpload = (p: P) => (<svg {...base} {...p}><path d="M12 21V9M7 13l5-5 5 5" /><path d="M5 3h14" /></svg>)
export const IconSun = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>)
export const IconMoon = (p: P) => (<svg {...base} {...p}><path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8Z" /></svg>)
export const IconWarning = (p: P) => (<svg {...base} {...p}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>)
export const IconCheck = (p: P) => (<svg {...base} {...p}><path d="m5 12 5 5L20 6" /></svg>)
export const IconFilter = (p: P) => (<svg {...base} {...p}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></svg>)
export const IconShield = (p: P) => (<svg {...base} {...p}><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" /></svg>)
export const IconCloud = (p: P) => (<svg {...base} {...p}><path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17.5 18H7Z" /></svg>)
export const IconRefresh = (p: P) => (<svg {...base} {...p}><path d="M20 11a8 8 0 0 0-14-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14 4.5L20 16" /><path d="M20 20v-4h-4" /></svg>)
export const IconLogout = (p: P) => (<svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>)
export const IconTag = (p: P) => (<svg {...base} {...p}><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>)
export const IconTrend = (p: P) => (<svg {...base} {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>)
