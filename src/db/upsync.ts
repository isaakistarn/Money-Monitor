import { db } from './db'
import { getMeta, setMeta } from './meta'
import { addAccount, addTransaction, updateAccount, updateTransaction } from './repo'
import { addDaysISO } from '@/lib/date'
import {
  fetchUpAccounts,
  fetchUpTransactionsSince,
  isUpRoundUp,
  matchUpCategory,
  pingUp,
  upTransactionDate,
  type UpAccount,
  type UpTransaction,
} from '@/lib/up'
import type { AccountType, Transaction } from '@/types/models'

/**
 * Up Bank feed: pulls the user's real Up transactions and applies them as
 * regular app transactions through the repository (so rollups, budgets and
 * sync all see them like hand-entered rows).
 *
 * Everything about the connection lives in the device-local `meta` table
 * (deliberately NOT synced): the token stays on this device, and each device
 * keeps its own watermark. The imported *transactions* sync normally, and the
 * `externalId` upsert key is what keeps two connected devices from
 * double-importing the same charge.
 */

export interface UpSettings {
  token: string
  /** Up account id → local account id. Unmapped Up accounts are not imported. */
  accountMap: Record<string, string>
  /** Import Up round-up transfers flagged `countsAsSpend` (Spare Change). */
  roundUpsAsSpend: boolean
  /** Newest Up `createdAt` seen; next sync re-fetches a trailing window from
   *  here so HELD charges that later settle (amount/date can change) are
   *  caught by the upsert. */
  watermark?: string
  /** Hard floor chosen at connect time: no sync ever fetches earlier than
   *  this, so users already tracking by hand can start from "today" without
   *  the resync overlap dragging history (and duplicates) in. */
  importFrom?: string
  lastSyncAt?: string
}

const META_KEY = 'upBank'

/** Trailing re-fetch window: HELD→SETTLED normally resolves within days. */
const RESYNC_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000
/** Auto-sync at most this often (manual "Sync now" is always allowed). */
const AUTO_SYNC_MIN_MS = 15 * 60 * 1000

export function getUpSettings(): Promise<UpSettings | null> {
  return getMeta<UpSettings | null>(META_KEY, null)
}

export async function saveUpSettings(patch: Partial<UpSettings>): Promise<void> {
  const cur = await getUpSettings()
  await setMeta(META_KEY, { ...(cur ?? {}), ...patch })
}

/** Forget the connection (token, mapping, watermark). Imported data stays. */
export async function disconnectUp(): Promise<void> {
  await db.meta.delete(META_KEY)
}

export interface UpSyncResult {
  added: number
  updated: number
  /** Hand-entered rows recognised as the same money and claimed by the feed. */
  matched: number
}

const externalKey = (upId: string) => `up:${upId}`

/** How many days apart a hand-entered row and the bank's record may be dated
 *  and still count as the same money movement. */
export const FEED_MATCH_WINDOW_DAYS = 3

/**
 * A hand-entered row that records the same real-world movement as an incoming
 * Up transaction: same type, amount and account(s), dated within a few days,
 * and not already owned by a feed. Claiming it — instead of inserting a new
 * row — is what stops a manually-entered pay or purchase from being counted
 * twice when the bank feed later delivers the same money.
 */
async function findManualTwin(
  plan: Omit<Transaction, 'id' | 'ym' | 'createdAt' | 'updatedAt'>,
): Promise<Transaction | undefined> {
  const candidates = await db.transactions
    .where('date')
    .between(
      addDaysISO(plan.date, -FEED_MATCH_WINDOW_DAYS),
      addDaysISO(plan.date, FEED_MATCH_WINDOW_DAYS),
      true,
      true,
    )
    .filter(
      (x) =>
        !x.externalId &&
        x.type === plan.type &&
        x.amountMinor === plan.amountMinor &&
        (plan.type === 'transfer'
          ? x.fromAccountId === plan.fromAccountId && x.toAccountId === plan.toAccountId
          : x.accountId === plan.accountId),
    )
    .toArray()
  const distance = (x: Transaction) => Math.abs(Date.parse(x.date) - Date.parse(plan.date))
  candidates.sort((a, b) => distance(a) - distance(b))
  return candidates[0]
}

