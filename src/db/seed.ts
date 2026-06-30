import { db } from './db'
import { addAccount, addTransaction, upsertBudget, rebuildRollups } from './repo'
import { detectCurrency } from '@/lib/money'
import { todayISO, currentYm, addDaysISO } from '@/lib/date'
import { setMeta, getMeta } from './meta'
import { markChanged } from './changes'
import type { Category } from '@/types/models'

export const DEFAULT_EXPENSE_CATEGORIES: Array<[string, string]> = [
  ['Food', '🍔'],
  ['Transport', '🚗'],
  ['Entertainment', '🎬'],
  ['Shopping', '🛍️'],
  ['Housing', '🏠'],
  ['Utilities', '💡'],
  ['Healthcare', '🩺'],
  ['Education', '📚'],
  ['Subscriptions', '🔁'],
  ['Travel', '✈️'],
  ['Miscellaneous', '📦'],
]

export const DEFAULT_INCOME_CATEGORIES: Array<[string, string]> = [
  ['Salary', '💼'],
  ['Business', '🏢'],
  ['Investments', '📈'],
  ['Gifts', '🎁'],
  ['Other', '➕'],
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

/**
 * Default/seed rows are stamped with the smallest possible timestamp so that
 * ANY real user edit (which carries a real `Date.now()`) always wins the
 * last-write-wins comparison during sync. Without this, a freshly-seeded second
 * device could clobber a category you renamed earlier on another device.
 */
export const SEED_TS = 1

/**
 * Default category ids are DETERMINISTIC (e.g. `cat-expense-food`) rather than
 * random. This is what lets two devices sync without duplicating the starter
 * categories: both generate identical ids, so the upsert collapses them to one.
 */
export function defaultCategories(ts = SEED_TS): Category[] {
  return [
    ...DEFAULT_EXPENSE_CATEGORIES.map(([name, icon]) => ({
      id: `cat-expense-${slug(name)}`, name, icon, kind: 'expense' as const, isDefault: true, updatedAt: ts,
    })),
    ...DEFAULT_INCOME_CATEGORIES.map(([name, icon]) => ({
      id: `cat-income-${slug(name)}`, name, icon, kind: 'income' as const, isDefault: true, updatedAt: ts,
    })),
  ]
}

/** Ensure default categories & currency exist. Safe to call on every launch. */
export async function ensureBaseData(): Promise<void> {
  const catCount = await db.categories.count()
  if (catCount === 0) {
    const cats = defaultCategories(SEED_TS)
    // bulkPut (not bulkAdd) so this is idempotent: deterministic ids mean a
    // concurrent/repeat call (e.g. React StrictMode double-invoking effects in
    // dev) just overwrites identical rows instead of throwing a key conflict.
    await db.transaction('rw', db.categories, db.outbox, async () => {
      await db.categories.bulkPut(cats)
      for (const c of cats) await markChanged('categories', c.id, SEED_TS)
    })
  }
  if ((await getMeta('currency', null)) == null) {
    await setMeta('currency', detectCurrency())
  }
}

/** One-time demo dataset so the app is never an empty shell on first run. */
export async function seedSampleData(): Promise<void> {
  await ensureBaseData()
  const cats = await db.categories.toArray()
  const cat = (name: string) => cats.find((c) => c.name === name)!.id

  const bank = await addAccount({ name: 'Everyday', type: 'bank', openingBalanceMinor: 240000 })
  const savings = await addAccount({ name: 'Savings', type: 'savings', openingBalanceMinor: 850000 })
  const cash = await addAccount({ name: 'Cash', type: 'cash', openingBalanceMinor: 6000 })
  const card = await addAccount({ name: 'Credit Card', type: 'credit_card', openingBalanceMinor: 43000 })

  const ym = currentYm()
  const d = (offset: number) => addDaysISO(todayISO(), -offset)

  const sample: Array<Parameters<typeof addTransaction>[0]> = [
    { type: 'income', amountMinor: 310000, categoryId: cat('Salary'), accountId: bank.id, date: d(20), note: 'Monthly salary' },
    { type: 'income', amountMinor: 12000, categoryId: cat('Investments'), accountId: savings.id, date: d(14), note: 'Dividend' },
    { type: 'expense', amountMinor: 4200, categoryId: cat('Food'), accountId: bank.id, date: d(1), note: 'Groceries' },
    { type: 'expense', amountMinor: 1850, categoryId: cat('Food'), accountId: card.id, date: d(2), note: 'Lunch' },
    { type: 'expense', amountMinor: 9000, categoryId: cat('Housing'), accountId: bank.id, date: d(3), note: 'Rent share' },
    { type: 'expense', amountMinor: 3200, categoryId: cat('Transport'), accountId: card.id, date: d(4), note: 'Fuel' },
    { type: 'expense', amountMinor: 1299, categoryId: cat('Subscriptions'), accountId: card.id, date: d(5), note: 'Streaming' },
    { type: 'expense', amountMinor: 5400, categoryId: cat('Shopping'), accountId: card.id, date: d(6), note: 'New shoes' },
    { type: 'expense', amountMinor: 2600, categoryId: cat('Entertainment'), accountId: bank.id, date: d(7), note: 'Cinema' },
    { type: 'expense', amountMinor: 4100, categoryId: cat('Utilities'), accountId: bank.id, date: d(9), note: 'Electricity' },
    { type: 'expense', amountMinor: 1500, categoryId: cat('Healthcare'), accountId: cash.id, date: d(11), note: 'Pharmacy' },
    { type: 'transfer', amountMinor: 50000, fromAccountId: bank.id, toAccountId: savings.id, date: d(8), note: 'Monthly saving' },
    { type: 'transfer', amountMinor: 20000, fromAccountId: bank.id, toAccountId: card.id, date: d(10), note: 'Card payment' },
  ]
  for (const t of sample) await addTransaction(t)

  await upsertBudget(cat('Food'), ym, 30000)
  await upsertBudget(cat('Transport'), ym, 12000)
  await upsertBudget(cat('Shopping'), ym, 10000)
  await upsertBudget(cat('Entertainment'), ym, 8000)
  await upsertBudget(cat('Subscriptions'), ym, 3000)

  await rebuildRollups()
  await setMeta('seeded', true)
}

/** First-launch bootstrap. Returns true if this was a brand-new install. */
export async function bootstrap(): Promise<boolean> {
  await ensureBaseData()
  const onboarded = await getMeta('onboarded', false)
  return !onboarded
}
