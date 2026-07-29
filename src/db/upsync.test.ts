import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { addAccount } from './repo'
import { setMeta } from './meta'
import { completeUpConnect, syncUpNow, type UpSettings } from './upsync'
import { matchUpCategory } from '@/lib/up'
import { currentYm, toISODate } from '@/lib/date'

/* ------------------------- Up API fetch stub ------------------------- */

interface StubTxn {
  id: string
  amountMinor: number
  accountId: string
  description?: string
  message?: string | null
  status?: 'HELD' | 'SETTLED'
  createdAt?: string
  settledAt?: string | null
  transferAccountId?: string | null
  categoryId?: string | null
}

/** Today with a time component, so dates land in the current month/ym. */
const todayIso = `${toISODate(new Date())}T10:00:00+10:00`

function rawTxn(t: StubTxn) {
  return {
    id: t.id,
    attributes: {
      status: t.status ?? 'SETTLED',
      description: t.description ?? 'MERCHANT',
      message: t.message ?? null,
      amount: { currencyCode: 'AUD', value: String(t.amountMinor / 100), valueInBaseUnits: t.amountMinor },
      createdAt: t.createdAt ?? todayIso,
      settledAt: t.settledAt !== undefined ? t.settledAt : (t.createdAt ?? todayIso),
    },
    relationships: {
      account: { data: { id: t.accountId } },
      transferAccount: { data: t.transferAccountId ? { id: t.transferAccountId } : null },
      category: { data: t.categoryId ? { id: t.categoryId } : null },
    },
  }
}

/** Serve these transactions (honouring filter[since], like the real API). */
function stubUpApi(txns: StubTxn[], accounts: Array<{ id: string; name: string; balanceMinor: number; type?: string }> = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const since = new URL(String(url)).searchParams.get('filter[since]')
      const body = String(url).includes('/transactions')
        ? {
            data: txns
              .filter((t) => !since || Date.parse(t.createdAt ?? todayIso) >= Date.parse(since))
              .map(rawTxn),
            links: { next: null },
          }
        : String(url).includes('/accounts')
          ? {
              data: accounts.map((a) => ({
                id: a.id,
                attributes: {
                  displayName: a.name,
                  accountType: a.type ?? 'TRANSACTIONAL',
                  balance: { currencyCode: 'AUD', value: '0', valueInBaseUnits: a.balanceMinor },
                },
              })),
              links: { next: null },
            }
          : {}
      return { ok: true, status: 200, json: async () => body } as Response
    }),
  )
}

/* ------------------------------ Setup ------------------------------- */

async function reset() {
  await Promise.all([
    db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
    db.budgets.clear(), db.recurring.clear(), db.meta.clear(),
    db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
    db.paySplits.clear(), db.holdings.clear(), db.outbox.clear(),
  ])
}

async function connectSettings(over: Partial<UpSettings> = {}) {
  await setMeta('upBank', {
    token: 'up:yeah:test',
    accountMap: {},
    roundUpsAsSpend: true,
    ...over,
  } satisfies UpSettings)
}

const balance = async (accountId: string) => (await db.accountRollup.get(accountId))?.deltaMinor ?? 0

