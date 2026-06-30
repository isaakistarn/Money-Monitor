/**
 * Alpha Vantage quote helpers. The API is called directly from the browser
 * (Alpha Vantage sends `Access-Control-Allow-Origin: *`). The free tier is
 * heavily rate limited, so callers should refresh sparingly and handle
 * RateLimitError by stopping and trying again later.
 */

const BASE = 'https://www.alphavantage.co/query'

export class RateLimitError extends Error {}

type AVJson = Record<string, unknown>

/** Alpha Vantage signals problems via these soft fields rather than HTTP codes. */
function checkSoftErrors(j: AVJson): void {
  if (j.Note) throw new RateLimitError('Alpha Vantage rate limit reached. Wait a minute and try again.')
  if (j.Information) throw new RateLimitError(String(j.Information))
  if (j['Error Message']) throw new Error('Alpha Vantage rejected the request — check the symbol.')
}

export function parseGlobalQuote(j: AVJson): number {
  checkSoftErrors(j)
  const quote = j['Global Quote'] as Record<string, string> | undefined
  const v = Number(quote?.['05. price'])
  if (!Number.isFinite(v) || v <= 0) throw new Error('No price returned for that symbol.')
  return v
}

export function parseExchangeRate(j: AVJson): number {
  checkSoftErrors(j)
  const rate = j['Realtime Currency Exchange Rate'] as Record<string, string> | undefined
  const v = Number(rate?.['5. Exchange Rate'])
  if (!Number.isFinite(v) || v <= 0) throw new Error('No exchange rate returned.')
  return v
}

async function avGet(params: Record<string, string>): Promise<AVJson> {
  const url = `${BASE}?${new URLSearchParams(params).toString()}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Could not reach Alpha Vantage (network or CORS).')
  }
  if (!res.ok) throw new Error(`Alpha Vantage error (HTTP ${res.status}).`)
  return (await res.json()) as AVJson
}

/** Latest price for a stock/ETF, in the security's native currency. */
export async function fetchStockQuote(symbol: string, apikey: string): Promise<number> {
  return parseGlobalQuote(await avGet({ function: 'GLOBAL_QUOTE', symbol, apikey }))
}

/** Exchange rate from→to. Works for fiat↔fiat and crypto→fiat. */
export async function fetchExchangeRate(from: string, to: string, apikey: string): Promise<number> {
  return parseExchangeRate(
    await avGet({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: from, to_currency: to, apikey }),
  )
}
