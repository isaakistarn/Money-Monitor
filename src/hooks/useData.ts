import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { accountEffect } from '@/db/repo'
import { isLiability, type Account } from '@/types/models'
import { currentYm, recentYms, recentDays, recentWeekStarts, weekStartISO, addDaysISO } from '@/lib/date'
import { valueHolding, holdingValueMinor } from '@/lib/portfolio'
import { incomeByCategory, incomeSeriesByMonth, incomeSlices } from '@/lib/income'
import { salesByPeriod, salesTotals, awaitingSplit, recentlySplit, type SalesPeriodPoint, type SalesTotals } from '@/lib/sales'
import type { Sale } from '@/types/models'

/** All accounts with their live derived balance (opening + rollup delta). */
export function useAccountsWithBalances() {
  return useLiveQuery(async () => {
    const [accounts, rollups] = await Promise.all([
      db.accounts.orderBy('order').toArray(),
      db.accountRollup.toArray(),
    ])
    const deltaMap = new Map(rollups.map((r) => [r.accountId, r.deltaMinor]))
    return accounts.map((a) => ({
      ...a,
      balanceMinor: a.openingBalanceMinor * (isLiability(a.type) ? -1 : 1) + (deltaMap.get(a.id) ?? 0),
    }))
  }, [])
}

export interface BalanceTotals {
  netWorthMinor: number
  spendableCashMinor: number
  totalAssetsMinor: number
  totalLiabilitiesMinor: number
  investmentsMinor: number
}

export function useBalanceTotals(): BalanceTotals | undefined {
  const accounts = useAccountsWithBalances()
  const investmentsMinor = useInvestmentsTotal()
  if (!accounts || investmentsMinor === undefined) return undefined
  let cash = 0
  let spendable = 0
  let liabilities = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (isLiability(a.type)) {
      liabilities += -a.balanceMinor // balance is negative when owed
    } else {
      cash += a.balanceMinor
      // Spendable Cash counts only the asset accounts the user opted in.
      if (!a.excludeFromSpendable) spendable += a.balanceMinor
    }
  }
  // Investments are assets and count toward Total Money, but are NOT spendable cash.
  const assets = cash + investmentsMinor
  return {
    netWorthMinor: assets - liabilities,
    spendableCashMinor: spendable,
    totalAssetsMinor: assets,
    totalLiabilitiesMinor: liabilities,
    investmentsMinor,
  }
}

/** Total current value of all investment holdings, in minor units. */
export function useInvestmentsTotal(): number | undefined {
  return useLiveQuery(async () => {
    const holdings = await db.holdings.toArray()
    return holdings.reduce((s, h) => s + holdingValueMinor(h.quantity, h.unitPriceMinor), 0)
  }, [])
}

/** Holdings with computed value/gain, sorted by value descending. */
export function useHoldings() {
  return useLiveQuery(async () => {
    const holdings = await db.holdings.toArray()
    return holdings.map(valueHolding).sort((a, b) => b.valueMinor - a.valueMinor)
  }, [])
}

export function useMonthlyStat(ym = currentYm()) {
  return useLiveQuery(async () => {
    const row = await db.monthlyStats.get(ym)
    return {
      incomeMinor: row?.incomeMinor ?? 0,
      expenseMinor: row?.expenseMinor ?? 0,
      savingsMinor: (row?.incomeMinor ?? 0) - (row?.expenseMinor ?? 0),
    }
  }, [ym])
}

/** Category spend for a month, joined with category metadata, sorted desc. */
export function useCategorySpend(ym = currentYm()) {
  return useLiveQuery(async () => {
    const [rows, cats] = await Promise.all([
      db.categoryMonthly.where('ym').equals(ym).toArray(),
      db.categories.toArray(),
    ])
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const total = rows.reduce((s, r) => s + r.spentMinor, 0)
    return rows
      .map((r) => ({
        categoryId: r.categoryId,
        name: catMap.get(r.categoryId)?.name ?? 'Unknown',
        icon: catMap.get(r.categoryId)?.icon ?? '•',
        spentMinor: r.spentMinor,
        pct: total > 0 ? (r.spentMinor / total) * 100 : 0,
      }))
      .sort((a, b) => b.spentMinor - a.spentMinor)
  }, [ym])
}

