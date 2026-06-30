import { useCurrency } from '@/state/settings'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'

/** Currency-aware money display bound to the active currency setting. */
export function Money({
  minor,
  signed,
  compact,
  className,
  colorBySign,
}: {
  minor: number
  signed?: boolean
  compact?: boolean
  className?: string
  colorBySign?: boolean
}) {
  const currency = useCurrency()
  const tone = colorBySign ? (minor > 0 ? 'text-positive' : minor < 0 ? 'text-negative' : '') : ''
  return (
    <span className={cn('tabular-nums', tone, className)}>
      {formatMoney(minor, currency, { signed, compact })}
    </span>
  )
}
