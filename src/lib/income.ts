import type { Category, Transaction } from '@/types/models'

/**
 * Income aggregation — "where is the money coming from".
 *
 * Spending has monthly rollup tables (`categoryMonthly`) maintained on every
 * write, but income is only rolled up as a single monthly total. Breaking it
 * down per source therefore means summing the raw transactions, which is what
 * these helpers do. They are pure so the bucketing rules stay testable and
 * match the expense side exactly: excluded rows never count, and transfers are
 * money moving between your own accounts, so they are never income.
 */

/** Bucket key for income that has no category set. */
export const UNCATEGORISED = '__uncategorised__'

export interface IncomeSlice {
  categoryId: string
  name: string
  icon: string
  incomeMinor: number
  /** Share of the period's total income, 0–100. */
  pct: number
}

export function countsAsIncome(t: Transaction): boolean {
  return t.type === 'income' && !t.excluded
}

/** Sum income per category id over the given rows. */
export function incomeByCategory(txns: Transaction[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of txns) {
    if (!countsAsIncome(t)) continue
    const key = t.categoryId || UNCATEGORISED
    out.set(key, (out.get(key) ?? 0) + t.amountMinor)
  }
  return out
}

/** Join per-category totals with category metadata, largest source first. */
export function incomeSlices(totals: Map<string, number>, cats: Category[]): IncomeSlice[] {
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const total = [...totals.values()].reduce((s, v) => s + v, 0)
  return [...totals.entries()]
    .map(([categoryId, incomeMinor]) => ({
      categoryId,
      name:
        categoryId === UNCATEGORISED
          ? 'Uncategorised'
          : (catMap.get(categoryId)?.name ?? 'Unknown'),
      icon: categoryId === UNCATEGORISED ? '•' : (catMap.get(categoryId)?.icon ?? '•'),
      incomeMinor,
      pct: total > 0 ? (incomeMinor / total) * 100 : 0,
    }))
    .sort((a, b) => b.incomeMinor - a.incomeMinor)
}

export interface IncomeSeries {
  categoryId: string
  name: string
  /** One total per month, aligned to the `yms` passed in. */
  values: number[]
}

/**
 * Per-source income across a run of months, for the stacked chart. Sources are
 * ordered by total contribution and everything past `topN` is folded into a
 * single "Other" series so a long tail of one-off sources stays readable.
 */
export function incomeSeriesByMonth(
  txns: Transaction[],
  yms: string[],
  cats: Category[],
  topN = 6,
): IncomeSeries[] {
  const index = new Map(yms.map((ym, i) => [ym, i]))
  const byCategory = new Map<string, number[]>()
  for (const t of txns) {
    if (!countsAsIncome(t)) continue
    const i = index.get(t.ym)
    if (i === undefined) continue
    const key = t.categoryId || UNCATEGORISED
    const row = byCategory.get(key) ?? new Array<number>(yms.length).fill(0)
    row[i] += t.amountMinor
    byCategory.set(key, row)
  }

  const catMap = new Map(cats.map((c) => [c.id, c]))
  const sum = (v: number[]) => v.reduce((s, n) => s + n, 0)
  const ranked = [...byCategory.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))

  const series = ranked.slice(0, topN).map(([categoryId, values]) => ({
    categoryId,
    name:
      categoryId === UNCATEGORISED
        ? 'Uncategorised'
        : (catMap.get(categoryId)?.name ?? 'Unknown'),
    values,
  }))

  const rest = ranked.slice(topN)
  if (rest.length) {
    series.push({
      categoryId: '__other__',
      name: 'Other',
      values: yms.map((_, i) => rest.reduce((s, [, v]) => s + v[i], 0)),
    })
  }
  return series
}