/** What an Up transaction should look like locally (account ids are local). */
function planTransaction(
  t: UpTransaction,
  s: UpSettings,
  categoryFor: (upCategoryId: string | null) => string | undefined,
): Omit<Transaction, 'id' | 'ym' | 'createdAt' | 'updatedAt'> | 'skip' | 'mirror' {
  const localAccount = s.accountMap[t.accountId]
  const counterpart = t.transferAccountId ? s.accountMap[t.transferAccountId] : undefined
  const note = [t.description.trim(), t.message?.trim()].filter(Boolean).join(' — ') || undefined
  const date = upTransactionDate(t)
  const base = { date, note, externalId: externalKey(t.id), source: 'up' as const }

  // Round-ups are single-sided in Up's feed: only the saver's inflow row
  // exists (the spending side is an attribute on the purchase, never its own
  // transaction), so the transfer materialises from the POSITIVE side — the
  // mirror rule below would otherwise wait forever for an outflow row.
  if (isUpRoundUp(t) && t.amountMinor > 0 && counterpart) {
    if (localAccount) {
      return {
        ...base,
        type: 'transfer',
        amountMinor: t.amountMinor,
        fromAccountId: counterpart,
        toAccountId: localAccount,
        countsAsSpend: s.roundUpsAsSpend ? true : undefined,
      }
    }
    // Saver not imported: the cents still left the tracked spending account.
    return { ...base, type: 'expense', amountMinor: t.amountMinor, accountId: counterpart }
  }

  if (!localAccount) return 'skip'
  if (counterpart) {
    // Movement between two mapped Up accounts: exactly one local transfer.
    // Only the outflow side materialises; the inflow side is its mirror.
    if (t.amountMinor > 0) return 'mirror'
    return {
      ...base,
      type: 'transfer',
      amountMinor: Math.abs(t.amountMinor),
      fromAccountId: localAccount,
      toAccountId: counterpart,
      countsAsSpend: s.roundUpsAsSpend && isUpRoundUp(t) ? true : undefined,
    }
  }
  // Regular charge/deposit — including transfers to accounts the user chose
  // not to import, which are real money leaving/entering the tracked account.
  if (t.amountMinor < 0) {
    return {
      ...base,
      type: 'expense',
      amountMinor: -t.amountMinor,
      accountId: localAccount,
      categoryId: categoryFor(t.categoryId),
    }
  }
  return { ...base, type: 'income', amountMinor: t.amountMinor, accountId: localAccount }
}

/**
 * Pull new/changed Up transactions and apply them. Existing imported rows are
 * only patched for amount/date (what changes when a HELD charge settles) —
 * category or note edits the user made locally are never overwritten.
 */
export async function syncUpNow(): Promise<UpSyncResult | null> {
  const s = await getUpSettings()
  if (!s?.token || Object.keys(s.accountMap).length === 0) return null

  // Trailing overlap from the watermark, but never earlier than the floor
  // the user chose at connect time.
  const floorMs = s.importFrom ? Date.parse(s.importFrom) : Date.now() - 30 * 24 * 60 * 60 * 1000
  const overlapMs = s.watermark ? Date.parse(s.watermark) - RESYNC_OVERLAP_MS : floorMs
  const since = new Date(Math.max(floorMs, overlapMs)).toISOString()

  const fetched = await fetchUpTransactionsSince(s.token, since)
  // Oldest first so transfers/mirrors and the watermark advance predictably.
  fetched.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const categories = await db.categories.toArray()
  const categoryFor = (upId: string | null) => matchUpCategory(upId, categories)

  const result: UpSyncResult = { added: 0, updated: 0, matched: 0 }
  let watermark = s.watermark

  for (const t of fetched) {
    // Compare parsed times — Up timestamps carry a UTC offset, so lexical
    // comparison against other ISO forms would be unreliable.
    if (!watermark || Date.parse(t.createdAt) > Date.parse(watermark)) watermark = t.createdAt
    const plan = planTransaction(t, s, categoryFor)
    if (plan === 'skip' || plan === 'mirror') continue

    const existing = await db.transactions.where('externalId').equals(externalKey(t.id)).first()
    if (!existing) {
      const twin = await findManualTwin(plan)
      if (twin) {
        // The user already typed this movement in — claim their row (category
        // and note stay theirs) rather than double-count the money.
        await updateTransaction(twin.id, {
          externalId: plan.externalId,
          source: plan.source,
          date: plan.date,
        })
        result.matched++
      } else {
        await addTransaction(plan)
        result.added++
      }
      continue
    }
    // Settlement can shift the amount (e.g. pre-auth holds) and the date.
    const patch: Partial<Transaction> = {}
    if (existing.amountMinor !== plan.amountMinor) patch.amountMinor = plan.amountMinor
    if (existing.date !== plan.date) patch.date = plan.date
    if (Object.keys(patch).length > 0) {
      await updateTransaction(existing.id, patch)
      result.updated++
    }
  }

  await saveUpSettings({ watermark: watermark || undefined, lastSyncAt: new Date().toISOString() })
  return result
}

