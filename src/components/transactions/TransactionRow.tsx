import { memo } from 'react'
import { Money } from '@/components/ui/Money'
import { IconArrowDown, IconArrowUp, IconSwap } from '@/components/ui/icons'
import { relativeDateLabel } from '@/lib/date'
import { cn } from '@/lib/cn'
import type { Transaction } from '@/types/models'

export interface RowMeta {
  categoryName?: string
  categoryIcon?: string
  accountName?: string
  fromName?: string
  toName?: string
}

function typeVisual(t: Transaction['type']) {
  if (t === 'income') return { icon: <IconArrowUp width={16} />, ring: 'bg-positive/12 text-positive' }
  if (t === 'transfer') return { icon: <IconSwap width={16} />, ring: 'bg-accent/12 text-accent' }
  return { icon: <IconArrowDown width={16} />, ring: 'bg-negative/12 text-negative' }
}

export const TransactionRow = memo(function TransactionRow({
  tx,
  meta,
  onClick,
}: {
  tx: Transaction
  meta: RowMeta
  onClick?: () => void
}) {
  const v = typeVisual(tx.type)
  // A spend-counting transfer (e.g. a purchase round-up) reads as money spent.
  const spendTransfer = tx.type === 'transfer' && !!tx.countsAsSpend
  const title =
    tx.type === 'transfer'
      ? `${meta.fromName ?? '—'} → ${meta.toName ?? '—'}`
      : meta.categoryName ?? 'Uncategorised'
  const subtitle =
    tx.type === 'transfer'
      ? [spendTransfer ? meta.categoryName : undefined, tx.note].filter(Boolean).join(' · ') || 'Transfer'
      : [meta.accountName, tx.note].filter(Boolean).join(' · ')

  const signedMinor =
    tx.type === 'income' ? tx.amountMinor : tx.type === 'expense' || spendTransfer ? -tx.amountMinor : tx.amountMinor

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-elevated transition-colors text-left"
    >
      <span className={cn('shrink-0 grid place-items-center h-9 w-9 rounded-full text-base', v.ring)}>
        {tx.type === 'transfer' && !(spendTransfer && meta.categoryIcon)
          ? v.icon
          : <span className="text-base leading-none">{meta.categoryIcon ?? '•'}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium text-fg truncate">{title}</span>
          {spendTransfer && (
            <span className="shrink-0 text-[10px] font-medium text-muted bg-elevated rounded px-1.5 py-0.5 leading-none">
              spent
            </span>
          )}
          {tx.excluded && (
            <span className="shrink-0 text-[10px] font-medium text-muted bg-elevated rounded px-1.5 py-0.5 leading-none">
              excluded
            </span>
          )}
        </span>
        {subtitle && <span className="block text-xs text-faint truncate">{subtitle}</span>}
      </span>
      <span className="text-right shrink-0">
        <Money
          minor={signedMinor}
          signed={tx.type !== 'transfer' || spendTransfer}
          colorBySign={tx.type !== 'transfer' || spendTransfer}
          className={cn('text-sm font-semibold', tx.type === 'transfer' && !spendTransfer && 'text-muted')}
        />
        <span className="block text-xs text-faint">{relativeDateLabel(tx.date)}</span>
      </span>
    </button>
  )
})
