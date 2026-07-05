import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { importBackup } from './backup'

async function reset() {
  await Promise.all([
    db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
    db.budgets.clear(), db.recurring.clear(), db.meta.clear(),
    db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
    db.paySplits.clear(), db.holdings.clear(), db.watchlist.clear(), db.outbox.clear(),
  ])
}

const tx = (id: string, amountMinor: unknown) => ({
  id, type: 'expense', amountMinor, categoryId: 'food', accountId: 'a1',
  date: '2026-07-01', ym: '2026-07', createdAt: '2026-07-01T00:00:00Z',
})

function backupWith(transactions: unknown[]) {
  return JSON.stringify({
    app: 'finance-tracker',
    version: 1,
    exportedAt: '2026-07-05T00:00:00Z',
    data: {
      accounts: [{ id: 'a1', name: 'Bank', type: 'bank', openingBalanceMinor: 100_00, archived: false, order: 0, createdAt: '' }],
      categories: [{ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true }],
      transactions,
      budgets: [],
      recurring: [],
      meta: [],
    },
  })
}

describe('importBackup validates untrusted rows', () => {
  beforeEach(reset)

  it('imports well-formed rows and rebuilds rollups', async () => {
    const res = await importBackup(backupWith([tx('t1', 20_00), tx('t2', 5_00)]))
    expect(res).toEqual({ transactions: 2, dropped: 0 })
    expect((await db.monthlyStats.get('2026-07'))?.expenseMinor).toBe(25_00)
  })

  it('drops rows with missing ids, duplicate ids, or non-finite amounts', async () => {
    const res = await importBackup(backupWith([
      tx('t1', 20_00),
      tx('t1', 7_00), // duplicate id
      tx('t2', 'lots'), // string amount → NaN poison
      tx('t3', Infinity), // non-finite
      { ...tx('t4', 3_00), id: '' }, // empty id
      'not even an object',
      tx('t5', 5_00),
    ]))
    expect(res).toEqual({ transactions: 2, dropped: 5 })
    // Only the two clean rows influence balances/stats.
    expect((await db.monthlyStats.get('2026-07'))?.expenseMinor).toBe(25_00)
  })

  it('rejects files that are not Money Monitor backups', async () => {
    await expect(importBackup('{"app":"other"}')).rejects.toThrow(/does not look like/)
    await expect(importBackup('not json')).rejects.toThrow(/not valid JSON/)
  })
})
