import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase backed by an in-memory `records` table. It mimics just the
// query surface the engine uses: from().select().gt().order().range() and
// from().upsert(). The server stamps `updated_at` on every write, exactly like
// the real trigger, so the pull cursor advances on one consistent clock.
const server = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = []
  let counter = 0
  const stamp = () => new Date(1_700_000_000_000 + ++counter * 1000).toISOString()
  const client = {
    from() {
      let filtered: Array<Record<string, unknown>> = []
      const b = {
        select() { filtered = rows.slice(); return b },
        gt(col: string, val: string) { filtered = filtered.filter((r) => (r[col] as string) > val); return b },
        order(col: string, opt: { ascending?: boolean }) {
          const asc = opt?.ascending !== false
          filtered.sort((a, c) => {
            const x = a[col] as string, y = c[col] as string
            return x < y ? (asc ? -1 : 1) : x > y ? (asc ? 1 : -1) : 0
          })
          return b
        },
        range(from: number, to: number) {
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null })
        },
        upsert(recs: Array<Record<string, unknown>>) {
          for (const rec of recs) {
            const i = rows.findIndex(
              (r) => r.user_id === rec.user_id && r.tbl === rec.tbl && r.row_id === rec.row_id,
            )
            const stored = { ...rec, updated_at: stamp() }
            if (i >= 0) rows[i] = stored
            else rows.push(stored)
          }
          return Promise.resolve({ error: null })
        },
      }
      return b
    },
  }
  return { rows, client }
})

vi.mock('@/lib/supabase', () => ({ supabase: server.client, isSupabaseConfigured: true }))

import { db } from './db'
import { addAccount, addTransaction, deleteTransaction } from './repo'
import { syncNow } from './sync'
import { clearAllData } from './backup'

const USER = 'user-1'

async function reset() {
  server.rows.length = 0
  await Promise.all([
    db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
    db.budgets.clear(), db.recurring.clear(), db.meta.clear(),
    db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
    db.outbox.clear(),
  ])
}

async function balance(accountId: string, openingMinor: number) {
  const r = await db.accountRollup.get(accountId)
  return openingMinor + (r?.deltaMinor ?? 0)
}

describe('supabase sync engine', () => {
  beforeEach(reset)

  it('round-trips local data to the server and back onto a fresh device', async () => {
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100_00 })
    await addTransaction({ type: 'income', amountMinor: 50_00, accountId: bank.id, date: '2026-06-01' })

    expect(await db.outbox.count()).toBe(2) // account + transaction queued

    const r1 = await syncNow(USER)
    expect(r1.pushed).toBe(2)
    expect(await db.outbox.count()).toBe(0) // drained after a successful push

    // Simulate a second device: wipe everything local, then sync from scratch.
    await clearAllData()
    expect(await db.accounts.count()).toBe(0)

    const r2 = await syncNow(USER)
    expect(r2.pulled).toBeGreaterThanOrEqual(2)
    expect(await db.accounts.get(bank.id)).toBeTruthy()
    expect(await db.transactions.count()).toBe(1)
    // Derived balance is rebuilt locally after the pull: 100 + 50.
    expect(await balance(bank.id, 100_00)).toBe(150_00)
  })

  it('propagates deletes as tombstones (no resurrection on another device)', async () => {
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 })
    const tx = await addTransaction({ type: 'income', amountMinor: 25_00, accountId: bank.id, date: '2026-06-02' })
    await syncNow(USER)

    await deleteTransaction(tx.id)
    await syncNow(USER)

    // Fresh device pulls the whole history including the tombstone.
    await clearAllData()
    await syncNow(USER)

    expect(await db.accounts.get(bank.id)).toBeTruthy() // account still there
    expect(await db.transactions.get(tx.id)).toBeUndefined() // deleted, not resurrected
    expect(await db.transactions.count()).toBe(0)
  })

  it('keeps a newer local edit over an older remote (last-write-wins)', async () => {
    const bank = await addAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 })
    await syncNow(USER) // server now has "Bank"

    // Local rename with a far-future timestamp, not yet pushed.
    await db.accounts.update(bank.id, { name: 'Renamed', updatedAt: 9_999_999_999_999 })
    await db.meta.delete(`sync.cursor.${USER}`) // force a full re-pull

    await syncNow(USER)
    // The pull must NOT clobber the newer local name with the older server one.
    expect((await db.accounts.get(bank.id))?.name).toBe('Renamed')
  })
})
