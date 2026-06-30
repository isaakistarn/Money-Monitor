import { useMemo } from 'react'
import { useCategories, useAccounts } from './useData'
import type { Transaction } from '@/types/models'
import type { RowMeta } from '@/components/transactions/TransactionRow'

/** Returns a fast lookup that decorates a transaction with display names. */
export function useRowMeta(): (tx: Transaction) => RowMeta {
  const categories = useCategories()
  const accounts = useAccounts()

  return useMemo(() => {
    const catMap = new Map((categories ?? []).map((c) => [c.id, c]))
    const accMap = new Map((accounts ?? []).map((a) => [a.id, a]))
    return (tx: Transaction): RowMeta => ({
      categoryName: tx.categoryId ? catMap.get(tx.categoryId)?.name : undefined,
      categoryIcon: tx.categoryId ? catMap.get(tx.categoryId)?.icon : undefined,
      accountName: tx.accountId ? accMap.get(tx.accountId)?.name : undefined,
      fromName: tx.fromAccountId ? accMap.get(tx.fromAccountId)?.name : undefined,
      toName: tx.toAccountId ? accMap.get(tx.toAccountId)?.name : undefined,
    })
  }, [categories, accounts])
}
