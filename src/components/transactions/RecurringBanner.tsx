import { useDueRecurring, useCategories, useAccounts } from '@/hooks/useData'
import { confirmRecurring, skipRecurring } from '@/db/repo'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Money } from '@/components/ui/Money'
import { useUI } from '@/state/ui'

export function RecurringBanner() {
  const due = useDueRecurring()
  const cats = useCategories()
  const accounts = useAccounts()
  const { toast } = useUI()

  if (!due || due.length === 0) return null

  const catName = (id?: string) => cats?.find((c) => c.id === id)?.name
  const accName = (id?: string) => accounts?.find((a) => a.id === id)?.name

  return (
    <Card className="mb-5 p-4 border-accent/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span>🔁</span> {due.length} recurring {due.length === 1 ? 'item is' : 'items are'} due
        </h3>
      </div>
      <div className="space-y-2">
        {due.map((r) => {
          const label =
            r.type === 'transfer'
              ? `${accName(r.fromAccountId)} → ${accName(r.toAccountId)}`
              : `${catName(r.categoryId) ?? 'Transaction'} · ${accName(r.accountId) ?? ''}`
          return (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">
                <span className="font-medium">{r.note || label}</span>{' '}
                <Money minor={r.amountMinor} className="text-muted" />
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await skipRecurring(r)
                  toast('Skipped')
                }}
              >
                Skip
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await confirmRecurring(r)
                  toast('Added', 'success')
                }}
              >
                Add
              </Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
