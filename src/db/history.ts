import { db } from './db'
import { todayISO } from '@/lib/date'

/**
 * Record today's total portfolio value + cost basis. Keyed by date, so calling
 * it repeatedly through the day just overwrites today's point with the latest
 * value. This builds a device-local daily series for the value-over-time chart
 * (it is derived history and intentionally not synced).
 */
export async function recordPortfolioSnapshot(valueMinor: number, costMinor: number): Promise<void> {
  await db.portfolioSnapshots.put({ date: todayISO(), valueMinor, costMinor })
}