/**
 * Income per source category for a month, sorted desc — the mirror of
 * `useCategorySpend`. Read from the raw transactions (via the [ym+type] index)
 * because the rollup tables only track a single monthly income total.
 */
export function useCategoryIncome(ym = currentYm()) {
  return useLiveQuery(async () => {
    const [rows, cats] = await Promise.all([
      db.transactions.where('[ym+type]').equals([ym, 'income']).toArray(),
      db.categories.toArray(),
    ])
    return incomeSlices(incomeByCategory(rows), cats)
  }, [ym])
}

/** Per-source income across the last N months, oldest month first. */
export function useIncomeSourceTrend(months = 6) {
  return useLiveQuery(async () => {
    const yms = recentYms(months)
    const [rows, cats] = await Promise.all([
      db.transactions.where('ym').anyOf(yms).toArray(),
      db.categories.toArray(),
    ])
    return { yms, series: incomeSeriesByMonth(rows, yms, cats) }
  }, [months])
}

export function useMonthlyTrend(months = 6) {
  return useLiveQuery(async () => {
    const yms = recentYms(months)
    const stats = await db.monthlyStats.where('ym').anyOf(yms).toArray()
    const map = new Map(stats.map((s) => [s.ym, s]))
    return yms.map((ym) => ({
      ym,
      incomeMinor: map.get(ym)?.incomeMinor ?? 0,
      expenseMinor: map.get(ym)?.expenseMinor ?? 0,
    }))
  }, [months])
}

export interface DayPoint {
  date: string
  incomeMinor: number
  expenseMinor: number
}

/** Income & expense totals bucketed by day over the last N days, oldest first. */
export function useDailyTrend(days = 30) {
  return useLiveQuery(async () => {
    const dates = recentDays(days)
    const rows = await db.transactions
      .where('date')
      .between(dates[0], dates[dates.length - 1], true, true)
      .toArray()
    const inc = new Map<string, number>()
    const exp = new Map<string, number>()
    for (const t of rows) {
      // Spend-counting transfers land in the expense bucket like an expense.
      if (t.excluded || (t.type === 'transfer' && !t.countsAsSpend)) continue
      const m = t.type === 'income' ? inc : exp
      m.set(t.date, (m.get(t.date) ?? 0) + t.amountMinor)
    }
    return dates.map<DayPoint>((d) => ({
      date: d,
      incomeMinor: inc.get(d) ?? 0,
      expenseMinor: exp.get(d) ?? 0,
    }))
  }, [days])
}

export interface WeekPoint {
  weekStart: string
  incomeMinor: number
  expenseMinor: number
}

/** Income & expense totals bucketed by ISO week (Mon-start) over N weeks. */
export function useWeeklyTrend(weeks = 8) {
  return useLiveQuery(async () => {
    const starts = recentWeekStarts(weeks)
    const end = addDaysISO(starts[starts.length - 1], 6)
    const rows = await db.transactions.where('date').between(starts[0], end, true, true).toArray()
    const inc = new Map<string, number>()
    const exp = new Map<string, number>()
    for (const t of rows) {
      if (t.excluded || (t.type === 'transfer' && !t.countsAsSpend)) continue
      const wk = weekStartISO(t.date)
      const m = t.type === 'income' ? inc : exp
      m.set(wk, (m.get(wk) ?? 0) + t.amountMinor)
    }
    return starts.map<WeekPoint>((w) => ({
      weekStart: w,
      incomeMinor: inc.get(w) ?? 0,
      expenseMinor: exp.get(w) ?? 0,
    }))
  }, [weeks])
}

