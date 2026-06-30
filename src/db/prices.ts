import { fetchStockQuote, fetchExchangeRate, RateLimitError } from '@/lib/quotes'
import { updateHolding } from './repo'
import { setMeta } from './meta'
import type { Holding } from '@/types/models'

export interface RefreshOptions {
  apikey: string
  /** Currency that GLOBAL_QUOTE stock/ETF prices are quoted in (usually USD). */
  quoteCurrency: string
  /** The user's app currency — prices are converted into this. */
  appCurrency: string
}

export interface RefreshResult {
  updated: number
  failed: Array<{ symbol: string; error: string }>
  rateLimited: boolean
}

const toMinor = (major: number, currency: string) => Math.round(major * (currency === 'JPY' ? 1 : 100))

/**
 * Refresh prices for every holding that has a ticker symbol.
 * - Crypto is fetched directly into the app currency (CURRENCY_EXCHANGE_RATE).
 * - Stocks/ETFs/commodities use GLOBAL_QUOTE (native currency) and are converted
 *   via an FX rate fetched once per refresh and cached.
 * Stops early on a rate-limit so we don't waste the daily quota.
 */
export async function refreshHoldingPrices(holdings: Holding[], opts: RefreshOptions): Promise<RefreshResult> {
  const { apikey, quoteCurrency, appCurrency } = opts
  const result: RefreshResult = { updated: 0, failed: [], rateLimited: false }
  const fxCache = new Map<string, number>()

  const getFx = async (from: string): Promise<number> => {
    if (from.toUpperCase() === appCurrency.toUpperCase()) return 1
    const k = from.toUpperCase()
    if (!fxCache.has(k)) fxCache.set(k, await fetchExchangeRate(from, appCurrency, apikey))
    return fxCache.get(k)!
  }

  for (const h of holdings) {
    const symbol = h.symbol?.trim()
    if (!symbol) continue
    try {
      let priceMajor: number
      if (h.type === 'crypto') {
        priceMajor = await fetchExchangeRate(symbol, appCurrency, apikey)
      } else {
        const native = await fetchStockQuote(symbol, apikey)
        priceMajor = native * (await getFx(quoteCurrency))
      }
      await updateHolding(h.id, { unitPriceMinor: toMinor(priceMajor, appCurrency) })
      result.updated++
    } catch (e) {
      result.failed.push({ symbol, error: (e as Error).message })
      if (e instanceof RateLimitError) {
        result.rateLimited = true
        break // preserve remaining daily quota
      }
    }
  }

  if (result.updated > 0) await setMeta('pricesUpdatedAt', new Date().toISOString())
  return result
}
