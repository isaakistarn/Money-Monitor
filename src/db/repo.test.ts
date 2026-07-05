import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addAccount,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  upsertBudget,
  executePaySplit,
  addHolding,
  updateHolding,
  deleteHolding,
  rebuildRollups,
} from './repo'
import { currentYm, weekStartISO } from '@/lib/date'

async function balance(accountId: string, openingMinor: number, isLiability = false) {
  const r = await db.accountRollup.get(accountId)
  return openingMinor * (isLiability ? -1 : 1) + (r?.deltaMinor ?? 0)
}

async function reset() {
  await Promise.all([
    db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
    db.budgets.clear(), db.recurring.clear(), db.meta.clear(),
    db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
    db.paySplits.clear(), db.holdings.clear(), db.outbox.clear(),
  ])
}

describe('repository rollups', () => {
  beforeEach(reset)

  it('applies income and expense to balances and monthly stats', async () => {
    const cat = 'food'
    await db.categories.add({ id: cat, name: 'Food', kind: 'expense', icon: '🍔', isDefault: true })
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })

    await addTransaction({ type: 'income', amountMinor: 50_00, accountId: bank.id, categoryId: undefined, date: todayInMonth() })
    await addTransaction({ type: 'expense', amountMinor: 20_00, accountId: bank.id, categoryId: cat, date: todayInMonth() })

    expect(await balance(bank.id, 100_00)).toBe(130_00) // 100 + 50 - 20

    const stat = await db.monthlyStats.get(currentYm())
    expect(stat?.incomeMinor).toBe(50_00)
    expect(stat?.expenseMinor).toBe(20_00)

    const catSpend = await db.categoryMonthly.get(`${currentYm()}:${cat}`)
    expect(catSpend?.spentMinor).toBe(20_00)
  })

  it('transfers move balances but never touch income/expense/category', async () => {
    const a = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })
    const b = await addAccount({ name: 'Savings', type: 'savings', openingBalanceMinor: 0 })

    await addTransaction({ type: 'transfer', amountMinor: 40_00, fromAccountId: a.id, toAccountId: b.id, date: todayInMonth() })

    expect(await balance(a.id, 100_00)).toBe(60_00)
    expect(await balance(b.id, 0)).toBe(40_00)

    const stat = await db.monthlyStats.get(currentYm())
    expect(stat?.incomeMinor ?? 0).toBe(0)
    expect(stat?.expenseMinor ?? 0).toBe(0)
    expect(await db.categoryMonthly.count()).toBe(0)
  })

  it('credit card balance goes negative when spent on', async () => {
    await db.categories.add({ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true })
    const card = await addAccount({ name: 'Card', type: 'credit_card', openingBalanceMinor: 0 })
    await addTransaction({ type: 'expense', amountMinor: 30_00, accountId: card.id, categoryId: 'food', date: todayInMonth() })
    // liability: opening 0 (-1) + delta(-30) = -30
    expect(await balance(card.id, 0, true)).toBe(-30_00)
  })

  it('editing reverses old effects and applies new', async () => {
    await db.categories.add({ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true })
    await db.categories.add({ id: 'fun', name: 'Fun', kind: 'expense', icon: '🎬', isDefault: true })
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })
    const tx = await addTransaction({ type: 'expense', amountMinor: 20_00, accountId: bank.id, categoryId: 'food', date: todayInMonth() })

    await updateTransaction(tx.id, { amountMinor: 5_00, categoryId: 'fun' })

    expect(await balance(bank.id, 100_00)).toBe(95_00)
    expect((await db.categoryMonthly.get(`${currentYm()}:food`))?.spentMinor ?? 0).toBe(0)
    expect((await db.categoryMonthly.get(`${currentYm()}:fun`))?.spentMinor).toBe(5_00)
  })

  it('deleting reverses effects', async () => {
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })
    const tx = await addTransaction({ type: 'income', amountMinor: 25_00, accountId: bank.id, date: todayInMonth() })
    await deleteTransaction(tx.id)
    expect(await balance(bank.id, 100_00)).toBe(100_00)
    expect((await db.monthlyStats.get(currentYm()))?.incomeMinor ?? 0).toBe(0)
  })

  it('rebuildRollups reproduces incrementally-maintained rollups exactly', async () => {
    await db.categories.add({ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true })
    const a = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })
    const b = await addAccount({ name: 'Savings', type: 'savings', openingBalanceMinor: 0 })
    await addTransaction({ type: 'income', amountMinor: 50_00, accountId: a.id, date: todayInMonth() })
    await addTransaction({ type: 'expense', amountMinor: 12_34, accountId: a.id, categoryId: 'food', date: todayInMonth() })
    await addTransaction({ type: 'transfer', amountMinor: 40_00, fromAccountId: a.id, toAccountId: b.id, date: todayInMonth() })

    const before = {
      acc: await db.accountRollup.orderBy('accountId').toArray(),
      month: await db.monthlyStats.toArray(),
      cat: await db.categoryMonthly.toArray(),
    }
    await rebuildRollups()
    const after = {
      acc: await db.accountRollup.orderBy('accountId').toArray(),
      month: await db.monthlyStats.toArray(),
      cat: await db.categoryMonthly.toArray(),
    }
    expect(after.acc).toEqual(before.acc)
    expect(after.month).toEqual(before.month)
    expect(after.cat).toEqual(before.cat)
  })

  it('excluded expense affects balance but not monthly/category stats', async () => {
    await db.categories.add({ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true })
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })

    await addTransaction({ type: 'expense', amountMinor: 30_00, accountId: bank.id, categoryId: 'food', date: todayInMonth() })
    const ex = await addTransaction({ type: 'expense', amountMinor: 50_00, accountId: bank.id, categoryId: 'food', date: todayInMonth(), excluded: true })

    // Balance reflects BOTH expenses (real money left the account).
    expect(await balance(bank.id, 100_00)).toBe(20_00) // 100 - 30 - 50

    // Analytics only count the non-excluded one.
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor).toBe(30_00)
    expect((await db.categoryMonthly.get(`${currentYm()}:food`))?.spentMinor).toBe(30_00)

    // Un-excluding via update brings it back into the stats.
    await updateTransaction(ex.id, { excluded: false })
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor).toBe(80_00)
    expect(await balance(bank.id, 100_00)).toBe(20_00) // balance unchanged

    // rebuildRollups reproduces the same (re-exclude first).
    await updateTransaction(ex.id, { excluded: true })
    const before = await db.monthlyStats.get(currentYm())
    await rebuildRollups()
    expect(await db.monthlyStats.get(currentYm())).toEqual(before)
    expect(await balance(bank.id, 100_00)).toBe(20_00)
  })

  it('executePaySplit records income once and transfers the rest', async () => {
    const bank = await addAccount({ name: 'Everyday', type: 'bank', openingBalanceMinor: 0 })
    const save = await addAccount({ name: 'Savings', type: 'savings', openingBalanceMinor: 0 })
    const bills = await addAccount({ name: 'Bills', type: 'bank', openingBalanceMinor: 0 })

    const n = await executePaySplit({
      totalMinor: 1000_00,
      depositAccountId: bank.id,
      date: todayInMonth(),
      lines: [
        { toAccountId: save.id, amountMinor: 300_00 },
        { toAccountId: bills.id, amountMinor: 200_00 },
      ],
    })
    expect(n).toBe(3) // 1 income + 2 transfers

    expect(await balance(bank.id, 0)).toBe(500_00) // 1000 in − 300 − 200 out
    expect(await balance(save.id, 0)).toBe(300_00)
    expect(await balance(bills.id, 0)).toBe(200_00)

    // Income counted once at the full pay; transfers never touch income/expense.
    const stat = await db.monthlyStats.get(currentYm())
    expect(stat?.incomeMinor).toBe(1000_00)
    expect(stat?.expenseMinor ?? 0).toBe(0)
  })

  it('holdings: add/update/delete stamp updatedAt and queue for sync', async () => {
    const h = await addHolding({ name: 'Apple', symbol: 'AAPL', type: 'stock', quantity: 10, unitPriceMinor: 150_00, costBasisMinor: 1200_00 })
    expect((await db.holdings.get(h.id))?.updatedAt).toBeGreaterThan(0)
    expect(await db.outbox.get(`holdings:${h.id}`)).toMatchObject({ deleted: false })

    await updateHolding(h.id, { unitPriceMinor: 180_00 })
    expect((await db.holdings.get(h.id))?.unitPriceMinor).toBe(180_00)

    await deleteHolding(h.id)
    expect(await db.holdings.get(h.id)).toBeUndefined()
    expect(await db.outbox.get(`holdings:${h.id}`)).toMatchObject({ deleted: true })
  })

  it('budget upsert replaces and removes on zero', async () => {
    await upsertBudget('food', currentYm(), 300_00)
    expect((await db.budgets.toArray()).length).toBe(1)
    await upsertBudget('food', currentYm(), 250_00)
    const all = await db.budgets.toArray()
    expect(all.length).toBe(1)
    expect(all[0].amountMinor).toBe(250_00)
    await upsertBudget('food', currentYm(), 0)
    expect((await db.budgets.toArray()).length).toBe(0)
  })

  it('weekly budgets: a week-start key marks period weekly and coexists with the monthly budget', async () => {
    const week = weekStartISO(todayInMonth())
    await upsertBudget('food', currentYm(), 300_00) // monthly
    await upsertBudget('food', week, 80_00) // weekly, same category

    const all = await db.budgets.toArray()
    expect(all.length).toBe(2)

    const weeklyRow = all.find((b) => b.ym === week)!
    const monthlyRow = all.find((b) => b.ym === currentYm())!
    expect(weeklyRow.period).toBe('weekly')
    expect(monthlyRow.period).toBeUndefined()

    // Replacing and zero-removal work per period key independently.
    await upsertBudget('food', week, 90_00)
    expect((await db.budgets.toArray()).length).toBe(2)
    await upsertBudget('food', week, 0)
    const rest = await db.budgets.toArray()
    expect(rest.length).toBe(1)
    expect(rest[0].ym).toBe(currentYm())
  })
})

function todayInMonth() {
  return new Date().toISOString().slice(0, 10)
}
