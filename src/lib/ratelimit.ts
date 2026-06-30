import { getMeta, setMeta } from '@/db/meta'

/**
 * Client-side rate limiter for Twelve Data so the app can never exceed the free
 * plan: 8 requests/minute and 800 credits/day. Each REST call costs 1 credit.
 *
 * - Minute limit: a sliding 60s window. The first 8 calls go through instantly;
 *   further calls wait just long enough for a slot to free up.
 * - Daily limit: a persistent counter bucketed by UTC day (Twelve Data resets at
 *   UTC midnight). When it's exhausted, acquireCredit throws DailyLimitError and
 *   the refresh stops cleanly instead of hitting the server's hard limit.
 *
 * This is the app's own conservative guard; the server's 429 response is still
 * honoured as a backstop in quotes.ts.
 */

export const PER_MINUTE = 8
export const PER_DAY = 800

export class RateLimitError extends Error {}
export class DailyLimitError extends RateLimitError {}

interface CreditState {
  day: string
  used: number
}

// In-memory timestamps of recent requests (this session), for the minute window.
let windowTimes: number[] = []

const utcDay = () => new Date().toISOString().slice(0, 10)

async function readState(): Promise<CreditState> {
  const day = utcDay()
  const stored = await getMeta<CreditState>('tdCredits', { day, used: 0 })
  return stored.day === day ? stored : { day, used: 0 }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Reserve one credit, waiting for the minute window if needed. Throws when the
 *  daily cap is reached. Call once immediately before each Twelve Data request. */
export async function acquireCredit(): Promise<void> {
  const state = await readState()
  if (state.used >= PER_DAY) {
    throw new DailyLimitError(`Daily limit reached (${PER_DAY} credits). It resets at midnight UTC.`)
  }

  let now = Date.now()
  windowTimes = windowTimes.filter((t) => now - t < 60_000)
  if (windowTimes.length >= PER_MINUTE) {
    const waitMs = 60_000 - (now - windowTimes[0]) + 50
    await sleep(waitMs)
    now = Date.now()
    windowTimes = windowTimes.filter((t) => now - t < 60_000)
  }
  windowTimes.push(now)

  await setMeta('tdCredits', { day: state.day, used: state.used + 1 })
}

/** Today's credit usage (resets per UTC day). */
export async function getCreditUsage(): Promise<{ used: number; limit: number }> {
  const state = await readState()
  return { used: state.used, limit: PER_DAY }
}
