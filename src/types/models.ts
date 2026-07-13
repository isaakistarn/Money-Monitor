export type AccountType = 'cash' | 'bank' | 'savings' | 'credit_card'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type CategoryKind = 'expense' | 'income'
export type Cadence = 'weekly' | 'monthly' | 'custom'

/** Asset accounts count toward Spendable Cash & Total Assets; liabilities are netted in Net Worth. */
export const LIABILITY_TYPES: AccountType[] = ['credit_card']
export const isLiability = (t: AccountType) => LIABILITY_TYPES.includes(t)

/**
 * Every user-owned entity carries `updatedAt` (epoch ms, local clock at write
 * time). The sync engine uses it for last-write-wins conflict resolution.
 * Optional so legacy rows and direct test inserts remain valid; the repository
 * always stamps it on write and the Dexie v2 upgrade backfills existing rows.
 */
export interface Synced {
  updatedAt?: number
}

export interface Account extends Synced {
  id: string
  name: string
  type: AccountType
  /** Opening balance in minor units (e.g. pence). For liabilities, a positive value = money owed. */
  openingBalanceMinor: number
  /** When true, this asset account is left out of the Spendable Cash total (but
   *  still counts toward Total Money / Total Assets). Ignored for liabilities.
   *  Absent = included, so existing accounts keep counting. */
  excludeFromSpendable?: boolean
  archived: boolean
  order: number
  createdAt: string
}

export interface Category extends Synced {
  id: string
  name: string
  kind: CategoryKind
  /** Emoji or short glyph used as the visual marker. */
  icon: string
  isDefault: boolean
}

export interface Transaction extends Synced {
  id: string
  type: TransactionType
  /** Always a positive magnitude in minor units; sign is derived from `type`. */
  amountMinor: number
  /** Required for income/expense, undefined for plain transfers. A transfer
   *  with `countsAsSpend` carries the expense category the spend belongs to. */
  categoryId?: string
  /** Owning account for income/expense. */
  accountId?: string
  /** Transfer source / destination. */
  fromAccountId?: string
  toAccountId?: string
  /** ISO date (yyyy-mm-dd) in the user's local timezone. */
  date: string
  /** Denormalised 'yyyy-mm' bucket for fast monthly queries, in local time. */
  ym: string
  note?: string
  /** When true, kept in balances + the list but excluded from charts, monthly
   *  income/expense stats, category spend and budgets. */
  excluded?: boolean
  /** Transfers only: count the moved amount as money spent (monthly expense,
   *  category spend, budgets) — for round-up savings that belong to a
   *  purchase's true cost. Balances are unaffected by the flag; the money
   *  still just moves between accounts. */
  countsAsSpend?: boolean
  createdAt: string
}

export type BudgetPeriod = 'monthly' | 'weekly'

export interface Budget extends Synced {
  id: string
  categoryId: string
  /** Period key: 'yyyy-mm' for a monthly budget, or the Monday week-start ISO
   *  date ('yyyy-mm-dd') for a weekly one. Keys can't collide across periods,
   *  so the existing unique [categoryId+ym] index covers both. */
  ym: string
  /** Absent = monthly (all legacy rows predate weekly budgets). */
  period?: 'weekly'
  amountMinor: number
}

export interface Recurring extends Synced {
  id: string
  type: TransactionType
  amountMinor: number
  categoryId?: string
  accountId?: string
  fromAccountId?: string
  toAccountId?: string
  cadence: Cadence
  /** Used when cadence === 'custom'. */
  intervalDays?: number
  /** ISO date of the next occurrence due. */
  nextDue: string
  note?: string
  active: boolean
}

/**
 * A reusable "paycheck splitter": when income lands in `depositAccountId`, the
 * allocations move portions into other accounts via transfers. Stored as a
 * template so the same split can be applied to any pay amount.
 */
export type AllocationMode = 'percent' | 'fixed'

export interface Allocation {
  id: string
  toAccountId: string
  mode: AllocationMode
  /** For 'percent': 0–100. For 'fixed': minor units. */
  value: number
  note?: string
}

export interface PaySplit extends Synced {
  id: string
  name: string
  /** Account the pay is received into (the income lands here). */
  depositAccountId: string
  /** Income category for the deposit (e.g. Salary). */
  categoryId?: string
  allocations: Allocation[]
}

/**
 * An investment holding (stock, fund, crypto, commodity, …). The app is
 * local-first with no price feed, so `unitPriceMinor` is updated manually by
 * the user. Current value = quantity × unitPrice; it counts toward Net Worth
 * and Total Assets but NOT Spendable Cash (it isn't liquid).
 */
export type HoldingType = 'stock' | 'etf' | 'crypto' | 'commodity' | 'cash' | 'other'

export interface Holding extends Synced {
  id: string
  name: string
  /** Ticker / short symbol, e.g. AAPL, BTC, XAU. */
  symbol?: string
  /** Exchange for price lookups, e.g. ASX, NASDAQ, NYSE. Blank = let the provider decide. */
  exchange?: string
  type: HoldingType
  /** Units/shares held (may be fractional). */
  quantity: number
  /** Current price per unit, in minor units. */
  unitPriceMinor: number
  /** Total amount invested (minor units), for gain/loss. Optional. Legacy
   *  holdings may carry only this; when `avgCostMinor` is set it is kept in sync
   *  as quantity × avgCostMinor. */
  costBasisMinor?: number
  /** Average buy price per unit (minor units) — the price you paid per share.
   *  When set, the effective cost basis is quantity × avgCostMinor and the app
   *  can show per-share profit/loss (buy price vs the live price). */
  avgCostMinor?: number
  note?: string
  createdAt: string
}

/**
 * A daily snapshot of total portfolio value, recorded locally as prices change.
 * Device-local derived history (like the rollup tables) — NOT synced. Keyed by
 * date so repeated updates within a day collapse to the latest value; the
 * "portfolio value over time" chart reads this series.
 */
export interface PortfolioSnapshot {
  /** ISO date (yyyy-mm-dd), local time. */
  date: string
  valueMinor: number
  costMinor: number
}

/** A ticker the user follows on the Watchlist (live data is fetched, not stored). */
export interface WatchItem extends Synced {
  id: string
  symbol: string
  /** Exchange for price lookups, e.g. ASX, NASDAQ. Blank = provider default. */
  exchange?: string
  order: number
  createdAt: string
}

/* ---- Rollup tables (derived, maintained atomically on every write) ---- */

export interface AccountRollup {
  accountId: string
  /** Signed sum of all transaction effects on this account, in minor units. */
  deltaMinor: number
}

export interface MonthlyStat {
  ym: string
  incomeMinor: number
  expenseMinor: number
}

export interface CategoryMonthly {
  /** `${ym}:${categoryId}` */
  id: string
  ym: string
  categoryId: string
  spentMinor: number
}

export interface Meta {
  key: string
  value: unknown
}

/* ---------------------------- Sync plumbing ---------------------------- */

/** Tables whose rows are replicated to Supabase. Derived/rollup tables and
 *  device-local `meta` (theme, sync cursors) are intentionally NOT synced. */
export const SYNCED_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'recurring',
  'paySplits',
  'holdings',
  'watchlist',
] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

/**
 * A pending change awaiting push to the server (a "dirty set"). Keyed by
 * `${table}:${rowId}` so the latest pending state per row collapses to one
 * entry. `deleted` marks a tombstone (the local row is already gone).
 */
export interface OutboxEntry {
  id: string
  table: SyncedTable
  rowId: string
  deleted: boolean
  /** epoch ms of the change — used for last-write-wins on the other device. */
  ts: number
}
