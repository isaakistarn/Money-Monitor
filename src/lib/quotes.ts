/**
 * Twelve Data quote helpers. Called directly from the browser (Twelve Data
 * sends permissive CORS headers). Free tier: ~800 requests/day, 8/min, across
 * US (NYSE/NASDAQ), ASX, and many other markets plus crypto and FX.
 *
 * Key advantage over a fixed "quote currency": the /quote endpoint returns the
 * security's own `currency`, so a US stock (USD) and an ASX stock (AUD) are each
 * converted correctly into the app currency.
 */

const BASE = 'https://api.twelvedata.com'

export class RateLimitError extends Error {}

type TDJson = Record<string, unknown>

/** Twelve Data reports problems in-band as { status:'error', code, message }. */
function checkError(j: TDJson): void {
  if (j.status === 'error' || j.code) {
    const msg = String(j.message ?? 'Twelve Data request failed.')
    if (j.code === 429 || /credit|limit|minute|per day/i.test(msg)) throw new RateLimitError(msg)
    throw new Error(msg)
  }
}

export interface ParsedQuote {
  price: number
  currency: string
}

/** Parse a /quote response → latest price + its native currency. */
export function parseQuote(j: TDJson): ParsedQuote {
  checkError(j)
  const price = Number(j.close)
  const currency = String(j.currency ?? '').toUpperCase()
  if (!Number.isFinite(price) || price <= 0) throw new Error('No price returned for that symbol.')
  return { price, currency }
}

/** Parse a /price or /exchange_rate response → a single number. */
export function parsePrice(j: TDJson): number {
  checkError(j)
  const v = Number((j.price ?? j.rate) as string)
  if (!Number.isFinite(v) || v <= 0) throw new Error('No price returned.')
  return v
}

async function tdGet(path: string, params: Record<string, string>): Promise<TDJson> {
  const url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Could not reach Twelve Data (network or CORS).')
  }
  if (!res.ok && res.status !== 429) throw new Error(`Twelve Data error (HTTP ${res.status}).`)
  return (await res.json()) as TDJson
}

/** Latest stock/ETF quote (price + currency). `exchange` disambiguates markets (e.g. ASX). */
export async function fetchStockQuote(symbol: string, apikey: string, exchange?: string): Promise<ParsedQuote> {
  const params: Record<string, string> = { symbol, apikey }
  if (exchange) params.exchange = exchange
  return parseQuote(await tdGet('quote', params))
}

/** Direct price of `from` in `to` currency — used for crypto (e.g. BTC/AUD). */
export async function fetchPair(from: string, to: string, apikey: string): Promise<number> {
  return parsePrice(await tdGet('price', { symbol: `${from}/${to}`, apikey }))
}

/** FX rate from→to (e.g. USD→AUD), to convert a quote into the app currency. */
export async function fetchExchangeRate(from: string, to: string, apikey: string): Promise<number> {
  return parsePrice(await tdGet('exchange_rate', { symbol: `${from}/${to}`, apikey }))
}
