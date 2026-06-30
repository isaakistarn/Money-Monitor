import { db } from './db'
import { rebuildRollups } from './repo'
import { setMeta } from './meta'
import { now, markChanged } from './changes'
import { todayISO } from '@/lib/date'
import { SYNCED_TABLES, type Account, type Budget, type Category, type Holding, type PaySplit, type Recurring, type Transaction } from '@/types/models'

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
    meta: Array<{ key: string; value: unknown }>
  }
}

export async function buildBackup(): Promise<BackupFile> {
  const [accounts, categories, transactions, budgets, recurring, paySplits, holdings, meta] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.recurring.toArray(),
    db.paySplits.toArray(),
    db.holdings.toArray(),
    db.meta.toArray(),
  ])
  return {
    app: 'finance-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { accounts, categories, transactions, budgets, recurring, paySplits, holdings, meta },
  }
}

function isBackup(x: unknown): x is BackupFile {
  const f = x as BackupFile
  return !!f && f.app === 'finance-tracker' && !!f.data && Array.isArray(f.data.transactions)
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
export async function importBackup(text: string): Promise<{ transactions: number }> {
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
  // Stamp every imported row as authoritative (now), so that if sync is enabled
  // the restore wins last-write-wins, and queue them all for the next push.
  const ts = now()
  const stamp = <T extends { updatedAt?: number }>(rows: T[]) => rows.map((r) => ({ ...r, updatedAt: ts }))
  const accounts = stamp(data.accounts)
  const categories = stamp(data.categories)
  const transactions = stamp(data.transactions)
  const budgets = stamp(data.budgets ?? [])
  const recurring = stamp(data.recurring ?? [])
  const paySplits = stamp(data.paySplits ?? [])
  const holdings = stamp(data.holdings ?? [])

  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.recurring, db.paySplits, db.holdings, db.meta,
     db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox],
    async () => {
      await Promise.all([
        db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
        db.budgets.clear(), db.recurring.clear(), db.paySplits.clear(), db.holdings.clear(), db.meta.clear(), db.outbox.clear(),
      ])
      await db.accounts.bulkAdd(accounts)
      await db.categories.bulkAdd(categories)
      await db.transactions.bulkAdd(transactions)
      await db.budgets.bulkAdd(budgets)
      await db.recurring.bulkAdd(recurring)
      await db.paySplits.bulkAdd(paySplits)
      await db.holdings.bulkAdd(holdings)
      await db.meta.bulkPut(data.meta ?? [])
      const tables = { accounts, categories, transactions, budgets, recurring, paySplits, holdings }
      for (const name of SYNCED_TABLES) {
        for (const row of tables[name]) await markChanged(name, row.id, ts)
      }
    },
  )
  await rebuildRollups()
  return { transactions: data.transactions.length }
}

/** Wipe everything and reset to a clean, default install. */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.recurring, db.paySplits, db.holdings, db.meta,
     db.accountRollup, db.monthlyStats, db.categoryMonthly, db.outbox],
    async () => {
      await Promise.all([
        db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
        db.budgets.clear(), db.recurring.clear(), db.paySplits.clear(), db.holdings.clear(), db.meta.clear(),
        db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
        db.outbox.clear(),
      ])
    },
  )
}
