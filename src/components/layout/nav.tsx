import { IconHome, IconList, IconTarget, IconWallet, IconChart } from '@/components/ui/icons'
import type { ComponentType, SVGProps } from 'react'

export interface NavItem {
  to: string
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/budgets', label: 'Budgets', Icon: IconTarget },
  { to: '/accounts', label: 'Accounts', Icon: IconWallet },
  { to: '/analytics', label: 'Analytics', Icon: IconChart },
]
