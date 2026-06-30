import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { IconPlus, IconSwap } from '@/components/ui/icons'
import { useAccounts, usePaySplits } from '@/hooks/useData'
import { PaySplitModal } from '@/components/PaySplitModal'
import type { PaySplit } from '@/types/models'

export function PaySplitManager() {
  const splits = usePaySplits()
  const accounts = useAccounts()
  const [editing, setEditing] = useState<PaySplit | 'new' | null>(null)
  const [running, setRunning] = useState<PaySplit | null>(null)

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? '—'

  return (
    <Card className="p-5">
      <SectionHeader
        title="Pay splits"
        action={
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <IconPlus width={16} /> New
          </Button>
        }
      />

      {splits && splits.length === 0 ? (
        <p className="text-sm text-muted py-2">
          Create a reusable split to divide each paycheck across your accounts in one tap — e.g. 60% to
          Everyday, 30% to Savings, 10% to a bills account.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {splits?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => setEditing(s)} className="flex-1 min-w-0 text-left">
                <span className="block text-sm font-medium truncate">{s.name}</span>
                <span className="block text-xs text-faint">
                  Into {accountName(s.depositAccountId)} · {s.allocations.length} allocation{s.allocations.length === 1 ? '' : 's'}
                </span>
              </button>
              <Button size="sm" variant="secondary" onClick={() => setRunning(s)}>
                <IconSwap width={15} /> Use
              </Button>
            </div>
          ))}
        </div>
      )}

      <PaySplitModal
        mode="edit"
        open={editing !== null}
        initial={editing && editing !== 'new' ? editing : undefined}
        onClose={() => setEditing(null)}
      />
      <PaySplitModal
        mode="run"
        open={running !== null}
        initial={running ?? undefined}
        onClose={() => setRunning(null)}
      />
    </Card>
  )
}
