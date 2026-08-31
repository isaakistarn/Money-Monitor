import { describe, expect, it } from 'vitest'
import {
  isSplit,
  awaitingSplit,
  recentlySplit,
  netMinorOf,
  referralMinorOf,
  salesTotals,
  salesByPeriod,
  salesByBuyer,
  salesByReferral,
  referralPayouts,
} from './sales'
import type { Sale } from '@/types/models'

/** Minimal sale row; every test overrides only what it cares about. */
function sale(p: Partial<Sale> & { amountMinor: number }): Sale {
  const date = p.date ?? '2026-08-10'
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    buyer: p.buyer ?? 'Buyer',
    date,
    ym: p.ym ?? date.slice(0, 7),
    createdAt: p.createdAt ?? '2026-08-10T00:00:00.000Z',
    ...p,
  }
}

describe('per-sale maths', () => {
  it('treats a missing referral payout as zero', () => {
    expect(referralMinorOf({ referralAmountMinor: undefined })).toBe(0)
    expect(netMinorOf(sale({ amountMinor: 5000 }))).toBe(5000)
  })

  it('nets the referral payout off the sale price', () => {
    expect(netMinorOf(sale({ amountMinor: 5000, referral: 'Sam', referralAmountMinor: 750 }))).toBe(4250)
  })
})

describe('salesTotals', () => {
  it('sums gross, referrals and net, and counts referred sales', () => {
    const t = salesTotals([
      sale({ amountMinor: 10_000, referral: 'Sam', referralAmountMinor: 1_000 }),
      sale({ amountMinor: 5_000 }),
      sale({ amountMinor: 5_000, referral: 'Alex', referralAmountMinor: 500 }),
    ])
    expect(t.count).toBe(3)
    expect(t.grossMinor).toBe(20_000)
    expect(t.referralMinor).toBe(1_500)
    expect(t.netMinor).toBe(18_500)
    expect(t.avgMinor).toBe(6_667) // rounded mean of 20000/3
    expect(t.referredCount).toBe(2)
  })

  it('is all zeroes with no sales, without dividing by zero', () => {
    const t = salesTotals([])
    expect(t).toMatchObject({ count: 0, grossMinor: 0, referralMinor: 0, netMinor: 0, avgMinor: 0 })
  })

  it('ignores a blank referral name when counting referred sales', () => {
    expect(salesTotals([sale({ amountMinor: 100, referral: '   ' })]).referredCount).toBe(0)
  })
})

describe('salesByPeriod', () => {
  const rows = [
    sale({ amountMinor: 10_000, date: '2026-07-04', referral: 'Sam', referralAmountMinor: 1_000 }),
    sale({ amountMinor: 4_000, date: '2026-08-01' }),
    sale({ amountMinor: 6_000, date: '2026-08-20' }),
  ]

  it('buckets by month and keeps empty months as explicit zeroes', () => {
    const out = salesByPeriod(rows, ['2026-06', '2026-07', '2026-08'], (s) => s.ym)
    expect(out.map((p) => p.key)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(out[0]).toMatchObject({ grossMinor: 0, netMinor: 0, count: 0 })
    expect(out[1]).toMatchObject({ grossMinor: 10_000, referralMinor: 1_000, netMinor: 9_000, count: 1 })
    expect(out[2]).toMatchObject({ grossMinor: 10_000, referralMinor: 0, netMinor: 10_000, count: 2 })
  })

  it('drops rows outside the requested window', () => {
    const out = salesByPeriod(rows, ['2026-08'], (s) => s.ym)
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(2)
  })

  it('buckets by day too', () => {
    const out = salesByPeriod(rows, ['2026-08-01', '2026-08-02'], (s) => s.date)
    expect(out.map((p) => p.grossMinor)).toEqual([4_000, 0])
  })
})

describe('breakdowns', () => {
  const rows = [
    sale({ amountMinor: 10_000, buyer: 'Ada', referral: 'Sam', referralAmountMinor: 1_000 }),
    sale({ amountMinor: 6_000, buyer: 'Ada' }),
    sale({ amountMinor: 4_000, buyer: 'Bo', referral: 'Sam', referralAmountMinor: 400 }),
  ]

  it('groups revenue per buyer, biggest first, with shares summing to 100', () => {
    const out = salesByBuyer(rows)
    expect(out.map((s) => [s.name, s.amountMinor, s.count])).toEqual([
      ['Ada', 16_000, 2],
      ['Bo', 4_000, 1],
    ])
    expect(out.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100)
  })

  it('collects unreferred sales into a single Direct slice', () => {
    const out = salesByReferral(rows)
    expect(out.map((s) => [s.name, s.amountMinor])).toEqual([
      ['Sam', 14_000],
      ['Direct', 6_000],
    ])
  })

  it('reports what each referrer was paid, excluding direct sales', () => {
    const out = referralPayouts(rows)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'Sam', amountMinor: 1_400, count: 2, pct: 100 })
  })

  it('falls back to a label rather than dropping a blank buyer', () => {
    expect(salesByBuyer([sale({ amountMinor: 100, buyer: '  ' })])[0].name).toBe('Unnamed')
  })
})

describe('pay-split queue', () => {
  const rows = [
    sale({ id: 'c', amountMinor: 300, date: '2026-08-20' }),
    sale({ id: 'a', amountMinor: 100, date: '2026-08-01', splitAt: '2026-08-05T10:00:00.000Z' }),
    sale({ id: 'b', amountMinor: 200, date: '2026-08-10' }),
    sale({ id: 'd', amountMinor: 400, date: '2026-08-02', splitAt: '2026-08-30T10:00:00.000Z' }),
  ]

  it('treats a sale with no splitAt as still awaiting', () => {
    expect(isSplit(sale({ amountMinor: 1 }))).toBe(false)
    expect(isSplit(sale({ amountMinor: 1, splitAt: '2026-08-05T10:00:00.000Z' }))).toBe(true)
  })

  it('queues only unsplit sales, oldest first', () => {
    expect(awaitingSplit(rows).map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('breaks a same-day tie by entry order, so the queue is stable', () => {
    const sameDay = [
      sale({ id: 'second', amountMinor: 1, date: '2026-08-01', createdAt: '2026-08-01T12:00:00.000Z' }),
      sale({ id: 'first', amountMinor: 1, date: '2026-08-01', createdAt: '2026-08-01T09:00:00.000Z' }),
    ]
    expect(awaitingSplit(sameDay).map((s) => s.id)).toEqual(['first', 'second'])
  })

  it('lists recently split newest-first so a mistaken tick is easy to undo', () => {
    expect(recentlySplit(rows, 5).map((s) => s.id)).toEqual(['d', 'a'])
  })

  it('caps the recently-split list', () => {
    expect(recentlySplit(rows, 1).map((s) => s.id)).toEqual(['d'])
  })

  it('totals only what is still awaiting', () => {
    const t = salesTotals(awaitingSplit(rows))
    expect(t.count).toBe(2)
    expect(t.grossMinor).toBe(500) // 200 + 300, excluding the two already split
  })

  it('nets referral payouts out of the amount still to allocate', () => {
    const q = awaitingSplit([sale({ amountMinor: 1_000, referral: 'Sam', referralAmountMinor: 150 })])
    expect(salesTotals(q).netMinor).toBe(850)
  })
})
