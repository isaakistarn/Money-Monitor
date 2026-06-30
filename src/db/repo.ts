import { db } from './db'
import type { Account, Budget, Holding, PaySplit, Recurring, Transaction, WatchItem } from '@/types/models'
import { ymOf, addDaysISO, addMonthsISO } from '@/lib/date'
import { uid } from '@/lib/cn'
import { now, markChanged, markDeleted } from './changes'

/**
 * The repository is the ONLY sanctioned path for mutating transactions.
 * Every write happens inside a single Dexie read-write transaction that updates
 * the row AND applies signed deltas to the three rollup tables, so the rest of
 * the app reads O(1) aggregates and never scans the raw transaction table.
 */

type NewTransaction = Omit<Transaction, 'id' | 'ym' | 'createdAt'> &
  Partial<Pick<Transaction, 'id' | 'createdAt'>>

/** Net signed effect of a transaction on a given account, in minor units. */
function accountEffect(t: Transaction, accountId: string): number {
  if (t.type === 'income' && t.accountId === accountId) return t.amountMinor
  if (t.type === 'expense' && t.accountId === accountId) return -t.amountMinor
  if (t.type === 'transfer') {
    if (t.fromAccountId === accountId) return -t.amountMinor
    if (t.toAccountId === accountId) return t.amountMinor
  }
  return 0
}

async function bumpAccount(accountId: string | undefined, delta: number) {
  if (!accountId || delta === 0) return
  const row = await db.accountRollup.get(accountId)
  await db.accountRollup.put({
    accountId,
    deltaMinor: (row?.deltaMinor ?? 0) + delta,
  })
}

async function bumpMonthly(ym: string, incomeDelta: number, expenseDelta: number) {
  if (incomeDelta === 0 && expenseDelta === 0) return
  const row = await db.monthlyStats.get(ym)
  await db.monthlyStats.put({
    ym,
    incomeMinor: (row?.incomeMinor ?? 0) + incomeDelta,
    expenseMinor: (row?.expenseMinor ?? 0) + expenseDelta,
  })
}

async function bumpCategory(ym: string, categoryId: string | undefined, delta: number) {
  if (!categoryId || delta === 0) return
  const id = `${ym}:${categoryId}`
  const row = await db.categoryMonthly.get(id)
  await db.categoryMonthly.put({
    id,
    ym,
    categoryId,
    spentMinor: (row?.spentMinor ?? 0) + delta,
  })
}

/** Apply (+1) or reverse (-1) all rollup effects of a transaction. */
async function applyRollups(t: Transaction, sign: 1 | -1) {
  // Account balances always reflect real money movement.
  await bumpAccount(t.accountId, sign * accountEffect(t, t.accountId ?? ''))
  if (t.type === 'transfer') {
    await bumpAccount(t.fromAccountId, sign * -t.amountMinor)
    await bumpAccount(t.toAccountId, sign * t.amountMinor)
  }
  // Analytics aggregates skip excluded transactions (and transfers).
  if (t.excluded) return
  if (t.type === 'income') await bumpMonthly(t.ym, sign * t.amountMinor, 0)
  if (t.type === 'expense') {
    await bumpMonthly(t.ym, 0, sign * t.amountMinor)
    await bumpCategory(t.ym, t.categoryId, sign * t.amountMinor)
  }
}

export async function addTransaction(input: NewTransaction): Promise<Transaction> {
  const ts = now()
  const tx: Transaction = {
    id: input.id ?? uid(),
    type: input.type,
    amountMinor: Math.abs(Math.round(input.amountMinor)),
    categoryId: input.type === 'transfer' ? undefined : input.categoryId,
    accountId: input.type === 'transfer' ? undefined : input.accountId,
    fromAccountId: input.type === 'transfer' ? input.fromAccountId : undefined,
    toAccountId: input.type === 'transfer' ? input.toAccountId : undefined,
    date: input.date,
    ym: ymOf(input.date),
    note: input.note?.trim() || undefined,
    excluded: input.excluded || undefined,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: ts,
  }
  await db.transaction('rw', db.transactions, db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox, async () => {
    await db.transactions.add(tx)
    await applyRollups(tx, 1)
    await markChanged('transactions', tx.id, ts)
  })
  return tx
}

export async function updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.transactions, db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox, async () => {
    const old = await db.transactions.get(id)
    if (!old) return
    await applyRollups(old, -1) // reverse the old effects
    const next: Transaction = {
      ...old,
      ...patch,
      amountMinor:
        patch.amountMinor != null ? Math.abs(Math.round(patch.amountMinor)) : old.amountMinor,
      date: patch.date ?? old.date,
      ym: ymOf(patch.date ?? old.date),
      updatedAt: ts,
    }
    // Normalise mutually-exclusive account fields by type.
    if (next.type === 'transfer') {
      next.categoryId = undefined
      next.accountId = undefined
    } else {
      next.fromAccountId = undefined
      next.toAccountId = undefined
    }
    await db.transactions.put(next)
    await applyRollups(next, 1) // apply the new effects
    await markChanged('transactions', id, ts)
  })
}

