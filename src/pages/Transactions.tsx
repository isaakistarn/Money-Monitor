import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useVirtualizer } from '@tanstack/react-virtual'
import { db } from '@/db/db'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionRow } from '@/components/transactions/TransactionRow'
import { IconSearch, IconList, IconFilter, IconPlus } from '@/components/ui/icons'
import { useCategories, useAccounts } from '@/hooks/useData'
import { useRowMeta } from '@/hooks/useRowMeta'
import { useUI } from '@/state/ui'
import type { Transaction, TransactionType } from '@/types/models'
import { cn } from '@/lib/cn'

type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

export function Transactions() {
  const all = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [])
  const categories = useCategories()
  const accounts = useAccounts()
  const rowMeta = useRowMeta()
  const { openEditor } = useUI()

  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | TransactionType>('all')
  const [accountId, setAccountId] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [sort, setSort] = useState<SortKey>('date-desc')
  const [showFilters, setShowFilters] = useState(false)

  const parentRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!all) return []
    const q = query.trim().toLowerCase()
    const catMap = new Map((categories ?? []).map((c) => [c.id, c.name.toLowerCase()]))
    const accMap = new Map((accounts ?? []).map((a) => [a.id, a.name.toLowerCase()]))

    let rows = all.filter((t) => {
      if (type !== 'all' && t.type !== type) return false
      if (accountId !== 'all' && t.accountId !== accountId && t.fromAccountId !== accountId && t.toAccountId !== accountId)
        return false
      if (categoryId !== 'all' && t.categoryId !== categoryId) return false
      if (q) {
        const hay = [
          t.note ?? '',
          t.categoryId ? catMap.get(t.categoryId) ?? '' : '',
          t.accountId ? accMap.get(t.accountId) ?? '' : '',
          t.fromAccountId ? accMap.get(t.fromAccountId) ?? '' : '',
          t.toAccountId ? accMap.get(t.toAccountId) ?? '' : '',
        ].join(' ')
        if (!hay.includes(q)) return false
      }
      return true
    })

    rows = rows.sort((a, b) => {
      switch (sort) {
        case 'date-asc': return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
        case 'amount-desc': return b.amountMinor - a.amountMinor
        case 'amount-asc': return a.amountMinor - b.amountMinor
        default: return a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      }
    })
    return rows
  }, [all, query, type, accountId, categoryId, sort, categories, accounts])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 12,
  })

  const activeFilterCount =
    (type !== 'all' ? 1 : 0) + (accountId !== 'all' ? 1 : 0) + (categoryId !== 'all' ? 1 : 0)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted mt-0.5">
            {all ? `${filtered.length} of ${all.length}` : '…'} shown
          </p>
        </div>
        <Button className="hidden sm:inline-flex" onClick={() => openEditor()}>
          <IconPlus width={18} /> New
        </Button>
      </div>

      {/* Search + filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" width={18} />
          <Input
            data-search-input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, categories, accounts…"
            className="pl-10"
          />
        </div>
        <Button
          variant={activeFilterCount ? 'primary' : 'secondary'}
          size="icon"
          onClick={() => setShowFilters((s) => !s)}
          aria-label="Filters"
        >
          <IconFilter />
        </Button>
      </div>

      {showFilters && (
        <Card className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-fade-in">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="all">All types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="all">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="amount-desc">Largest amount</option>
            <option value="amount-asc">Smallest amount</option>
          </Select>
        </Card>
      )}

      {/* Virtualized list */}
      <Card className="p-1.5 sm:p-2">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IconList width={32} />}
            title={all && all.length ? 'No matches' : 'No transactions yet'}
            message={all && all.length ? 'Try clearing search or filters.' : 'Add your first transaction.'}
            action={
              all && all.length ? undefined : (
                <Button onClick={() => openEditor()}><IconPlus width={18} /> Add transaction</Button>
              )
            }
          />
        ) : (
          <div ref={parentRef} className={cn('overflow-y-auto', 'h-[calc(100vh-21rem)] md:h-[calc(100vh-19rem)]')}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const tx = filtered[vi.index] as Transaction
                return (
                  <div
                    key={tx.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <TransactionRow tx={tx} meta={rowMeta(tx)} onClick={() => openEditor(tx)} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
