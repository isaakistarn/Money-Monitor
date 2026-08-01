import { describe, expect, it } from 'vitest'
import {
  UNCATEGORISED,
  countsAsIncome,
  incomeByCategory,
  incomeSeriesByMonth,
  incomeSlices,
} from './income'
import type { Category, Transaction } from '@/types/models'

const cats: Category[] = [
  { id: 'salary', name: 'Salary', kind: 'income', icon: '💼', isDefault: true },
  { id: 'invest', name: 'Investments', kind: 'income', icon: '📈', isDefault: true },
  { id: 'gifts', name: 'Gifts', kind: 'income', icon: '🎁', isDefault: true },
  { id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true },
]

let seq = 0
function txn(t: Partial<Transaction> & Pick<Transaction, 'type' | 'amountMinor'>): Transaction {
  const date = t.date ?? '2026-07-15'
  return {
    id: `t${seq++}`,
    date,
    ym: t.ym ?? date.slice(0, 7),
    createdAt: '',
    ...t,
  } as Transaction
}

describe('income bucketing rules', () => {
  it('counts plain income rows', () => {
    expect(countsAsIncome(txn({ type: 'income', amountMinor: 100 }))).toBe(true)
  })

  it('never counts expenses or transfers, even spend-flagged ones', () => {
    expect(countsAsIncome(txn({ type: 'expense', amountMinor: 100 }))).toBe(false)
    expect(countsAsIncome(txn({ type: 'transfer', amountMinor: 100 }))).toBe(false)
    expect(countsAsIncome(txn({ type: 'transfer', amountMinor: 100, countsAsSpend: true }))).toBe(false)
  })

  it('skips excluded rows, matching the expense side', () => {
    expect(countsAsIncome(txn({ type: 'income', amountMinor: 100, excluded: true }))).toBe(false)
  })
})

describe('incomeByCategory', () => {
  it('sums income per category and ignores non-income rows', () => {
    const totals = incomeByCategory([
      txn({ type: 'income', amountMinor: 3000_00, categoryId: 'salary' }),
      txn({ type: 'income', amountMinor: 500_00, categoryId: 'salary' }),
      txn({ type: 'income', amountMinor: 120_00, categoryId: 'invest' }),
      txn({ type: 'expense', amountMinor: 42_00, categoryId: 'food' }),
      txn({ type: 'transfer', amountMinor: 200_00 }),
      txn({ type: 'income', amountMinor: 999_00, categoryId: 'salary', excluded: true }),
    ])
    expect(totals.get('salary')).toBe(3500_00)
    expect(totals.get('invest')).toBe(120_00)
    expect(totals.has('food')).toBe(false)
    expect(totals.size).toBe(2)
  })

  it('collapses income with no category into one bucket', () => {
    const totals = incomeByCategory([
      txn({ type: 'income', amountMinor: 50_00 }),
      txn({ type: 'income', amountMinor: 25_00, categoryId: undefined }),
    ])
    expect(totals.get(UNCATEGORISED)).toBe(75_00)
  })
})

describe('incomeSlices', () => {
  it('joins metadata, computes share and sorts largest source first', () => {
    const slices = incomeSlices(
      new Map([
        ['invest', 250_00],
        ['salary', 750_00],
      ]),
      cats,
    )
    expect(slices.map((s) => s.name)).toEqual(['Salary', 'Investments'])
    expect(slices[0]).toMatchObject({ incomeMinor: 750_00, icon: '💼' })
    expect(slices[0].pct).toBeCloseTo(75)
    expect(slices[1].pct).toBeCloseTo(25)
  })

  it('labels unknown and uncategorised buckets instead of dropping them', () => {
    const slices = incomeSlices(
      new Map([
        [UNCATEGORISED, 100_00],
        ['deleted-cat', 10_00],
      ]),
      cats,
    )
    expect(slices.map((s) => s.name)).toEqual(['Uncategorised', 'Unknown'])
  })

  it('returns no slices, and never divides by zero, when there is no income', () => {
    expect(incomeSlices(new Map(), cats)).toEqual([])
    expect(incomeSlices(new Map([['salary', 0]]), cats)[0].pct).toBe(0)
  })
})

describe('incomeSeriesByMonth', () => {
  const yms = ['2026-05', '2026-06', '2026-07']

  it('aligns each source to the month buckets, zero-filling quiet months', () => {
    const series = incomeSeriesByMonth(
      [
        txn({ type: 'income', amountMinor: 3000_00, categoryId: 'salary', date: '2026-05-20' }),
        txn({ type: 'income', amountMinor: 3000_00, categoryId: 'salary', date: '2026-07-20' }),
        txn({ type: 'income', amountMinor: 120_00, categoryId: 'invest', date: '2026-06-14' }),
      ],
      yms,
      cats,
    )
    expect(series).toEqual([
      { categoryId: 'salary', name: 'Salary', values: [3000_00, 0, 3000_00] },
      { categoryId: 'invest', name: 'Investments', values: [0, 120_00, 0] },
    ])
  })

  it('ignores rows outside the requested months', () => {
    const series = incomeSeriesByMonth(
      [
        txn({ type: 'income', amountMinor: 100_00, categoryId: 'salary', date: '2026-01-10' }),
        txn({ type: 'income', amountMinor: 200_00, categoryId: 'salary', date: '2026-06-10' }),
      ],
      yms,
      cats,
    )
    expect(series[0].values).toEqual([0, 200_00, 0])
  })

  it('folds the long tail past topN into a single Other series', () => {
    const series = incomeSeriesByMonth(
      [
        txn({ type: 'income', amountMinor: 900_00, categoryId: 'salary', date: '2026-05-01' }),
        txn({ type: 'income', amountMinor: 300_00, categoryId: 'invest', date: '2026-06-01' }),
        txn({ type: 'income', amountMinor: 100_00, categoryId: 'gifts', date: '2026-07-01' }),
      ],
      yms,
      cats,
      2,
    )
    expect(series.map((s) => s.name)).toEqual(['Salary', 'Investments', 'Other'])
    expect(series[2].values).toEqual([0, 0, 100_00])
  })

  it('returns nothing when there is no income at all', () => {
    expect(incomeSeriesByMonth([txn({ type: 'expense', amountMinor: 10_00 })], yms, cats)).toEqual([])
  })
})
