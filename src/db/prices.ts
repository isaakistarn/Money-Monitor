import { fetchStockQuote, fetchPair, fetchExchangeRate, RateLimitError } from '@/lib/quotes'
import { updateHolding } from './repo'
import { setMeta } from './meta'
import type { Holding } from '@/types/models'

export interface RefreshOptions {
  apikey: string
  /** The user's app currency — every price is converted into this. */
  appCurrency: string
}

export interface RefreshResult {
  updated: number
  failed: Array<{ symbol: string; error: string }>
  rateLimited: boolean
}

const toMinor = (major: number, currency: string) => Math.round(major * (currency === 'JPY' ? 1 : 100))

/**
 * Refresh prices via Twelve Data for every holding that has a ticker symbol.
 * - Crypto is fetched directly in the app currency (e.g. BTC/AUD).
 * - Stocks/ETFs use /quote, which returns the price AND its native currency, so
 *   USD and AUD holdings are each converted correctly via an FX rate (cached).
 * Stops early on a rate-limit so the daily quota isn't wasted.
 */
export async function refreshHoldingPrices(holdings: Holding[], opts: RefreshOptions): Promise<RefreshResult> {
  const { apikey, appCurrency } = opts
  const app = appCurrency.toUpperCase()
  const result: RefreshResult = { updated: 0, failed: [], rateLimited: false }
  const fxCache = new Map<string, number>()

  const toApp = async (priceNative: number, nativeCurrency: string): Promise<number> => {
    const from = (nativeCurrency || app).toUpperCase()
    if (from === app) return priceNative
    if (!fxCache.has(from)) fxCache.set(from, await fetchExchangeRate(from, app, apikey))
    return priceNative * fxCache.get(from)!
  }

  for (const h of holdings) {
    const symbol = h.symbol?.trim()
    if (!symbol) continue
    try {
      let priceApp: number
      if (h.type === 'crypto') {
        priceApp = await fetchPair(symbol, app, apikey)
      } else {
        const { price, currency } = await fetchStockQuote(symbol, apikey, h.exchange?.trim() || undefined)
        priceApp = await toApp(price, currency)
      }
      await updateHolding(h.id, { unitPriceMinor: toMinor(priceApp, app) })
      result.updated++
    } catch (e) {
      result.failed.push({ symbol, error: (e as Error).message })
      if (e instanceof RateLimitError) {
        result.rateLimited = true
        break
      }
    }
  }

  if (result.updated > 0) await setMeta('pricesUpdatedAt', new Date().toISOString())
  return result
}
