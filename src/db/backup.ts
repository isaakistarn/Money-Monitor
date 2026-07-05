import { db } from './db'
import { rebuildRollups } from './repo'
import { setMeta } from './meta'
import { now, markChanged } from './changes'
import { todayISO } from '@/lib/date'
import { SYNCED_TABLES, type Account, type Budget, type Category, type Holding, type PaySplit, type Recurring, type Transaction, type WatchItem } from '@/types/models'

export interface BackupFile {
  app: 'finance-tracker'
  version: 1
  exportedAt: string
  data: {
    accounts: Account[]
    categories: Category[]
    transactions: Transaction[]
    budgets: Budget[]
    recurring: Recurring[]
    paySplits?: PaySplit[]
    holdings?: Holding[]
    watchlist?: WatchItem[]
    meta: Array<{ key: string; value: unknown }>
  }
}

export async function buildBackup(): Promise<BackupFile> {
  const [accounts, categories, transactions, budgets, recurring, paySplits, holdings, watchlist, meta] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.recurring.toArray(),
    db.paySplits.toArray(),
    db.holdings.toArray(),
    db.watchlist.toArray(),
    db.meta.toArray(),
  ])
  return {
    app: 'finance-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { accounts, categories, transactions, budgets, recurring, paySplits, holdings, watchlist, meta },
  }
}

function isBackup(x: unknown): x is BackupFile {
  const f = x as BackupFile
  return !!f && f.app === 'finance-tracker' && !!f.data && Array.isArray(f.data.transactions)
}

/**
 * Numeric fields that MUST be finite numbers for a row to be usable. A doctored
 * or corrupted backup with string/NaN amounts would otherwise poison balances
 * and rollups (NaN spreads through every total it touches).
 */
const REQUIRED_NUMBERS: Partial<Record<string, string[]>> = {
  accounts: ['openingBalanceMinor'],
  transactions: ['amountMinor'],
  budgets: ['amountMinor'],
  recurring: ['amountMinor'],
  holdings: ['quantity', 'unitPriceMinor'],
}

/**
 * Keep only rows that are plain objects with a non-empty string `id` (unique
 * within the table) and finite required numeric fields. Everything else is
 * dropped and counted, never imported — a backup file is untrusted input.
 */
function sanitizeRows<T extends { id: string }>(rows: unknown, table: string): { rows: T[]; dropped: number } {
  if (!Array.isArray(rows)) return { rows: [], dropped: 0 }
  const seen = new Set<string>()
  const out: T[] = []
  let dropped = 0
  const numeric = REQUIRED_NUMBERS[table] ?? []
  for (const r of rows) {
    const row = r as Record<string, unknown>
    const ok =
      !!row && typeof row === 'object' && !Array.isArray(row) &&
      typeof row.id === 'string' && row.id.length > 0 && !seen.has(row.id) &&
      numeric.every((k) => Number.isFinite(row[k]))
    if (!ok) { dropped++; continue }
    seen.add(row.id as string)
    out.push(row as T)
  }
  return { rows: out, dropped }
}

/** Export to a JSON file. Uses the File System Access API when available, else a download. */
export async function exportBackup(): Promise<void> {
  const backup = await buildBackup()
  const json = JSON.stringify(backup, null, 2)
  const filename = `money-monitor-backup-${todayISO()}.json`

  const anyWindow = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
    }>
  }
  if (anyWindow.showSaveFilePicker) {
    try {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      await markBackedUp()
      return
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
      // fall through to download
    }
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  await markBackedUp()
}

export async function markBackedUp(): Promise<void> {
  await setMeta('lastBackup', new Date().toISOString())
}

/** Replace all data with the contents of a backup file, then rebuild rollups. */
export async function importBackup(text: string): Promise<{ transactions: number; dropped: number }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!isBackup(parsed)) {
    throw new Error('This does not look like a Money Monitor backup.')
  }
  const { data } = parsed
  // Validate first (untrusted input), then stamp every surviving row as
  // authoritative (now), so that if sync is enabled the restore wins
  // last-write-wins, and queue them all for the next push.
  const ts = now()
  const stamp = <T extends { updatedAt?: number }>(rows: T[]) => rows.map((r) => ({ ...r, updatedAt: ts }))
  let dropped = 0
  const clean = <T extends { id: string }>(rows: unknown, table: string): T[] => {
    const s = sanitizeRows<T>(rows, table)
    dropped += s.dropped
    return s.rows
  }
  const accounts = stamp(clean<Account>(data.accounts, 'accounts'))
  const categories = stamp(clean<Category>(data.categories, 'categories'))
  const transactions = stamp(clean<Transaction>(data.transactions, 'transactions'))
  const budgets = stamp(clean<Budget>(data.budgets, 'budgets'))
  const recurring = stamp(clean<Recurring>(data.recurring, 'recurring'))
  const paySplits = stamp(clean<PaySplit>(data.paySplits, 'paySplits'))
  const holdings = stamp(clean<Holding>(data.holdings, 'holdings'))
  const watchlist = stamp(clean<WatchItem>(data.watchlist, 'watchlist'))

  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.recurring, db.paySplits, db.holdings, db.watchlist, db.meta,
     db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox],
    async () => {
      await Promise.all([
        db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
        db.budgets.clear(), db.recurring.clear(), db.paySplits.clear(), db.holdings.clear(), db.watchlist.clear(), db.meta.clear(), db.outbox.clear(),
      ])
      await db.accounts.bulkAdd(accounts)
      await db.categories.bulkAdd(categories)
      await db.transactions.bulkAdd(transactions)
      await db.budgets.bulkAdd(budgets)
      await db.recurring.bulkAdd(recurring)
      await db.paySplits.bulkAdd(paySplits)
      await db.holdings.bulkAdd(holdings)
      await db.watchlist.bulkAdd(watchlist)
      await db.meta.bulkPut((Array.isArray(data.meta) ? data.meta : []).filter(
        (m) => !!m && typeof m === 'object' && typeof m.key === 'string' && m.key.length > 0,
      ))
      const tables = { accounts, categories, transactions, budgets, recurring, paySplits, holdings, watchlist }
      for (const name of SYNCED_TABLES) {
        for (const row of tables[name]) await markChanged(name, row.id, ts)
      }
    },
  )
  await rebuildRollups()
  return { transactions: transactions.length, dropped }
}

/** Wipe everything and reset to a clean, default install. */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.recurring, db.paySplits, db.holdings, db.watchlist, db.meta,
     db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox],
    async () => {
      await Promise.all([
        db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
        db.budgets.clear(), db.recurring.clear(), db.paySplits.clear(), db.holdings.clear(), db.watchlist.clear(), db.meta.clear(),
        db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
        db.outbox.clear(),
      ])
    },
  )
}
