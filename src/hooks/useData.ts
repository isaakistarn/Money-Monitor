import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { isLiability, type Account } from '@/types/models'
import { currentYm, recentYms } from '@/lib/date'
import { valueHolding, holdingValueMinor } from '@/lib/portfolio'

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
  let liabilities = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (isLiability(a.type)) liabilities += -a.balanceMinor // balance is negative when owed
    else cash += a.balanceMinor
  }
  // Investments are assets and count toward Net Worth, but are NOT spendable cash.
  const assets = cash + investmentsMinor
  return {
    netWorthMinor: assets - liabilities,
    spendableCashMinor: cash,
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

export function useBudgets(ym = currentYm()) {
  return useLiveQuery(async () => {
    const [budgets, spend, cats] = await Promise.all([
      db.budgets.where('ym').equals(ym).toArray(),
      db.categoryMonthly.where('ym').equals(ym).toArray(),
      db.categories.toArray(),
    ])
    const spendMap = new Map(spend.map((s) => [s.categoryId, s.spentMinor]))
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
  }, [ym])
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