export interface BalancePoint {
  date: string
  balanceMinor: number
}

/**
 * Running balance of one account at the end of each of the last N days.
 * Walks the account's transactions in date order and carries the balance
 * forward across days with no activity; the final point matches the account's
 * current live balance.
 */
export function useAccountBalanceHistory(accountId: string | undefined, days = 30) {
  return useLiveQuery(async () => {
    if (!accountId) return undefined
    const account = await db.accounts.get(accountId)
    if (!account) return undefined
    const txns = await db.transactions
      .filter((t) => t.accountId === accountId || t.fromAccountId === accountId || t.toAccountId === accountId)
      .toArray()
    txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    let running = account.openingBalanceMinor * (isLiability(account.type) ? -1 : 1)
    let i = 0
    return recentDays(days).map<BalancePoint>((day) => {
      while (i < txns.length && txns[i].date <= day) {
        running += accountEffect(txns[i], accountId)
        i++
      }
      return { date: day, balanceMinor: running }
    })
  }, [accountId, days])
}

/** Device-local daily portfolio-value history over the last N days, oldest first. */
export function usePortfolioHistory(days = 90) {
  return useLiveQuery(async () => {
    const start = recentDays(days)[0]
    const rows = await db.portfolioSnapshots.where('date').aboveOrEqual(start).toArray()
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [days])
}

export function useRecentTransactions(limit = 10) {
  return useLiveQuery(
    () => db.transactions.orderBy('date').reverse().limit(limit).toArray(),
    [limit],
  )
}

export function useCategories() {
  return useLiveQuery(() => db.categories.toArray(), [])
}

export function useAccounts(): Account[] | undefined {
  return useLiveQuery(() => db.accounts.orderBy('order').toArray(), [])
}

/**
 * Category spend within a date range, from the raw transactions (the rollup
 * tables are monthly-only). Skips plain transfers and excluded rows but counts
 * spend-flagged transfers, matching the monthly aggregates' rules.
 */
async function categorySpendBetween(startISO: string, endISO: string): Promise<Map<string, number>> {
  const spend = new Map<string, number>()
  const txns = await db.transactions.where('date').between(startISO, endISO, true, true).toArray()
  for (const t of txns) {
    const spends = t.type === 'expense' || (t.type === 'transfer' && t.countsAsSpend)
    if (!spends || t.excluded || !t.categoryId) continue
    spend.set(t.categoryId, (spend.get(t.categoryId) ?? 0) + t.amountMinor)
  }
  return spend
}

/**
 * Budgets + spend for one period. `periodKey` is a month ('yyyy-mm', spend from
 * the monthly rollup) or a Monday week-start date ('yyyy-mm-dd', spend summed
 * over that week's transactions).
 */
export function useBudgets(periodKey = currentYm()) {
  return useLiveQuery(async () => {
    const weekly = periodKey.length === 10
    const [budgets, spendMap, cats] = await Promise.all([
      db.budgets.where('ym').equals(periodKey).toArray(),
      weekly
        ? categorySpendBetween(periodKey, addDaysISO(periodKey, 6))
        : db.categoryMonthly.where('ym').equals(periodKey).toArray()
            .then((rows) => new Map(rows.map((s) => [s.categoryId, s.spentMinor]))),
      db.categories.toArray(),
    ])
    const catMap = new Map(cats.map((c) => [c.id, c]))
    return budgets
      .map((b) => {
        const spent = spendMap.get(b.categoryId) ?? 0
        return {
          ...b,
          name: catMap.get(b.categoryId)?.name ?? 'Unknown',
          icon: catMap.get(b.categoryId)?.icon ?? '•',
          spentMinor: spent,
          remainingMinor: b.amountMinor - spent,
          pct: b.amountMinor > 0 ? (spent / b.amountMinor) * 100 : 0,
        }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [periodKey])
}

export function useDueRecurring() {
  return useLiveQuery(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const all = await db.recurring.toArray()
    return all.filter((r) => r.active && r.nextDue <= today)
  }, [])
}

export function useRecurring() {
  return useLiveQuery(() => db.recurring.orderBy('nextDue').toArray(), [])
}

export function useTotalTransactionCount() {
  return useLiveQuery(() => db.transactions.count(), [])
}

export function usePaySplits() {
  return useLiveQuery(() => db.paySplits.orderBy('name').toArray(), [])
}

export function useWatchlist() {
  return useLiveQuery(() => db.watchlist.orderBy('order').toArray(), [])
}

/* ------------------------------ Sales ------------------------------- */

/** Sales in one month ('yyyy-mm'), newest first. */
export function useSales(ym = currentYm()): Sale[] | undefined {
  return useLiveQuery(
    async () => {
      const rows = await db.sales.where('ym').equals(ym).toArray()
      // Newest first, and within a day the most recently entered on top.
      return rows.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
    },
    [ym],
  )
}

/** Every sale ever recorded, for all-time totals. */
export function useAllSales(): Sale[] | undefined {
  return useLiveQuery(() => db.sales.toArray(), [])
}

export interface SalesOverview {
  allTime: SalesTotals
  month: SalesTotals
  /** Same month last year through to now, oldest first — the monthly chart. */
  monthly: SalesPeriodPoint[]
  yms: string[]
}

/**
 * Headline sales figures plus a monthly series. Reads the whole table: a
 * personal sales log is small (hundreds of rows), and doing it in one query
 * keeps the all-time totals and the chart consistent with each other.
 */
export function useSalesOverview(ym = currentYm(), months = 12): SalesOverview | undefined {
  return useLiveQuery(async () => {
    const rows = await db.sales.toArray()
    const yms = recentYms(months)
    return {
      allTime: salesTotals(rows),
      month: salesTotals(rows.filter((s) => s.ym === ym)),
      monthly: salesByPeriod(rows, yms, (s) => s.ym),
      yms,
    }
  }, [ym, months])
}

/** Sales bucketed by day over the last N days, oldest first. */
export function useSalesDailyTrend(days = 30): SalesPeriodPoint[] | undefined {
  return useLiveQuery(async () => {
    const dates = recentDays(days)
    const rows = await db.sales.where('date').between(dates[0], dates[dates.length - 1], true, true).toArray()
    return salesByPeriod(rows, dates, (s) => s.date)
  }, [days])
}

export interface SplitQueue {
  /** Sales still to run through a pay split, oldest first. */
  awaiting: Sale[]
  /** Totals of `awaiting` — what's still to be allocated. */
  totals: SalesTotals
  /** The most recently ticked off, so a mistaken tick can be undone. */
  recent: Sale[]
  /** How many sales have been ticked off in total. */
  splitCount: number
}

/**
 * The pay-split work queue. Reads the whole table (a personal sales log is
 * small) so the queue, its totals and the "recently split" list are all
 * consistent with one another.
 */
export function useSalesSplitQueue(recentLimit = 5): SplitQueue | undefined {
  return useLiveQuery(async () => {
    const rows = await db.sales.toArray()
    const awaiting = awaitingSplit(rows)
    return {
      awaiting,
      totals: salesTotals(awaiting),
      recent: recentlySplit(rows, recentLimit),
      splitCount: rows.length - awaiting.length,
    }
  }, [recentLimit])
}

/** Distinct buyer and referral names already used, for the entry form's suggestions. */
export function useSalesNames(): { buyers: string[]; referrals: string[] } | undefined {
  return useLiveQuery(async () => {
    const rows = await db.sales.toArray()
    const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b))
    return {
      buyers: sorted(new Set(rows.map((s) => s.buyer.trim()).filter(Boolean))),
      referrals: sorted(new Set(rows.map((s) => s.referral?.trim() ?? '').filter(Boolean))),
    }
  }, [])
}
