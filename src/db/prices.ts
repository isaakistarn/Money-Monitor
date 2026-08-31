import { fetchYahooQuote, fetchExchangeRate, yahooSymbol, RateLimitError, type FullQuote } from '@/lib/quotes'
import { autoPriceOn } from '@/lib/portfolio'
import { updateHolding } from './repo'
import { setMeta } from './meta'
import type { Holding, HoldingType } from '@/types/models'

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

/** The subset of a holding needed to look its price up. */
export interface PriceLookup {
  symbol: string
  exchange?: string
  type: HoldingType
}

export interface LivePrice {
  /** Price per unit in the APP currency, in minor units — ready to store. */
  priceMinor: number
  /** The raw Yahoo quote, in its native currency (for name/exchange display). */
  quote: FullQuote
  /** True when the native price was converted via an FX rate to get there. */
  converted: boolean
}

/**
 * Converts a native-currency price into the app currency, caching each FX rate
 * for the lifetime of the converter so a refresh of twenty US holdings costs
 * one USD→AUD lookup rather than twenty.
 */
function fxConverter(app: string) {
  const cache = new Map<string, number>()
  return async (price: number, currency: string): Promise<{ price: number; converted: boolean }> => {
    const from = (currency || app).toUpperCase()
    if (from === app) return { price, converted: false }
    if (!cache.has(from)) cache.set(from, await fetchExchangeRate(from, app))
    return { price: price * cache.get(from)!, converted: true }
  }
}

/**
 * Look up one holding's live price, already converted into `appCurrency`.
 *
 * Crypto is quoted directly in the app currency (BTC-AUD); everything else
 * comes back in its native currency and is converted via a Yahoo FX rate.
 * Shared by the bulk refresh and the "auto price" toggle in the editor so both
 * arrive at exactly the same number.
 */
export async function fetchLivePrice(h: PriceLookup, appCurrency: string): Promise<LivePrice> {
  const app = appCurrency.toUpperCase()
  const crypto = h.type === 'crypto'
  const quote = await fetchYahooQuote(yahooSymbol(h.symbol.trim(), h.exchange, { crypto, quoteCurrency: app }))
  const { price, converted } = crypto
    ? { price: quote.price, converted: false }
    : await fxConverter(app)(quote.price, quote.currency)
  return { priceMinor: toMinor(price, app), quote, converted }
}

/**
 * Refresh prices for every holding tracking Yahoo (see `autoPriceOn`).
 * Holdings with the toggle off keep their hand-entered price untouched.
 */
export async function refreshHoldingPrices(holdings: Holding[], opts: RefreshOptions): Promise<RefreshResult> {
  const app = opts.appCurrency.toUpperCase()
  const result: RefreshResult = { updated: 0, failed: [], rateLimited: false }
  const toApp = fxConverter(app)

  for (const h of holdings) {
    if (!autoPriceOn(h)) continue
    const symbol = h.symbol!.trim()
    try {
      const crypto = h.type === 'crypto'
      const q = await fetchYahooQuote(yahooSymbol(symbol, h.exchange, { crypto, quoteCurrency: app }))
      const priceApp = crypto ? q.price : (await toApp(q.price, q.currency)).price
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
