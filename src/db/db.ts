import Dexie, { type Table } from 'dexie'
import type {
  Account,
  Category,
  Transaction,
  Budget,
  Recurring,
  AccountRollup,
  MonthlyStat,
  CategoryMonthly,
  Meta,
  OutboxEntry,
} from '@/types/models'

export class FinanceDB extends Dexie {
  accounts!: Table<Account, string>
  categories!: Table<Category, string>
  transactions!: Table<Transaction, string>
  budgets!: Table<Budget, string>
  recurring!: Table<Recurring, string>
  accountRollup!: Table<AccountRollup, string>
  monthlyStats!: Table<MonthlyStat, string>
  categoryMonthly!: Table<CategoryMonthly, string>
  meta!: Table<Meta, string>
  outbox!: Table<OutboxEntry, string>

  constructor() {
    super('finance-tracker')
    this.version(1).stores({
      accounts: 'id, type, order, archived',
      categories: 'id, kind',
      // Compound + single indexes tuned for the queries we run:
      transactions: 'id, date, ym, type, categoryId, accountId, fromAccountId, toAccountId, [ym+type], [accountId+date]',
      budgets: 'id, &[categoryId+ym], ym, categoryId',
      recurring: 'id, nextDue',
      accountRollup: 'accountId',
      monthlyStats: 'ym',
      categoryMonthly: 'id, ym, categoryId, [ym+categoryId]',
      meta: 'key',
    })

    // v2 adds the sync outbox (a dirty-set of rows pending push to Supabase)
    // and an `updatedAt` index on every synced table. Existing rows are
    // backfilled with a single timestamp so the first push replicates them all.
    this.version(2)
      .stores({
        accounts: 'id, type, order, archived, updatedAt',
        categories: 'id, kind, updatedAt',
        transactions:
          'id, date, ym, type, categoryId, accountId, fromAccountId, toAccountId, updatedAt, [ym+type], [accountId+date]',
        budgets: 'id, &[categoryId+ym], ym, categoryId, updatedAt',
        recurring: 'id, nextDue, updatedAt',
        outbox: 'id, table, ts',
      })
      .upgrade(async (tx) => {
        const stamp = Date.now()
        for (const name of ['accounts', 'categories', 'transactions', 'budgets', 'recurring'] as const) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: { updatedAt?: number }) => {
              if (row.updatedAt == null) row.updatedAt = stamp
            })
        }
      })
  }
}

export const db = new FinanceDB()
