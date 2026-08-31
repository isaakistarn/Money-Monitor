import type { Sale } from '@/types/models'

/**
 * Reporting maths for product sales — pure functions over rows, so the Sales
 * page stays a thin renderer and the totals can be unit-tested.
 *
 * Three figures matter throughout and always mean the same thing:
 *   · gross    — what buyers paid
 *   · referral — what was paid back out to referrers
 *   · net      — gross − referral, i.e. what you actually kept
 */

/** Referral payout on a sale, treated as 0 when none was recorded. */
export function referralMinorOf(s: Pick<Sale, 'referralAmountMinor'>): number {
  return s.referralAmountMinor ?? 0
}

/** What the sale actually kept: price less any referral payout. */
export function netMinorOf(s: Pick<Sale, 'amountMinor' | 'referralAmountMinor'>): number {
  return s.amountMinor - referralMinorOf(s)
}

/**
 * Whether a sale's money has been run through a pay split yet. The Sales page
 * uses this to drive a work queue, so "not yet" is the meaningful default for
 * every sale recorded before the tick-off feature existed.
 */
export function isSplit(s: Pick<Sale, 'splitAt'>): boolean {
  return !!s.splitAt
}

/**
 * Sales still awaiting a pay split, OLDEST FIRST — it's a queue to work
 * through, not a feed, so the longest-outstanding sale belongs at the top.
 * Deliberately not month-scoped: a sale from last month still needs splitting.
 */
export function awaitingSplit(rows: Sale[]): Sale[] {
  return rows
    .filter((s) => !isSplit(s))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

/** Most recently ticked off first, so an accidental tick is easy to find and undo. */
export function recentlySplit(rows: Sale[], limit: number): Sale[] {
  return rows
    .filter(isSplit)
    .sort((a, b) => (b.splitAt ?? '').localeCompare(a.splitAt ?? ''))
    .slice(0, limit)
}

export interface SalesTotals {
  count: number
  grossMinor: number
  referralMinor: number
  netMinor: number
  /** Mean sale price (gross ÷ count), 0 when there are no sales. */
  avgMinor: number
  /** How many of the sales came through a referrer. */
  referredCount: number
}

export function salesTotals(rows: Sale[]): SalesTotals {
  let grossMinor = 0
  let referralMinor = 0
  let referredCount = 0
  for (const s of rows) {
    grossMinor += s.amountMinor
    referralMinor += referralMinorOf(s)
    if (s.referral?.trim()) referredCount++
  }
  return {
    count: rows.length,
    grossMinor,
    referralMinor,
    netMinor: grossMinor - referralMinor,
    avgMinor: rows.length ? Math.round(grossMinor / rows.length) : 0,
    referredCount,
  }
}

export interface SalesPeriodPoint {
  /** The bucket key — a 'yyyy-mm' month or a 'yyyy-mm-dd' day. */
  key: string
  grossMinor: number
  referralMinor: number
  netMinor: number
  count: number
}

/**
 * Bucket sales into the given periods, in the order supplied. `keyOf` picks a
 * row's bucket ('yyyy-mm' for months, the full date for days). Periods with no
 * sales come back as explicit zeroes so a chart shows the gap rather than
 * silently closing it.
 */
export function salesByPeriod(rows: Sale[], periods: string[], keyOf: (s: Sale) => string): SalesPeriodPoint[] {
  const buckets = new Map<string, SalesPeriodPoint>(
    periods.map((key) => [key, { key, grossMinor: 0, referralMinor: 0, netMinor: 0, count: 0 }]),
  )
  for (const s of rows) {
    const b = buckets.get(keyOf(s))
    if (!b) continue // outside the requested window
    b.grossMinor += s.amountMinor
    b.referralMinor += referralMinorOf(s)
    b.netMinor = b.grossMinor - b.referralMinor
    b.count++
  }
  return periods.map((p) => buckets.get(p)!)
}

export interface SalesSlice {
  name: string
  amountMinor: number
  count: number
  /** Share of the slice total, 0–100. */
  pct: number
}

/**
 * Group rows by a text field into slices sorted biggest-first, with each
 * slice's share of the total. Blank keys fall back to `fallback`, so unnamed
 * buyers and direct (unreferred) sales still show up rather than vanishing.
 */
function groupBy(
  rows: Sale[],
  keyOf: (s: Sale) => string | undefined,
  amountOf: (s: Sale) => number,
  fallback: string,
): SalesSlice[] {
  const acc = new Map<string, { amountMinor: number; count: number }>()
  for (const s of rows) {
    const name = keyOf(s)?.trim() || fallback
    const cur = acc.get(name) ?? { amountMinor: 0, count: 0 }
    cur.amountMinor += amountOf(s)
    cur.count++
    acc.set(name, cur)
  }
  const total = [...acc.values()].reduce((n, v) => n + v.amountMinor, 0)
  return [...acc.entries()]
    .map(([name, v]) => ({ name, ...v, pct: total > 0 ? (v.amountMinor / total) * 100 : 0 }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name))
}

/** Revenue per buyer, biggest spender first. */
export function salesByBuyer(rows: Sale[]): SalesSlice[] {
  return groupBy(rows, (s) => s.buyer, (s) => s.amountMinor, 'Unnamed')
}

/**
 * Revenue per referral source, biggest first, with everything unreferred
 * collected into a single "Direct" slice — so the split always sums to 100%.
 */
export function salesByReferral(rows: Sale[]): SalesSlice[] {
  return groupBy(rows, (s) => s.referral, (s) => s.amountMinor, 'Direct')
}

/**
 * What each referrer was PAID (not the revenue they drove), biggest first.
 * Direct sales are excluded — they have no referrer to pay.
 */
export function referralPayouts(rows: Sale[]): SalesSlice[] {
  return groupBy(
    rows.filter((s) => s.referral?.trim()),
    (s) => s.referral,
    referralMinorOf,
    'Direct',
  )
}