export async function deleteTransaction(id: string): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.transactions, db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox, async () => {
    const old = await db.transactions.get(id)
    if (!old) return
    await applyRollups(old, -1)
    await db.transactions.delete(id)
    await markDeleted('transactions', id, ts)
  })
}

/* ----------------------------- Accounts ----------------------------- */

export async function addAccount(input: Omit<Account, 'id' | 'order' | 'createdAt' | 'archived'>): Promise<Account> {
  const ts = now()
  const count = await db.accounts.count()
  const account: Account = {
    ...input,
    id: uid(),
    archived: false,
    order: count,
    createdAt: new Date().toISOString(),
    updatedAt: ts,
  }
  await db.transaction('rw', db.accounts, db.accountRollup, db.outbox, async () => {
    await db.accounts.add(account)
    await db.accountRollup.put({ accountId: account.id, deltaMinor: 0 })
    await markChanged('accounts', account.id, ts)
  })
  return account
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.accounts, db.outbox, async () => {
    await db.accounts.update(id, { ...patch, updatedAt: ts })
    await markChanged('accounts', id, ts)
  })
}

export async function deleteAccount(id: string): Promise<void> {
  const ts = now()
  await db.transaction(
    'rw',
    [db.accounts, db.accountRollup, db.transactions, db.monthlyStats, db.categoryMonthly, db.outbox],
    async () => {
      const related = await db.transactions
        .filter((t) => t.accountId === id || t.fromAccountId === id || t.toAccountId === id)
        .toArray()
      for (const t of related) {
        await applyRollups(t, -1)
        await db.transactions.delete(t.id)
        await markDeleted('transactions', t.id, ts)
      }
      await db.accountRollup.delete(id)
      await db.accounts.delete(id)
      await markDeleted('accounts', id, ts)
    },
  )
}

/* ----------------------------- Budgets ------------------------------ */

export async function upsertBudget(categoryId: string, ym: string, amountMinor: number): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.budgets, db.outbox, async () => {
    const existing = await db.budgets.where('[categoryId+ym]').equals([categoryId, ym]).first()
    if (amountMinor <= 0) {
      if (existing) {
        await db.budgets.delete(existing.id)
        await markDeleted('budgets', existing.id, ts)
      }
      return
    }
    const budget: Budget = { id: existing?.id ?? uid(), categoryId, ym, amountMinor, updatedAt: ts }
    await db.budgets.put(budget)
    await markChanged('budgets', budget.id, ts)
  })
}

/* ---------------------------- Recurring ----------------------------- */

export function advanceRecurring(r: Recurring): string {
  if (r.cadence === 'weekly') return addDaysISO(r.nextDue, 7)
  if (r.cadence === 'monthly') return addMonthsISO(r.nextDue, 1)
  return addDaysISO(r.nextDue, r.intervalDays && r.intervalDays > 0 ? r.intervalDays : 30)
}

/** Create or replace a recurring rule (stamped + queued for sync). */
export async function saveRecurring(rule: Recurring): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.recurring, db.outbox, async () => {
    await db.recurring.put({ ...rule, updatedAt: ts })
    await markChanged('recurring', rule.id, ts)
  })
}

export async function deleteRecurring(id: string): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.recurring, db.outbox, async () => {
    await db.recurring.delete(id)
    await markDeleted('recurring', id, ts)
  })
}

async function bumpRecurring(id: string, patch: Partial<Recurring>): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.recurring, db.outbox, async () => {
    await db.recurring.update(id, { ...patch, updatedAt: ts })
    await markChanged('recurring', id, ts)
  })
}

/** Confirm a recurring rule: create the transaction and advance its next-due date. */
export async function confirmRecurring(r: Recurring): Promise<void> {
  await addTransaction({
    type: r.type,
    amountMinor: r.amountMinor,
    categoryId: r.categoryId,
    accountId: r.accountId,
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    date: r.nextDue,
    note: r.note,
  })
  await bumpRecurring(r.id, { nextDue: advanceRecurring(r) })
}

export async function skipRecurring(r: Recurring): Promise<void> {
  await bumpRecurring(r.id, { nextDue: advanceRecurring(r) })
}

/* --------------------------- Pay splits ----------------------------- */

export async function savePaySplit(split: PaySplit): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.paySplits, db.outbox, async () => {
    await db.paySplits.put({ ...split, updatedAt: ts })
    await markChanged('paySplits', split.id, ts)
  })
}

export async function deletePaySplit(id: string): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.paySplits, db.outbox, async () => {
    await db.paySplits.delete(id)
    await markDeleted('paySplits', id, ts)
  })
}

export interface PaySplitExecution {
  totalMinor: number
  depositAccountId: string
  categoryId?: string
  date: string
  note?: string
  lines: Array<{ toAccountId: string; amountMinor: number; note?: string }>
}

/**
 * Apply a paycheck split: record the full pay as a single income into the
 * deposit account, then move each allocated portion out via a transfer. Income
 * is counted once (transfers never touch income/expense stats), so monthly
 * income reflects the true pay while balances land in the right accounts.
 * Returns the number of transactions created.
 */
