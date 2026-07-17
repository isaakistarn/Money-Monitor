import { IconHome, IconList, IconTarget, IconWallet, IconChart, IconTrend } from '@/components/ui/icons'
import type { ComponentType, SVGProps } from 'react'

export interface NavItem {
  to: string
  label: string
  /** Shorter label for the cramped mobile bottom bar (falls back to `label`). */
  short?: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', short: 'Activity', Icon: IconList },
  { to: '/budgets', label: 'Budgets', Icon: IconTarget },
  { to: '/accounts', label: 'Accounts', Icon: IconWallet },
  { to: '/watchlist', label: 'Markets', short: 'Markets', Icon: IconTrend },
  { to: '/analytics', label: 'Analytics', short: 'Charts', Icon: IconChart },
]
