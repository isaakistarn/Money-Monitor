import type { Category } from '@/types/models'
import { toISODate } from '@/lib/date'

/**
 * Up Bank personal API client (https://developer.up.com.au). Up serves CORS
 * (`access-control-allow-origin: *`), so the app talks to it directly — no
 * proxy, and the personal access token never leaves this device (it lives in
 * the un-synced `meta` table). The token grants READ access to the user's
 * entire transaction history, so it must never be sent anywhere but
 * api.up.com.au (which the CSP connect-src enforces).
 */

const API = 'https://api.up.com.au/api/v1'

export class UpAuthError extends Error {}

export interface UpMoney {
  currencyCode: string
  value: string
  /** Cents, signed: negative = money out. */
  valueInBaseUnits: number
}

export interface UpAccount {
  id: string
  displayName: string
  accountType: 'TRANSACTIONAL' | 'SAVER' | 'HOME_LOAN'
  balanceMinor: number
}

export interface UpTransaction {
  id: string
  status: 'HELD' | 'SETTLED'
  description: string
  message: string | null
  amountMinor: number // signed cents
  createdAt: string // ISO datetime
  settledAt: string | null
  accountId: string
  /** Set when the movement is between two of the user's own Up accounts. */
  transferAccountId: string | null
  /** Up category id, e.g. 'restaurants-and-cafes'. */
  categoryId: string | null
}

/* --------------------------- HTTP plumbing --------------------------- */

interface JsonApiPage<T> {
  data: T[]
  links?: { next?: string | null }
}

async function upFetch<T>(token: string, url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new Error('Could not reach Up. Check your connection and try again.')
  }
  if (res.status === 401) throw new UpAuthError('Up rejected the token. Check it and try again.')
  if (res.status === 429) throw new Error('Up is rate-limiting requests — try again in a minute.')
  if (!res.ok) throw new Error(`Up API error (HTTP ${res.status}).`)
  return (await res.json()) as T
}

/** Validate a token cheaply (Up's ping endpoint). Throws on a bad token. */
export async function pingUp(token: string): Promise<void> {
  await upFetch(token, `${API}/util/ping`)
}

interface RawAccount {
  id: string
  attributes: {
    displayName: string
    accountType: UpAccount['accountType']
    balance: UpMoney
  }
}

export async function fetchUpAccounts(token: string): Promise<UpAccount[]> {
  const out: UpAccount[] = []
  let url: string | null = `${API}/accounts?page[size]=30`
  while (url) {
    const page: JsonApiPage<RawAccount> = await upFetch(token, url)
    for (const a of page.data) {
      out.push({
        id: a.id,
        displayName: a.attributes.displayName,
        accountType: a.attributes.accountType,
        balanceMinor: a.attributes.balance.valueInBaseUnits,
      })
    }
    url = page.links?.next ?? null
  }
  return out
}

interface RawTransaction {
  id: string
  attributes: {
    status: 'HELD' | 'SETTLED'
    description: string
    message: string | null
    amount: UpMoney
    createdAt: string
    settledAt: string | null
  }
  relationships: {
    account: { data: { id: string } | null }
    transferAccount?: { data: { id: string } | null }
    category?: { data: { id: string } | null }
  }
}

/** Hard cap on pages per sync — 40 × 100 = 4000 transactions. */
const MAX_PAGES = 40

/**
 * All transactions across all accounts created at/after `sinceIso`, oldest
 * data included via pagination (Up returns newest-first; the importer sorts).
 */
export async function fetchUpTransactionsSince(token: string, sinceIso: string): Promise<UpTransaction[]> {
  const out: UpTransaction[] = []
  let url: string | null =
    `${API}/transactions?page[size]=100&filter[since]=${encodeURIComponent(sinceIso)}`
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const page: JsonApiPage<RawTransaction> = await upFetch(token, url)
    for (const t of page.data) {
      if (!t.relationships.account?.data) continue
      out.push({
        id: t.id,
        status: t.attributes.status,
        description: t.attributes.description,
        message: t.attributes.message,
        amountMinor: t.attributes.amount.valueInBaseUnits,
        createdAt: t.attributes.createdAt,
        settledAt: t.attributes.settledAt,
        accountId: t.relationships.account.data.id,
        transferAccountId: t.relationships.transferAccount?.data?.id ?? null,
        categoryId: t.relationships.category?.data?.id ?? null,
      })
    }
    url = page.links?.next ?? null
  }
  return out
}

/* ------------------------- Mapping helpers -------------------------- */

/** Local calendar date a transaction belongs to (settled beats created). */
export function upTransactionDate(t: Pick<UpTransaction, 'createdAt' | 'settledAt'>): string {
  return toISODate(new Date(t.settledAt ?? t.createdAt))
}

/** Up round-up movements are internal transfers titled "Round Up". */
export function isUpRoundUp(t: Pick<UpTransaction, 'description' | 'transferAccountId'>): boolean {
  return !!t.transferAccountId && /^round[\s-]?up$/i.test(t.description.trim())
}

/**
 * Up category id → default seed-category name. Users with custom categories
 * are matched by name first (see matchUpCategory); this map is the fallback
 * that routes Up's fine-grained taxonomy into the app's starter set.
 */
const UP_CATEGORY_TO_DEFAULT: Record<string, string> = {
  'groceries': 'Food',
  'restaurants-and-cafes': 'Food',
  'takeaway': 'Food',
  'booze': 'Food',
  'pubs-and-bars': 'Food',
  'fuel': 'Transport',
  'parking': 'Transport',
  'public-transport': 'Transport',
  'taxis-and-share-cars': 'Transport',
  'toll-roads': 'Transport',
  'car-insurance-and-maintenance': 'Transport',
  'car-repayments': 'Transport',
  'cycling': 'Transport',
  'events-and-gigs': 'Entertainment',
  'hobbies': 'Entertainment',
  'tv-and-music': 'Entertainment',
  'games-and-software': 'Entertainment',
  'lottery-and-gambling': 'Entertainment',
  'clothing-and-accessories': 'Shopping',
  'homeware-and-appliances': 'Shopping',
  'technology': 'Shopping',
  'hair-and-beauty': 'Shopping',
  'rent-and-mortgage': 'Housing',
  'home-maintenance-and-improvements': 'Housing',
  'home-insurance-and-rates': 'Housing',
  'utilities': 'Utilities',
  'internet': 'Utilities',
  'mobile-phone': 'Utilities',
  'health-and-medical': 'Healthcare',
  'fitness-and-wellbeing': 'Healthcare',
  'education-and-student-loans': 'Education',
  'news-magazines-and-books': 'Education',
  'holidays-and-travel': 'Travel',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Best local expense category for an Up category id: exact/loose name match
 * against the user's own categories first (so custom ones like "Groceries"
 * win), then the default-taxonomy fallback, else undefined (uncategorised).
 */
export function matchUpCategory(
  upCategoryId: string | null,
  categories: Pick<Category, 'id' | 'name' | 'kind'>[],
): string | undefined {
  if (!upCategoryId) return undefined
  const expense = categories.filter((c) => c.kind === 'expense')
  const upWords = norm(upCategoryId.replace(/-/g, ' '))
  const direct = expense.find((c) => {
    const n = norm(c.name)
    return n === upWords || n.includes(upWords) || upWords.includes(n)
  })
  if (direct) return direct.id
  const fallbackName = UP_CATEGORY_TO_DEFAULT[upCategoryId]
  if (!fallbackName) return undefined
  return expense.find((c) => norm(c.name) === norm(fallbackName))?.id
}
