import { fetchYahooQuote, fetchExchangeRate, yahooSymbol, RateLimitError } from '@/lib/quotes'
import { updateHolding } from './repo'
import { setMeta } from './meta'
import type { Holding } from '@/types/models'

export interface RefreshOptions {
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
 * Refresh holding prices via Yahoo Finance.
 * - Crypto is fetched directly in the app currency (e.g. BTC-AUD).
 * - Stocks/ETFs are fetched in their native currency, then converted to the app
 *   currency via a Yahoo FX rate (cached per currency for the run).
 */
export async function refreshHoldingPrices(holdings: Holding[], opts: RefreshOptions): Promise<RefreshResult> {
  const app = opts.appCurrency.toUpperCase()
  const result: RefreshResult = { updated: 0, failed: [], rateLimited: false }
  const fxCache = new Map<string, number>()

  const toApp = async (price: number, currency: string): Promise<number> => {
    const from = (currency || app).toUpperCase()
    if (from === app) return price
    if (!fxCache.has(from)) fxCache.set(from, await fetchExchangeRate(from, app))
    return price * fxCache.get(from)!
  }

  for (const h of holdings) {
    const symbol = h.symbol?.trim()
    if (!symbol) continue
    try {
      const crypto = h.type === 'crypto'
      const ysym = yahooSymbol(symbol, h.exchange, { crypto, quoteCurrency: app })
      const q = await fetchYahooQuote(ysym)
      const priceApp = crypto ? q.price : await toApp(q.price, q.currency)
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
