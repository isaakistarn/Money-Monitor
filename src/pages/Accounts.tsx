import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/Confirm'
import { IconWallet, IconPlus, IconTrash } from '@/components/ui/icons'
import { useAccountsWithBalances, useBalanceTotals } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { useUI } from '@/state/ui'
import { addAccount, updateAccount, deleteAccount } from '@/db/repo'
import { parseMoney, minorToInput, currencySymbol } from '@/lib/money'
import { isLiability, type AccountType } from '@/types/models'

const TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank account',
  savings: 'Savings',
  credit_card: 'Credit card',
}
const TYPE_ICON: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  savings: '🐷',
  credit_card: '💳',
}

interface Draft {
  id?: string
  name: string
  type: AccountType
  opening: string
}

export function Accounts() {
  const accounts = useAccountsWithBalances()
  const totals = useBalanceTotals()
  const currency = useCurrency()
  const confirm = useConfirm()
  const { toast } = useUI()
  const [draft, setDraft] = useState<Draft | null>(null)

  const assets = (accounts ?? []).filter((a) => !isLiability(a.type))
  const liabilities = (accounts ?? []).filter((a) => isLiability(a.type))

  const save = async () => {
    if (!draft || !draft.name.trim()) return
    const openingMinor = parseMoney(draft.opening || '0', currency)
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      openingBalanceMinor: Number.isFinite(openingMinor) ? openingMinor : 0,
    }
    if (draft.id) await updateAccount(draft.id, payload)
    else await addAccount(payload)
    setDraft(null)
    toast(draft.id ? 'Account updated' : 'Account added', 'success')
  }

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      message: 'This permanently deletes the account and all of its transactions, then updates your balances.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await deleteAccount(id)
    setDraft(null)
    toast('Account deleted')
  }

  const renderAccount = (a: NonNullable<typeof accounts>[number]) => (
    <Card
      key={a.id}
      className="p-4 flex items-center gap-3 cursor-pointer hover:border-accent/40 transition-colors"
      onClick={() => setDraft({ id: a.id, name: a.name, type: a.type, opening: minorToInput(a.openingBalanceMinor, currency) })}
    >
      <span className="grid place-items-center h-10 w-10 rounded-full bg-elevated text-lg shrink-0">
        {TYPE_ICON[a.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{a.name}</p>
        <p className="text-xs text-faint">{TYPE_LABELS[a.type]}</p>
      </div>
      <Money
        minor={a.balanceMinor}
        className={`font-semibold tabular-nums ${a.balanceMinor < 0 ? 'text-negative' : ''}`}
      />
    </Card>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <Button onClick={() => setDraft({ name: '', type: 'bank', opening: '' })}>
          <IconPlus width={18} /> Add
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Total Assets</p>
          <p className="text-lg md:text-xl font-bold mt-1"><Money minor={totals?.totalAssetsMinor ?? 0} /></p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Liabilities</p>
          <p className="text-lg md:text-xl font-bold mt-1 text-negative"><Money minor={totals?.totalLiabilitiesMinor ?? 0} /></p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Net Worth</p>
          <p className="text-lg md:text-xl font-bold mt-1"><Money minor={totals?.netWorthMinor ?? 0} /></p>
        </Card>
      </div>

      {accounts && accounts.length === 0 ? (
        <EmptyState
          icon={<IconWallet width={32} />}
          title="No accounts yet"
          message="Add a bank, cash, savings, or credit card account to begin."
          action={<Button onClick={() => setDraft({ name: '', type: 'bank', opening: '' })}><IconPlus width={18} /> Add account</Button>}
        />
      ) : (
        <>
          {assets.length > 0 && (
            <section>
              <SectionHeader title="Assets" />
              <div className="space-y-2.5">{assets.map(renderAccount)}</div>
            </section>
          )}
          {liabilities.length > 0 && (
            <section>
              <SectionHeader title="Liabilities" />
              <div className="space-y-2.5">{liabilities.map(renderAccount)}</div>
            </section>
          )}
        </>
      )}

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit account' : 'New account'}
        footer={
          <>
            {draft?.id && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={() => remove(draft.id!, draft.name)}>
                <IconTrash width={18} /> Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save}>{draft?.id ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Name">
              <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Everyday" maxLength={40} />
            </Field>
            <Field label="Type">
              <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}>
                {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_ICON[t]} {TYPE_LABELS[t]}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Opening balance"
              hint={isLiability(draft.type) ? 'For a credit card, enter the amount currently owed.' : 'Balance before any transactions are recorded.'}
            >
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{currencySymbol(currency)}</span>
                <Input value={draft.opening} onChange={(e) => setDraft({ ...draft, opening: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-8" />
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