/** Auto-sync on app open, throttled; errors are silent (next open retries). */
export async function autoSyncUp(): Promise<UpSyncResult | null> {
  const s = await getUpSettings()
  if (!s?.token) return null
  if (s.lastSyncAt && Date.now() - Date.parse(s.lastSyncAt) < AUTO_SYNC_MIN_MS) return null
  try {
    return await syncUpNow()
  } catch {
    return null
  }
}

/* ---------------------------- Connecting ---------------------------- */

export interface UpConnectChoice {
  account: UpAccount
  /** 'create' a matching local account, 'skip' it, or an existing local account id. */
  target: 'create' | 'skip' | string
}

export interface UpConnectPlan {
  token: string
  choices: UpConnectChoice[]
  /** How far back the first import reaches. 0 = no history, track from now. */
  historyDays: number
  roundUpsAsSpend: boolean
}

const LOCAL_TYPE: Record<UpAccount['accountType'], AccountType> = {
  TRANSACTIONAL: 'bank',
  SAVER: 'savings',
  HOME_LOAN: 'bank',
}

/** Validate a token and list the Up accounts behind it (connect step 1). */
export async function beginUpConnect(token: string): Promise<UpAccount[]> {
  await pingUp(token)
  return fetchUpAccounts(token)
}

/**
 * Finish connecting: create/map local accounts, save settings, run the first
 * import, then set each *created* account's opening balance so its displayed
 * balance exactly equals the live Up balance (opening = live − imported delta).
 */
export async function completeUpConnect(plan: UpConnectPlan): Promise<UpSyncResult> {
  const accountMap: Record<string, string> = {}
  const created: Array<{ localId: string; balanceMinor: number }> = []

  for (const c of plan.choices) {
    if (c.target === 'skip') continue
    if (c.target === 'create') {
      const acc = await addAccount({
        name: c.account.displayName,
        type: LOCAL_TYPE[c.account.accountType],
        openingBalanceMinor: 0,
      })
      accountMap[c.account.id] = acc.id
      created.push({ localId: acc.id, balanceMinor: c.account.balanceMinor })
    } else {
      accountMap[c.account.id] = c.target
    }
  }

  await setMeta(META_KEY, {
    token: plan.token,
    accountMap,
    roundUpsAsSpend: plan.roundUpsAsSpend,
    // 0 days = start from right now: no history is pulled, ever — only
    // charges made after connecting arrive on future syncs.
    importFrom: new Date(Date.now() - plan.historyDays * 24 * 60 * 60 * 1000).toISOString(),
  } satisfies UpSettings)

  const result = (await syncUpNow()) ?? { added: 0, updated: 0, matched: 0 }

  // Anchor created accounts to the real Up balance.
  for (const c of created) {
    const rollup = await db.accountRollup.get(c.localId)
    await updateAccount(c.localId, {
      openingBalanceMinor: c.balanceMinor - (rollup?.deltaMinor ?? 0),
    })
  }
  return result
}
