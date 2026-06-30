import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { acquireCredit, getCreditUsage, DailyLimitError, RateLimitError, PER_DAY } from './ratelimit'
import { db } from '@/db/db'
import { setMeta } from '@/db/meta'

const today = () => new Date().toISOString().slice(0, 10)

describe('twelve data rate limiter', () => {
  beforeEach(async () => {
    await db.meta.clear()
  })

  it('counts each acquired credit against today', async () => {
    await acquireCredit()
    await acquireCredit()
    await acquireCredit()
    const usage = await getCreditUsage()
    expect(usage.used).toBe(3)
    expect(usage.limit).toBe(PER_DAY)
  })

  it('refuses to exceed the daily cap (throws a RateLimitError)', async () => {
    await setMeta('tdCredits', { day: today(), used: PER_DAY })
    await expect(acquireCredit()).rejects.toBeInstanceOf(DailyLimitError)
    await expect(acquireCredit()).rejects.toBeInstanceOf(RateLimitError) // subclass
    // Usage must not have been pushed past the cap.
    expect((await getCreditUsage()).used).toBe(PER_DAY)
  })

  it('resets the count when the UTC day changes', async () => {
    await setMeta('tdCredits', { day: '2000-01-01', used: PER_DAY })
    const usage = await getCreditUsage()
    expect(usage.used).toBe(0)
  })
})