export async function executePaySplit(x: PaySplitExecution): Promise<number> {
  let created = 0
  await addTransaction({
    type: 'income',
    amountMinor: x.totalMinor,
    accountId: x.depositAccountId,
    categoryId: x.categoryId,
    date: x.date,
    note: x.note,
  })
  created++
  for (const line of x.lines) {
    if (line.amountMinor <= 0 || line.toAccountId === x.depositAccountId) continue
    await addTransaction({
      type: 'transfer',
      amountMinor: line.amountMinor,
      fromAccountId: x.depositAccountId,
      toAccountId: line.toAccountId,
      date: x.date,
      note: line.note,
    })
    created++
  }
  return created
}

/* --------------------------- Holdings ------------------------------- */

export async function addHolding(
  input: Omit<Holding, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Holding> {
  const ts = now()
  const holding: Holding = { ...input, id: uid(), createdAt: new Date().toISOString(), updatedAt: ts }
  await db.transaction('rw', db.holdings, db.outbox, async () => {
    await db.holdings.add(holding)
    await markChanged('holdings', holding.id, ts)
  })
  return holding
}

export async function updateHolding(id: string, patch: Partial<Holding>): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.holdings, db.outbox, async () => {
    await db.holdings.update(id, { ...patch, updatedAt: ts })
    await markChanged('holdings', id, ts)
  })
}

export async function deleteHolding(id: string): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.holdings, db.outbox, async () => {
    await db.holdings.delete(id)
    await markDeleted('holdings', id, ts)
  })
}

/* --------------------------- Watchlist ------------------------------ */

export async function addWatchItem(input: { symbol: string; exchange?: string }): Promise<WatchItem> {
  const ts = now()
  const count = await db.watchlist.count()
  const item: WatchItem = {
    id: uid(),
    symbol: input.symbol.trim().toUpperCase(),
    exchange: input.exchange?.trim().toUpperCase() || undefined,
    order: count,
    createdAt: new Date().toISOString(),
    updatedAt: ts,
  }
  await db.transaction('rw', db.watchlist, db.outbox, async () => {
    await db.watchlist.add(item)
    await markChanged('watchlist', item.id, ts)
  })
  return item
}

export async function deleteWatchItem(id: string): Promise<void> {
  const ts = now()
  await db.transaction('rw', db.watchlist, db.outbox, async () => {
    await db.watchlist.delete(id)
    await markDeleted('watchlist', id, ts)
  })
}

/* ------------------------- Rollup rebuild --------------------------- */

/** Recompute every rollup table from the raw transactions. Used after import. */
export async function rebuildRollups(): Promise<void> {
  await db.transaction(
    'rw',
    db.transactions, db.accounts, db.accountRollup, db.monthlyStats, db.categoryMonthly,
    async () => {
      await db.accountRollup.clear()
      await db.monthlyStats.clear()
      await db.categoryMonthly.clear()

      const accounts = await db.accounts.toArray()
      const accDelta = new Map<string, number>(accounts.map((a) => [a.id, 0]))
      const monthly = new Map<string, { income: number; expense: number }>()
      const catMonthly = new Map<string, { ym: string; categoryId: string; spent: number }>()

      await db.transactions.each((t) => {
        if (t.type === 'transfer') {
          if (t.fromAccountId) accDelta.set(t.fromAccountId, (accDelta.get(t.fromAccountId) ?? 0) - t.amountMinor)
          if (t.toAccountId) accDelta.set(t.toAccountId, (accDelta.get(t.toAccountId) ?? 0) + t.amountMinor)
          return
        }
        // Account balance always counts the real movement.
        if (t.accountId) {
          const d = t.type === 'income' ? t.amountMinor : -t.amountMinor
          accDelta.set(t.accountId, (accDelta.get(t.accountId) ?? 0) + d)
        }
        // Excluded transactions are left out of the analytics aggregates.
        if (t.excluded) return
        const m = monthly.get(t.ym) ?? { income: 0, expense: 0 }
        if (t.type === 'income') {
          m.income += t.amountMinor
        } else {
          m.expense += t.amountMinor
          if (t.categoryId) {
            const key = `${t.ym}:${t.categoryId}`
            const c = catMonthly.get(key) ?? { ym: t.ym, categoryId: t.categoryId, spent: 0 }
            c.spent += t.amountMinor
            catMonthly.set(key, c)
          }
        }
        monthly.set(t.ym, m)
      })

      await db.accountRollup.bulkPut(
        [...accDelta.entries()].map(([accountId, deltaMinor]) => ({ accountId, deltaMinor })),
      )
      await db.monthlyStats.bulkPut(
        [...monthly.entries()].map(([ym, v]) => ({ ym, incomeMinor: v.income, expenseMinor: v.expense })),
      )
      await db.categoryMonthly.bulkPut(
        [...catMonthly.entries()].map(([id, v]) => ({
          id, ym: v.ym, categoryId: v.categoryId, spentMinor: v.spent,
        })),
      )
    },
  )
}
