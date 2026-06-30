import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { IconPlus, IconTrash } from '@/components/ui/icons'
import { useAccounts, useCategories, usePaySplits } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { useUI } from '@/state/ui'
import { useConfirm } from '@/components/ui/Confirm'
import { savePaySplit, deletePaySplit, executePaySplit } from '@/db/repo'
import { resolveAllocations } from '@/lib/paysplit'
import { parseMoney, minorToInput, currencySymbol, formatMoney } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { uid } from '@/lib/cn'
import type { Allocation, AllocationMode, PaySplit } from '@/types/models'

interface AllocDraft {
  id: string
  toAccountId: string
  mode: AllocationMode
  value: string
}

interface Draft {
  id?: string
  name: string
  depositAccountId: string
  categoryId: string
  amount: string
  date: string
  allocations: AllocDraft[]
  saveAsTemplate: boolean
}

function blankDraft(depositAccountId: string, otherAccountId: string): Draft {
  return {
    name: '',
    depositAccountId,
    categoryId: '',
    amount: '',
    date: todayISO(),
    allocations: otherAccountId
      ? [{ id: uid(), toAccountId: otherAccountId, mode: 'percent', value: '' }]
      : [],
    saveAsTemplate: false,
  }
}

function fromTemplate(t: PaySplit, currency: string): Partial<Draft> {
  return {
    id: t.id,
    name: t.name,
    depositAccountId: t.depositAccountId,
    categoryId: t.categoryId ?? '',
    allocations: t.allocations.map((a) => ({
      id: a.id,
      toAccountId: a.toAccountId,
      mode: a.mode,
      value: a.mode === 'percent' ? String(a.value) : minorToInput(a.value, currency),
    })),
  }
}

/** Convert a draft allocation row into the stored/resolver `Allocation` shape. */
function toAllocation(a: AllocDraft, currency: string): Allocation {
  const value = a.mode === 'percent' ? Number(a.value) || 0 : parseMoney(a.value, currency) || 0
  return { id: a.id, toAccountId: a.toAccountId, mode: a.mode, value }
}

