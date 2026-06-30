/**
 * Live quotes via Yahoo Finance, proxied through corsproxy.io so the browser
 * can reach it (Yahoo doesn't send CORS headers). Keyless and free, covering US,
 * ASX, and other markets plus crypto and FX. A light throttle keeps us polite to
 * the public proxy.
 *
 * Symbols use Yahoo conventions: US `AAPL`, ASX `CBA.AX`, crypto `BTC-USD`,
 * FX `USDAUD=X`. The yahooSymbol() helper builds these from a plain
 * symbol + exchange.
 */

const PROXY = 'https://corsproxy.io/?url='
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search'

export class RateLimitError extends Error {}

export interface FullQuote {
  symbol: string
  name: string
  exchange: string
  currency: string
  price: number
  change: number
  percentChange: number
  /** Epoch ms of the last trade, if provided. */
  asOf?: number
}

// Map a user-facing exchange to Yahoo's ticker suffix.
const EX_SUFFIX: Record<string, string> = {
  ASX: '.AX',
  NASDAQ: '', NYSE: '', NYSEARCA: '', ARCA: '', AMEX: '', BATS: '', OTC: '', US: '',
  LSE: '.L', LON: '.L', LONDON: '.L',
  TSX: '.TO', TSXV: '.V',
  NSE: '.NS', BSE: '.BO',
  HKEX: '.HK', HKG: '.HK',
  TSE: '.T', JPX: '.T', TYO: '.T',
  FRA: '.F', FSX: '.F', XETRA: '.DE', ETR: '.DE', GER: '.DE',
  EPA: '.PA', EURONEXT: '.PA', PAR: '.PA',
  SIX: '.SW', SWX: '.SW',
  NZX: '.NZ', NZE: '.NZ',
}

/** Build a Yahoo symbol from a plain symbol + exchange (+ crypto pairing). */
export function yahooSymbol(symbol: string, exchange?: string, opts?: { crypto?: boolean; quoteCurrency?: string }): string {
  let s = symbol.trim().toUpperCase()
  const qc = (opts?.quoteCurrency || 'USD').toUpperCase()
  if (opts?.crypto || s.includes('/')) {
    s = s.replace('/', '-')
    if (!s.includes('-')) s = `${s}-${qc}`
    return s
  }
  if (s.includes('.') || s.includes('=')) return s // already a Yahoo ticker / FX pair
  const suffix = EX_SUFFIX[(exchange || '').trim().toUpperCase()] ?? ''
  return s + suffix
}

// Politeness throttle so bursts don't trip the public proxy's limits.
let lastReq = 0
async function throttle(): Promise<void> {
  const wait = lastReq + 250 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastReq = Date.now()
}

type YMeta = Record<string, unknown>

/** Turn Yahoo chart `meta` into our quote shape (computing day change). */
export function metaToQuote(meta: YMeta): FullQuote {
  const price = Number(meta.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) throw new Error('No price returned for that symbol.')
  // Prefer the regular previous-day close so the headline change is the DAY
  // move, independent of the chart range requested (which sets chartPreviousClose).
  const prev = Number(meta.previousClose ?? meta.chartPreviousClose ?? price)
  const change = price - prev
  return {
    symbol: String(meta.symbol ?? ''),
    name: String(meta.shortName ?? meta.longName ?? meta.symbol ?? ''),
    exchange: String(meta.fullExchangeName ?? meta.exchangeName ?? ''),
    currency: String(meta.currency ?? '').toUpperCase(),
    price,
    change,
    percentChange: prev ? (change / prev) * 100 : 0,
    asOf: meta.regularMarketTime ? Number(meta.regularMarketTime) * 1000 : undefined,
  }
}

/** Forward-fill null gaps and drop leading nulls so a series is plottable. */
export function cleanSeries(raw: Array<number | null>): number[] {
  const out: number[] = []
  let last: number | null = null
  for (const v of raw) {
    if (v != null && Number.isFinite(v)) last = v
    if (last != null) out.push(last)
  }
  return out
}

interface ChartData {
  meta: YMeta
  times: number[]
  closes: number[]
}

async function yahooChart(yahoo: string, range = '1d', interval = '1d'): Promise<ChartData> {
  await throttle()
  const target = `${CHART}${encodeURIComponent(yahoo)}?interval=${interval}&range=${range}`
  let res: Response
  try {
    res = await fetch(`${PROXY}${encodeURIComponent(target)}`)
  } catch {
    throw new Error('Could not reach the price service (proxy or network).')
  }
  if (res.status === 429) throw new RateLimitError('Price service is busy (rate limited). Try again shortly.')
  if (!res.ok) throw new Error(`Price service error (HTTP ${res.status}).`)
  const j = (await res.json()) as {
    chart?: {
      result?: Array<{ meta?: YMeta; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }>
      error?: { description?: string }
    }
  }
  if (j?.chart?.error) throw new Error(j.chart.error.description || 'Symbol not found.')
  const result = j?.chart?.result?.[0]
  if (!result?.meta) throw new Error('Symbol not found.')
  return {
    meta: result.meta,
    times: result.timestamp ?? [],
    closes: cleanSeries(result.indicators?.quote?.[0]?.close ?? []),
  }
}

/** Full quote (price, day change, %) for a Yahoo symbol. */
export async function fetchYahooQuote(yahoo: string): Promise<FullQuote> {
  return metaToQuote((await yahooChart(yahoo)).meta)
}

export interface QuoteWithSeries {
  quote: FullQuote
  closes: number[]
  times: number[]
}

/** One call returns the latest quote AND a price history for charting. */
export async function fetchYahooSeries(yahoo: string, range = '1mo', interval = '1d'): Promise<QuoteWithSeries> {
  const d = await yahooChart(yahoo, range, interval)
  return { quote: metaToQuote(d.meta), closes: d.closes, times: d.times }
}

/** FX rate from→to via Yahoo (e.g. USD→AUD). */
export async function fetchExchangeRate(from: string, to: string): Promise<number> {
  const q = await fetchYahooQuote(`${from.toUpperCase()}${to.toUpperCase()}=X`)
  return q.price
}

/* ------------------------------ Search ------------------------------ */

export interface SymbolMatch {
  symbol: string
  name: string
  exchange: string
  type: string
}

interface SearchJson {
  quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string }>
}

const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'CRYPTOCURRENCY', 'CURRENCY', 'INDEX'])

/** Parse Yahoo's search response into clean matches (skips futures/options noise). */
export function parseSearch(j: SearchJson): SymbolMatch[] {
  return (j.quotes ?? [])
    .filter((x) => x.symbol && (!x.quoteType || SEARCH_TYPES.has(x.quoteType)))
    .map((x) => ({
      symbol: x.symbol as string,
      name: x.shortname || x.longname || (x.symbol as string),
      exchange: x.exchDisp || '',
      type: x.quoteType || '',
    }))
}

/** Look up tickers by company name or symbol (e.g. "commonwealth bank" → CBA.AX). */
export async function searchSymbols(query: string): Promise<SymbolMatch[]> {
  const q = query.trim()
  if (q.length < 2) return []
  await throttle()
  const target = `${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`
  let res: Response
  try {
    res = await fetch(`${PROXY}${encodeURIComponent(target)}`)
  } catch {
    throw new Error('Could not reach the search service.')
  }
  if (res.status === 429) throw new RateLimitError('Search is busy. Try again shortly.')
  if (!res.ok) throw new Error(`Search error (HTTP ${res.status}).`)
  return parseSearch((await res.json()) as SearchJson)
}
