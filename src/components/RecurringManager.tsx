import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Money } from '@/components/ui/Money'
import { IconPlus, IconTrash } from '@/components/ui/icons'
import { useRecurring, useCategories, useAccounts } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { saveRecurring, deleteRecurring } from '@/db/repo'
import { parseMoney, minorToInput, currencySymbol } from '@/lib/money'
import { todayISO, relativeDateLabel } from '@/lib/date'
import { uid } from '@/lib/cn'
import type { Cadence, Recurring, TransactionType } from '@/types/models'

interface Draft {
  id?: string
  type: TransactionType
  amount: string
  categoryId: string
  accountId: string
  fromAccountId: string
  toAccountId: string
  cadence: Cadence
  intervalDays: string
  nextDue: string
  note: string
}

function emptyDraft(): Draft {
  return {
    type: 'expense', amount: '', categoryId: '', accountId: '',
    fromAccountId: '', toAccountId: '', cadence: 'monthly',
    intervalDays: '30', nextDue: todayISO(), note: '',
  }
}

export function RecurringManager() {
  const rules = useRecurring()
  const categories = useCategories()
  const accounts = useAccounts()
  const currency = useCurrency()
  const [draft, setDraft] = useState<Draft | null>(null)

  const cat = (id?: string) => categories?.find((c) => c.id === id)
  const acc = (id?: string) => accounts?.find((a) => a.id === id)
  const visibleCats = (categories ?? []).filter((c) => c.kind === (draft?.type === 'income' ? 'income' : 'expense'))

  const open = (r?: Recurring) => {
    if (r) {
      setDraft({
        id: r.id, type: r.type, amount: minorToInput(r.amountMinor, currency),
        categoryId: r.categoryId ?? '', accountId: r.accountId ?? '',
        fromAccountId: r.fromAccountId ?? '', toAccountId: r.toAccountId ?? '',
        cadence: r.cadence, intervalDays: String(r.intervalDays ?? 30),
        nextDue: r.nextDue, note: r.note ?? '',
      })
    } else {
      const d = emptyDraft()
      d.categoryId = categories?.find((c) => c.kind === 'expense')?.id ?? ''
      d.accountId = accounts?.[0]?.id ?? ''
      d.fromAccountId = accounts?.[0]?.id ?? ''
      d.toAccountId = accounts?.[1]?.id ?? accounts?.[0]?.id ?? ''
      setDraft(d)
    }
  }

  const save = async () => {
    if (!draft) return
    const minor = parseMoney(draft.amount, currency)
    if (!Number.isFinite(minor) || minor <= 0) return
    const rule: Recurring = {
      id: draft.id ?? uid(),
      type: draft.type,
      amountMinor: minor,
      categoryId: draft.type === 'transfer' ? undefined : draft.categoryId || undefined,
      accountId: draft.type === 'transfer' ? undefined : draft.accountId || undefined,
      fromAccountId: draft.type === 'transfer' ? draft.fromAccountId : undefined,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId : undefined,
      cadence: draft.cadence,
      intervalDays: draft.cadence === 'custom' ? Number(draft.intervalDays) || 30 : undefined,
      nextDue: draft.nextDue,
      note: draft.note.trim() || undefined,
      active: true,
    }
    await saveRecurring(rule)
    setDraft(null)
  }

  const remove = async () => {
    if (draft?.id) await deleteRecurring(draft.id)
    setDraft(null)
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="Recurring"
        action={<Button size="sm" variant="secondary" onClick={() => open()}><IconPlus width={16} /> Add</Button>}
      />
      {rules && rules.length === 0 ? (
        <p className="text-sm text-muted py-2">
          No recurring items. Add subscriptions, rent, or salary and confirm them with one tap when due.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {rules?.map((r) => {
            const label =
              r.type === 'transfer'
                ? `${acc(r.fromAccountId)?.name} → ${acc(r.toAccountId)?.name}`
                : `${cat(r.categoryId)?.name ?? 'Transaction'} · ${acc(r.accountId)?.name ?? ''}`
            return (
              <button key={r.id} onClick={() => open(r)} className="w-full flex items-center gap-3 py-2.5 text-left">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{r.note || label}</span>
                  <span className="block text-xs text-faint capitalize">{r.cadence} · next {relativeDateLabel(r.nextDue)}</span>
                </span>
                <Money minor={r.amountMinor} className="text-sm font-medium" />
              </button>
            )
          })}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit recurring' : 'New recurring'}
        footer={
          <>
            {draft?.id && <Button variant="ghost" className="mr-auto text-negative" onClick={remove}><IconTrash width={18} /> Delete</Button>}
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Segmented<TransactionType>
              value={draft.type}
              onChange={(type) => setDraft({ ...draft, type })}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
                { value: 'transfer', label: 'Transfer' },
              ]}
            />
            <Field label="Amount">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                <Input value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-8" />
              </div>
            </Field>

            {draft.type === 'transfer' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <Select value={draft.fromAccountId} onChange={(e) => setDraft({ ...draft, fromAccountId: e.target.value })}>
                    {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
                <Field label="To">
                  <Select value={draft.toAccountId} onChange={(e) => setDraft({ ...draft, toAccountId: e.target.value })}>
                    {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <Select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                    {visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Account">
                  <Select value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}>
                    {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeats">
                <Select value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Cadence })}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Every N days</option>
                </Select>
              </Field>
              {draft.cadence === 'custom' ? (
                <Field label="Interval (days)">
                  <Input value={draft.intervalDays} onChange={(e) => setDraft({ ...draft, intervalDays: e.target.value })} inputMode="numeric" />
                </Field>
              ) : (
                <Field label="Next due">
                  <Input type="date" value={draft.nextDue} onChange={(e) => setDraft({ ...draft, nextDue: e.target.value })} />
                </Field>
              )}
            </div>
            {draft.cadence === 'custom' && (
              <Field label="Next due">
                <Input type="date" value={draft.nextDue} onChange={(e) => setDraft({ ...draft, nextDue: e.target.value })} />
              </Field>
            )}
            <Field label="Note (optional)">
              <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. Netflix" maxLength={60} />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  )
}