export function PaySplitModal({
  open,
  onClose,
  mode,
  initial,
}: {
  open: boolean
  onClose: () => void
  /** 'run' applies a split to a pay amount; 'edit' manages a saved template. */
  mode: 'run' | 'edit'
  initial?: PaySplit
}) {
  const accounts = useAccounts()
  const categories = useCategories()
  const templates = usePaySplits()
  const currency = useCurrency()
  const { toast } = useUI()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const incomeCats = (categories ?? []).filter((c) => c.kind === 'income')

  // Initialise the draft once per open-session via an effect (not during render),
  // guarded by a ref so frequent re-renders — e.g. from background sync writing to
  // the DB and refiring live queries — never reset what you're typing.
  const [draft, setDraft] = useState<Draft | null>(null)
  const initedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      initedFor.current = null
      setDraft(null)
      return
    }
    if (!accounts) return
    const k = `${initial?.id ?? 'new'}:${mode}`
    if (initedFor.current === k) return // already initialised this session
    initedFor.current = k
    const deposit = initial?.depositAccountId ?? accounts[0]?.id ?? ''
    const other = accounts.find((a) => a.id !== deposit)?.id ?? ''
    setDraft({ ...blankDraft(deposit, other), ...(initial ? fromTemplate(initial, currency) : {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts, initial?.id, mode])

  const resolved = useMemo(() => {
    if (!draft) return null
    const total = parseMoney(draft.amount, currency) || 0
    return resolveAllocations(total, draft.allocations.map((a) => toAllocation(a, currency)))
  }, [draft, currency])

  if (!open || !draft) return null

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? '—'
  const targets = (accounts ?? []).filter((a) => a.id !== draft.depositAccountId)

  const setAlloc = (id: string, patch: Partial<AllocDraft>) =>
    setDraft({ ...draft, allocations: draft.allocations.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  const addAlloc = () =>
    setDraft({
      ...draft,
      allocations: [...draft.allocations, { id: uid(), toAccountId: targets[0]?.id ?? '', mode: 'percent', value: '' }],
    })
  const removeAlloc = (id: string) =>
    setDraft({ ...draft, allocations: draft.allocations.filter((a) => a.id !== id) })

  const allocations = draft.allocations.map((a) => toAllocation(a, currency))

  const saveTemplate = async () => {
    if (!draft.name.trim()) return toast('Give the split a name.', 'error')
    if (!draft.depositAccountId) return toast('Choose a deposit account.', 'error')
    await savePaySplit({
      id: draft.id ?? uid(),
      name: draft.name.trim(),
      depositAccountId: draft.depositAccountId,
      categoryId: draft.categoryId || undefined,
      allocations,
    })
    toast('Split saved', 'success')
    onClose()
  }

  const removeTemplate = async () => {
    if (!draft.id) return
    const ok = await confirm({
      title: 'Delete this split?',
      message: 'The template is removed. Transactions you already created stay.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await deletePaySplit(draft.id)
    toast('Split deleted')
    onClose()
  }

  const runSplit = async () => {
    if (!resolved || !resolved.valid) return toast(resolved?.error ?? 'Check the amounts.', 'error')
    if (!draft.depositAccountId) return toast('Choose a deposit account.', 'error')
    setBusy(true)
    try {
      const n = await executePaySplit({
        totalMinor: parseMoney(draft.amount, currency),
        depositAccountId: draft.depositAccountId,
        categoryId: draft.categoryId || undefined,
        date: draft.date,
        note: draft.name.trim() || undefined,
        lines: resolved.lines,
      })
      if (draft.saveAsTemplate) {
        await savePaySplit({
          id: draft.id ?? uid(),
          name: draft.name.trim() || 'My pay split',
          depositAccountId: draft.depositAccountId,
          categoryId: draft.categoryId || undefined,
          allocations,
        })
      }
      toast(`Pay added and split across ${n - 1} account${n - 1 === 1 ? '' : 's'}`, 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const notEnoughAccounts = (accounts?.length ?? 0) < 2

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'edit' ? (draft.id ? 'Edit pay split' : 'New pay split') : 'Split a payment'}
      footer={
        mode === 'edit' ? (
          <>
            {draft.id && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={removeTemplate}>
                <IconTrash width={18} /> Delete
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={saveTemplate}>Save</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={runSplit} disabled={busy || notEnoughAccounts || !resolved?.valid}>
              {busy ? 'Adding…' : 'Add to accounts'}
            </Button>
          </>
        )
      }
    >
      {notEnoughAccounts ? (
        <p className="text-sm text-muted py-6 text-center">
          You need at least two accounts to split a payment. Add another account first.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Run mode: load a saved template */}
          {mode === 'run' && (templates?.length ?? 0) > 0 && (
            <Field label="Use a saved split">
              <Select
                value={draft.id ?? ''}
                onChange={(e) => {
                  const t = templates?.find((x) => x.id === e.target.value)
                  setDraft({
                    ...draft,
                    ...(t ? fromTemplate(t, currency) : { id: undefined, allocations: draft.allocations }),
                  })
                }}
              >
                <option value="">Custom (set up below)</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {mode === 'run' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pay amount">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                  <Input
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-8"
                    autoFocus
                  />
                </div>
              </Field>
              <Field label="Date">
                <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </Field>
            </div>
          )}

          {mode === 'edit' && (
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Fortnightly pay" maxLength={40} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Deposit into" hint="Where the pay arrives">
              <Select
                value={draft.depositAccountId}
                onChange={(e) => setDraft({ ...draft, depositAccountId: e.target.value })}
              >
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Income category">
              <Select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                <option value="">None</option>
                {incomeCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </Select>
            </Field>
          </div>

          {/* Allocations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Send to other accounts</p>
              <Button size="sm" variant="secondary" onClick={addAlloc}><IconPlus width={15} /> Add</Button>
            </div>
            {draft.allocations.length === 0 ? (
              <p className="text-xs text-muted py-2">No allocations — the whole pay stays in the deposit account.</p>
            ) : (
              <div className="space-y-2.5">
                {draft.allocations.map((a, i) => {
                  const lineMinor = resolved?.lines[i]?.amountMinor ?? 0
                  return (
                    <div key={a.id} className="rounded-xl border border-border p-3 space-y-2.5">
                      <div className="flex gap-2">
                        <Select value={a.toAccountId} onChange={(e) => setAlloc(a.id, { toAccountId: e.target.value })} className="flex-1">
                          {a.toAccountId && !targets.some((t) => t.id === a.toAccountId) && (
                            <option value={a.toAccountId}>{accountName(a.toAccountId)}</option>
                          )}
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                        <button
                          type="button"
                          onClick={() => removeAlloc(a.id)}
                          className="shrink-0 grid place-items-center h-11 w-11 rounded-xl text-muted hover:text-negative hover:bg-elevated"
                          aria-label="Remove allocation"
                        >
                          <IconTrash width={18} />
                        </button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <Select value={a.mode} onChange={(e) => setAlloc(a.id, { mode: e.target.value as AllocationMode })} className="w-28">
                          <option value="percent">Percent</option>
                          <option value="fixed">Amount</option>
                        </Select>
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">
                            {a.mode === 'percent' ? '%' : currencySymbol(currency)}
                          </span>
                          <Input
                            value={a.value}
                            onChange={(e) => setAlloc(a.id, { value: e.target.value })}
                            inputMode="decimal"
                            placeholder={a.mode === 'percent' ? '0' : '0.00'}
                            className="pl-7"
                          />
                        </div>
                        {mode === 'run' && (
                          <span className="w-24 text-right text-sm font-medium tabular-nums">
                            {draft.amount ? formatMoney(lineMinor, currency) : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Live preview (run mode) */}
          {mode === 'run' && resolved && (
            <div className="rounded-xl bg-elevated/60 border border-border p-3.5 space-y-1.5 text-sm">
              {resolved.error ? (
                <p className="text-negative font-medium">{resolved.error}</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted">Allocated</span>
                    <Money minor={resolved.allocatedMinor} className="font-medium" />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Stays in {accountName(draft.depositAccountId)}</span>
                    <Money minor={resolved.leftoverMinor} className="font-medium text-positive" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Save-as-template (run mode) */}
          {mode === 'run' && !draft.id && (
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={draft.saveAsTemplate}
                onChange={(e) => setDraft({ ...draft, saveAsTemplate: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              Save this as a reusable split
            </label>
          )}
          {mode === 'run' && draft.saveAsTemplate && !draft.id && (
            <Field label="Split name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Fortnightly pay" maxLength={40} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}
