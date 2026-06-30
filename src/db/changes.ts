import { db } from './db'
import type { SyncedTable } from '@/types/models'

/**
 * Records local mutations into the `outbox` (a dirty-set) so the sync engine
 * knows exactly which rows to push, without diffing clocks. Call these INSIDE
 * the same Dexie `rw` transaction as the data change (with `db.outbox` in the
 * transaction's table scope) so a row and its outbox entry commit atomically.
 *
 * Keyed by `table:rowId`, so repeated edits to one row collapse to a single
 * pending entry carrying the latest timestamp.
 */

export const now = () => Date.now()

export function markChanged(table: SyncedTable, rowId: string, ts: number): Promise<string> {
  return db.outbox.put({ id: `${table}:${rowId}`, table, rowId, deleted: false, ts })
}

export function markDeleted(table: SyncedTable, rowId: string, ts: number): Promise<string> {
  return db.outbox.put({ id: `${table}:${rowId}`, table, rowId, deleted: true, ts })
}