describe('Up Bank import', () => {
  beforeEach(async () => {
    await reset()
    vi.unstubAllGlobals()
  })

  it('imports charges as expenses with mapped account and category', async () => {
    const food = { id: 'cat-food', name: 'Food', kind: 'expense' as const, icon: '🍔', isDefault: true }
    await db.categories.add(food)
    const bank = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': bank.id } })
    stubUpApi([{ id: 'a', amountMinor: -1250, accountId: 'up-1', description: 'COFFEE SHOP', categoryId: 'restaurants-and-cafes' }])

    const r = await syncUpNow()
    expect(r).toEqual({ added: 1, updated: 0 })

    const rows = await db.transactions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'expense',
      amountMinor: 1250,
      accountId: bank.id,
      categoryId: 'cat-food',
      externalId: 'up:a',
      source: 'up',
      note: 'COFFEE SHOP',
    })
    expect(await balance(bank.id)).toBe(-1250)
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor).toBe(1250)
  })

  it('imports deposits as income', async () => {
    const bank = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': bank.id } })
    stubUpApi([{ id: 'pay', amountMinor: 250_00, accountId: 'up-1', description: 'EMPLOYER PTY LTD' }])

    await syncUpNow()
    const rows = await db.transactions.toArray()
    expect(rows[0]).toMatchObject({ type: 'income', amountMinor: 250_00, accountId: bank.id })
    expect((await db.monthlyStats.get(currentYm()))?.incomeMinor).toBe(250_00)
  })

  it('collapses internal transfers to a single transfer row', async () => {
    const spend = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    const saver = await addAccount({ name: 'Saver', type: 'savings', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': spend.id, 'up-2': saver.id } })
    stubUpApi([
      { id: 'out', amountMinor: -50_00, accountId: 'up-1', transferAccountId: 'up-2', description: 'Transfer to Saver' },
      { id: 'in', amountMinor: 50_00, accountId: 'up-2', transferAccountId: 'up-1', description: 'Transfer from Spending' },
    ])

    const r = await syncUpNow()
    expect(r).toEqual({ added: 1, updated: 0 })
    const rows = await db.transactions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'transfer',
      amountMinor: 50_00,
      fromAccountId: spend.id,
      toAccountId: saver.id,
    })
    expect(rows[0].countsAsSpend).toBeUndefined()
    expect(await balance(spend.id)).toBe(-50_00)
    expect(await balance(saver.id)).toBe(50_00)
    // A plain transfer never counts as spend.
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor ?? 0).toBe(0)
  })

  it('marks Up round-ups as spend-counting Spare Change when enabled', async () => {
    const spend = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    const saver = await addAccount({ name: 'Saver', type: 'savings', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': spend.id, 'up-2': saver.id }, roundUpsAsSpend: true })
    stubUpApi([{ id: 'ru', amountMinor: -73, accountId: 'up-1', transferAccountId: 'up-2', description: 'Round Up' }])

    await syncUpNow()
    const rows = await db.transactions.toArray()
    expect(rows[0]).toMatchObject({ type: 'transfer', amountMinor: 73, countsAsSpend: true })
    // Balances move like a transfer AND the cents count as monthly spend.
    expect(await balance(spend.id)).toBe(-73)
    expect(await balance(saver.id)).toBe(73)
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor).toBe(73)
  })

  it('leaves round-ups as plain transfers when the setting is off', async () => {
    const spend = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    const saver = await addAccount({ name: 'Saver', type: 'savings', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': spend.id, 'up-2': saver.id }, roundUpsAsSpend: false })
    stubUpApi([{ id: 'ru', amountMinor: -73, accountId: 'up-1', transferAccountId: 'up-2', description: 'Round Up' }])

    await syncUpNow()
    const rows = await db.transactions.toArray()
    expect(rows[0].countsAsSpend).toBeUndefined()
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor ?? 0).toBe(0)
  })

  it('re-sync updates a settled charge in place — no duplicates, rollups follow', async () => {
    const bank = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': bank.id } })

    stubUpApi([{ id: 'hold', amountMinor: -10_00, accountId: 'up-1', status: 'HELD', settledAt: null }])
    await syncUpNow()

    // The hold settles for a different amount (e.g. tip added).
    stubUpApi([{ id: 'hold', amountMinor: -12_00, accountId: 'up-1', status: 'SETTLED' }])
    const r = await syncUpNow()
    expect(r).toEqual({ added: 0, updated: 1 })

    const rows = await db.transactions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].amountMinor).toBe(12_00)
    expect(await balance(bank.id)).toBe(-12_00)
    expect((await db.monthlyStats.get(currentYm()))?.expenseMinor).toBe(12_00)
  })

  it('an unchanged re-sync is a no-op', async () => {
    const bank = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': bank.id } })
    stubUpApi([{ id: 'x', amountMinor: -5_00, accountId: 'up-1' }])

    await syncUpNow()
    const r = await syncUpNow()
    expect(r).toEqual({ added: 0, updated: 0 })
    expect(await db.transactions.count()).toBe(1)
  })

  it('skips transactions on unmapped Up accounts', async () => {
    const bank = await addAccount({ name: 'Spending', type: 'bank', openingBalanceMinor: 0 })
    await connectSettings({ accountMap: { 'up-1': bank.id } })
    stubUpApi([{ id: 'other', amountMinor: -9_99, accountId: 'up-unmapped' }])

    const r = await syncUpNow()
    expect(r).toEqual({ added: 0, updated: 0 })
    expect(await db.transactions.count()).toBe(0)
  })

  it('completeUpConnect creates accounts and anchors them to the live Up balance', async () => {
    stubUpApi(
      [{ id: 'a', amountMinor: -20_00, accountId: 'up-1', description: 'SHOP' }],
      [{ id: 'up-1', name: 'Up Spending', balanceMinor: 500_00 }],
    )

    const r = await completeUpConnect({
      token: 'up:yeah:test',
      choices: [
        {
          account: { id: 'up-1', displayName: 'Up Spending', accountType: 'TRANSACTIONAL', balanceMinor: 500_00 },
          target: 'create',
        },
      ],
      historyDays: 30,
      roundUpsAsSpend: true,
    })
    expect(r.added).toBe(1)

    const accounts = await db.accounts.toArray()
    expect(accounts).toHaveLength(1)
    // opening (520) + imported delta (−20) = live Up balance (500)
    expect(accounts[0].openingBalanceMinor).toBe(520_00)
    expect(accounts[0].openingBalanceMinor + (await balance(accounts[0].id))).toBe(500_00)
  })

  it('start-from-today (0 days) never pulls history, only charges made after connecting', async () => {
    const yesterday = `${toISODate(new Date(Date.now() - 86_400_000))}T10:00:00+10:00`
    const txns: StubTxn[] = [
      { id: 'old', amountMinor: -10_00, accountId: 'up-1', createdAt: yesterday, settledAt: yesterday },
    ]
    stubUpApi(txns, [{ id: 'up-1', name: 'Up Spending', balanceMinor: 100_00 }])

    const r = await completeUpConnect({
      token: 'up:yeah:test',
      choices: [
        {
          account: { id: 'up-1', displayName: 'Up Spending', accountType: 'TRANSACTIONAL', balanceMinor: 100_00 },
          target: 'create',
        },
      ],
      historyDays: 0,
      roundUpsAsSpend: true,
    })
    expect(r).toEqual({ added: 0, updated: 0 })
    expect(await db.transactions.count()).toBe(0)
    // The created account still lands on the live balance with no history.
    expect((await db.accounts.toArray())[0].openingBalanceMinor).toBe(100_00)

    // A later sync must not let the resync overlap reach back past connect.
    expect(await syncUpNow()).toEqual({ added: 0, updated: 0 })
    expect(await db.transactions.count()).toBe(0)

    // A charge made after connecting does come through.
    txns.push({ id: 'new', amountMinor: -5_00, accountId: 'up-1', createdAt: new Date(Date.now() + 1000).toISOString() })
    expect(await syncUpNow()).toEqual({ added: 1, updated: 0 })
    expect((await db.transactions.toArray())[0]).toMatchObject({ type: 'expense', amountMinor: 5_00, externalId: 'up:new' })
  })
})

describe('matchUpCategory', () => {
  const cats = [
    { id: 'c-food', name: 'Food', kind: 'expense' as const },
    { id: 'c-groc', name: 'Groceries', kind: 'expense' as const },
    { id: 'c-transport', name: 'Transport', kind: 'expense' as const },
    { id: 'c-salary', name: 'Salary', kind: 'income' as const },
  ]

  it('prefers a direct name match against the user’s categories', () => {
    expect(matchUpCategory('groceries', cats)).toBe('c-groc')
  })

  it('falls back to the default taxonomy for Up-specific ids', () => {
    expect(matchUpCategory('fuel', cats)).toBe('c-transport')
    expect(matchUpCategory('takeaway', cats)).toBe('c-food')
  })

  it('returns undefined for unknown ids and never matches income categories', () => {
    expect(matchUpCategory('life-admin', cats)).toBeUndefined()
    expect(matchUpCategory(null, cats)).toBeUndefined()
  })
})
