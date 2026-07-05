import type { Table } from 'dexie'
import { db } from './db'
import { rebuildRollups } from './repo'
import { getMeta, setMeta } from './meta'
import { supabase } from '@/lib/supabase'
import { SYNCED_TABLES, type SyncedTable } from '@/types/models'

/** Minimal shape every synced row shares, for table-agnostic reads/writes. */
type Row = { id: string; updatedAt?: number }

/**
 * Cross-device sync over a single Supabase table (`records`), one row per
 * entity: { user_id, tbl, row_id, data jsonb, deleted, updated_at }.
 *
 * Model: last-write-wins by each row's `updatedAt` (epoch ms, set on the device
 * that made the change). The golden rule is **pull before push**: a device
 * always reconciles with the server first, so even though the server upsert is
 * unconditional ("last push wins"), it only ever pushes already-reconciled
 * rows — which yields correct last-write-wins as long as two devices don't sync
 * in the exact same instant. Good enough for a single user's phone + laptop.
 *
 * Pushes are driven by the `outbox` dirty-set (see changes.ts), never by
 * diffing clocks — so rows we just pulled are never echoed back in a loop.
 */

const EPOCH = '1970-01-01T00:00:00Z'
const PAGE = 1000

const TABLE_OF = {
  accounts: db.accounts,
  categories: db.categories,
  transactions: db.transactions,
  budgets: db.budgets,
  recurring: db.recurring,
  paySplits: db.paySplits,
  holdings: db.holdings,
  watchlist: db.watchlist,
} as unknown as Record<SyncedTable, Table<Row, string>>

// Membership check via a Set (never a bare object lookup, which would walk the
// prototype chain — e.g. tbl: "toString" would come back truthy and crash sync).
const VALID_TABLES = new Set<string>(SYNCED_TABLES)

/**
 * A pulled record is applied only if it targets a known table AND its payload's
 * `id` matches the server `row_id`. Without the id check a poisoned record
 * could smuggle a mismatched payload into a legitimate row slot and overwrite
 * an arbitrary local row. Malformed records are skipped, never applied.
 */
function isApplicable(rec: RemoteRecord): boolean {
  if (!VALID_TABLES.has(rec.tbl)) return false
  if (rec.deleted) return true // tombstones carry no payload
  return !!rec.data && typeof rec.data === 'object' && rec.data.id === rec.row_id
}

interface RemoteRecord {
  tbl: SyncedTable
  row_id: string
  data: Record<string, unknown> | null
  deleted: boolean
  updated_at: string
}

export interface SyncResult {
  pulled: number
  pushed: number
  cursor: string
}

const cursorKey = (userId: string) => `sync.cursor.${userId}`

/** Pull remote changes since our cursor and merge them (last-write-wins). */
async function pull(userId: string): Promise<number> {
  if (!supabase) return 0
  const cursor = await getMeta<string>(cursorKey(userId), EPOCH)
  let from = 0
  let newCursor = cursor
  let applied = 0

  for (;;) {
    const { data, error } = await supabase
      .from('records')
      .select('tbl,row_id,data,deleted,updated_at')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as RemoteRecord[]
    if (rows.length === 0) break

    await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.budgets, db.recurring, db.paySplits, db.holdings, db.watchlist], async () => {
      for (const rec of rows) {
        if (!isApplicable(rec)) continue
        const table = TABLE_OF[rec.tbl]
        const remoteTs = Number((rec.data as { updatedAt?: number })?.updatedAt ?? 0)
        const local = (await table.get(rec.row_id)) as { updatedAt?: number } | undefined
        const localTs = local?.updatedAt ?? 0
        // Our own unpushed newer edit must not be overwritten by an older remote.
        if (local && localTs > remoteTs) continue
        if (rec.deleted) {
          if (local) await table.delete(rec.row_id)
        } else if (rec.data) {
          await table.put(rec.data as never)
        }
        applied++
      }
    })

    newCursor = rows[rows.length - 1].updated_at
    if (rows.length < PAGE) break
    from += PAGE
  }

  if (applied > 0) await rebuildRollups()
  if (newCursor !== cursor) await setMeta(cursorKey(userId), newCursor)
  return applied
}

/** Push everything in the outbox to the server, then clear what we sent. */
async function push(userId: string): Promise<number> {
  if (!supabase) return 0
  const pending = await db.outbox.toArray()
  if (pending.length === 0) return 0

  const records = await Promise.all(
    pending.map(async (entry) => {
      let data: Record<string, unknown> = { id: entry.rowId, updatedAt: entry.ts }
      let deleted = entry.deleted
      if (!deleted) {
        const row = await TABLE_OF[entry.table].get(entry.rowId)
        if (row) data = row as unknown as Record<string, unknown>
        else deleted = true // row vanished after enqueue — push as a tombstone
      }
      return { user_id: userId, tbl: entry.table, row_id: entry.rowId, data, deleted }
    }),
  )

  // Upsert in chunks. The server trigger stamps `updated_at`.
  for (let i = 0; i < records.length; i += PAGE) {
    const { error } = await supabase
      .from('records')
      .upsert(records.slice(i, i + PAGE), { onConflict: 'user_id,tbl,row_id' })
    if (error) throw new Error(error.message)
  }

  // Remove only the entries we actually sent AND that haven't changed since.
  await db.transaction('rw', db.outbox, async () => {
    for (const entry of pending) {
      const current = await db.outbox.get(entry.id)
      if (current && current.ts === entry.ts) await db.outbox.delete(entry.id)
    }
  })
  return pending.length
}

/** Full sync cycle: pull (reconcile), then push (publish). */
export async function syncNow(userId: string): Promise<SyncResult> {
  if (!supabase) throw new Error('Sync is not configured in this build.')
  const pulled = await pull(userId)
  const pushed = await push(userId)
  const cursor = await getMeta<string>(cursorKey(userId), EPOCH)
  await setMeta('sync.lastSyncAt', new Date().toISOString())
  return { pulled, pushed, cursor }
}

/** Number of local changes waiting to be pushed. */
export function pendingCount(): Promise<number> {
  return db.outbox.count()
}
