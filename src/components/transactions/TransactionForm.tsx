import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { IconArrowDown, IconArrowUp, IconSwap, IconTrash } from '@/components/ui/icons'
import { useAccounts, useCategories } from '@/hooks/useData'
import { useUI } from '@/state/ui'
import { useConfirm } from '@/components/ui/Confirm'
import { useCurrency } from '@/state/settings'
import { addTransaction, updateTransaction, deleteTransaction } from '@/db/repo'
import { parseMoney, minorToInput, currencySymbol } from '@/lib/money'
import { todayISO } from '@/lib/date'
import type { TransactionType } from '@/types/models'

export function TransactionForm() {
  const { editorOpen, editing, closeEditor, toast } = useUI()
  const categories = useCategories()
  const accounts = useAccounts()
  const confirm = useConfirm()
  const currency = useCurrency()
  const amountRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const isEdit = !!editing

  // Hydrate the form whenever it opens.
  useEffect(() => {
    if (!editorOpen) return
    if (editing) {
      setType(editing.type)
      setAmount(minorToInput(editing.amountMinor, currency))
      setCategoryId(editing.categoryId ?? '')
      setAccountId(editing.accountId ?? '')
      setFromAccountId(editing.fromAccountId ?? '')
      setToAccountId(editing.toAccountId ?? '')
      setDate(editing.date)
      setNote(editing.note ?? '')
    } else {
      setType('expense')
      setAmount('')
      setCategoryId('')
      setAccountId('')
      setFromAccountId('')
      setToAccountId('')
      setDate(todayISO())
      setNote('')
    }
    setError('')
    // Focus amount for the fastest possible entry.
    setTimeout(() => amountRef.current?.focus(), 60)
  }, [editorOpen, editing, currency])

  const visibleCategories = useMemo(
    () => (categories ?? []).filter((c) => c.kind === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  )

  // Sensible defaults once data + type are known.
  useEffect(() => {
    if (!editorOpen || isEdit) return
    if (type !== 'transfer' && !categoryId && visibleCategories[0]) {
      setCategoryId(visibleCategories[0].id)
    }
  }, [editorOpen, isEdit, type, visibleCategories, categoryId])

  useEffect(() => {
    if (!editorOpen || isEdit || !accounts?.length) return
    if (!accountId) setAccountId(accounts[0].id)
    if (!fromAccountId) setFromAccountId(accounts[0].id)
    if (!toAccountId) setToAccountId(accounts[1]?.id ?? accounts[0].id)
  }, [editorOpen, isEdit, accounts, accountId, fromAccountId, toAccountId])

  // Switching to/from transfer requires a valid category selection.
  useEffect(() => {
    if (type !== 'transfer' && !visibleCategories.some((c) => c.id === categoryId)) {
      setCategoryId(visibleCategories[0]?.id ?? '')
    }
  }, [type, visibleCategories, categoryId])

  const submit = async () => {
    setError('')
    const minor = parseMoney(amount, currency)
    if (!Number.isFinite(minor) || minor <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (type === 'transfer') {
      if (!fromAccountId || !toAccountId) return setError('Choose both accounts.')
      if (fromAccountId === toAccountId) return setError('Transfer accounts must differ.')
    } else {
      if (!accountId) return setError('Choose an account.')
      if (!categoryId) return setError('Choose a category.')
    }

    const payload = {
      type,
      amountMinor: minor,
      categoryId: type === 'transfer' ? undefined : categoryId,
      accountId: type === 'transfer' ? undefined : accountId,
      fromAccountId: type === 'transfer' ? fromAccountId : undefined,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      date,
      note,
    }
    try {
      if (editing) {
        await updateTransaction(editing.id, payload)
        toast('Transaction updated', 'success')
      } else {
        await addTransaction(payload)
        toast('Transaction added', 'success')
      }
      closeEditor()
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.')
    }
  }

  const onDelete = async () => {
    if (!editing) return
    const ok = await confirm({
      title: 'Delete transaction?',
      message: 'This permanently removes the transaction and updates your balances.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await deleteTransaction(editing.id)
    toast('Transaction deleted')
    closeEditor()
  }

  const onAmountKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || type === 'expense' || type === 'income')) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Modal
      open={editorOpen}
      onClose={closeEditor}
      title={isEdit ? 'Edit transaction' : 'New transaction'}
      footer={
        <>
          {isEdit && (
            <Button variant="ghost" onClick={onDelete} className="mr-auto text-negative">
              <IconTrash width={18} /> Delete
            </Button>
          )}
          <Button variant="secondary" onClick={closeEditor}>
            Cancel
          </Button>
          <Button onClick={submit}>{isEdit ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<TransactionType>
          value={type}
          onChange={setType}
          options={[
            { value: 'expense', label: 'Expense', icon: <IconArrowDown width={16} /> },
            { value: 'income', label: 'Income', icon: <IconArrowUp width={16} /> },
            { value: 'transfer', label: 'Transfer', icon: <IconSwap width={16} /> },
          ]}
        />

        <Field label="Amount" error={error && /amount/i.test(error) ? error : undefined}>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted text-lg pointer-events-none">
              {currencySymbol(currency)}
            </span>
            <Input
              ref={amountRef}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onAmountKey}
              inputMode="decimal"
              placeholder="0.00"
              className="pl-8 text-xl font-semibold h-14"
            />
          </div>
        </Field>

        {type === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="To">
              <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {visibleCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Groceries" maxLength={80} />
          </Field>
        </div>

        {error && !/amount/i.test(error) && (
          <p className="text-sm text-negative">{error}</p>
        )}
      </div>
    </Modal>
  )
}
