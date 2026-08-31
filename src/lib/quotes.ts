/**
 * Live quotes via Yahoo Finance, reached through a CORS proxy (Yahoo doesn't
 * send CORS headers). Keyless and free, covering US, ASX, and other markets
 * plus crypto and FX. A light throttle keeps us polite to the proxy.
 *
 * RESILIENCE: public CORS proxies are unreliable — they rate-limit, go down,
 * or (as corsproxy.io did) start demanding an API key and answer HTTP 401 to
 * everyone. So requests walk a FAILOVER CHAIN of proxies (see proxies.ts),
 * skipping any that refuses, is throttling, or returns something that isn't
 * Yahoo JSON, and sticking with the first that works for the rest of the
 * session. An error only surfaces once every proxy has been tried.
 *
 * SECURITY: prefer a SELF-HOSTED proxy via VITE_QUOTES_PROXY (see
 * proxy/cloudflare-worker.js + DEPLOY.md). When it is set it is used ALONE —
 * the public chain is not consulted at all, because those are *open* proxies:
 * they see every ticker you follow, could rewrite prices, and — because they
 * must be allow-listed in the CSP — give injected code an exfiltration route.
 * The build narrows the CSP to your worker's origin automatically
 * (vite.config.ts).
 *
 * Symbols use Yahoo conventions: US `AAPL`, ASX `CBA.AX`, crypto `BTC-USD`,
 * FX `USDAUD=X`. The yahooSymbol() helper builds these from a plain
 * symbol + exchange.
 */

import { FALLBACK_PROXIES } from './proxies'

/**
 * A self-hosted proxy replaces the public chain outright (privacy: no third
 * party should see your tickers); otherwise we fail over across the public ones.
 */
const SELF_HOSTED = import.meta.env.VITE_QUOTES_PROXY
const PROXIES: readonly string[] = SELF_HOSTED ? [SELF_HOSTED] : FALLBACK_PROXIES

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search'
const TRENDING = 'https://query1.finance.yahoo.com/v1/finance/trending/'

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
  previousClose?: number
  dayHigh?: number
  dayLow?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  volume?: number
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

export type MarketSection = 'ASX' | 'US' | 'Crypto' | 'Other'

// Crypto pairs end in a quote currency (BTC-USD, ETH-AUD…). Share-class dashes
// like BRK-B don't match, so they stay classified by exchange.
const CRYPTO_PAIR = /-(USD|USDT|USDC|AUD|EUR|GBP|NZD|CAD|JPY|BTC|ETH)$/

/**
 * Classify a watchlist entry into a market section. Derived from the symbol +
 * exchange the user stored (same inputs as yahooSymbol), so it needs no
 * network call and works before quotes load.
 */
export function marketOf(symbol: string, exchange?: string): MarketSection {
  const s = symbol.trim().toUpperCase()
  const ex = (exchange || '').trim().toUpperCase()
  if (s.includes('/') || CRYPTO_PAIR.test(s)) return 'Crypto'
  if (ex === 'ASX' || s.endsWith('.AX')) return 'ASX'
  if (s.includes('.') || s.includes('=')) return 'Other' // non-US Yahoo suffix or FX pair
  return (EX_SUFFIX[ex] ?? '') === '' ? 'US' : 'Other' // mirrors yahooSymbol's default
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

/**
 * Statuses that say "this PROXY can't serve you right now" rather than
 * "Yahoo answered". 401/402/403 is a proxy demanding an API key (corsproxy.io's
 * failure mode), 429 is throttling, 5xx is the proxy or its upstream hop being
 * down. All of them mean: try the next proxy in the chain.
 */
const PROXY_TROUBLE = (status: number) =>
  status === 401 || status === 402 || status === 403 || status === 407 || status === 429 || status >= 500

/**
 * A proxy's own error envelope, e.g. `{"error":"A valid API key is required"}`
 * served with HTTP 200. Yahoo never puts a *string* at the top-level `error`
 * key — its errors live at `chart.error` — so this only catches proxies.
 */
function isProxyEnvelope(json: unknown): boolean {
  return typeof (json as { error?: unknown })?.error === 'string'
}

/**
 * Index of the proxy that last worked. Sticky for the session so a healthy
 * proxy isn't re-discovered on every request, and so we don't hammer dead ones.
 */
let activeProxy = 0

/**
 * Per-attempt budget. Without it a proxy that accepts the connection and then
 * hangs (a common failure for these free services) would stall the whole chain
 * for the browser's default timeout — the user watches a spinner for a minute
 * instead of failing over in seconds.
 */
const ATTEMPT_TIMEOUT_MS = 8_000

/** The proxy currently in use — surfaced in error messages and diagnostics. */
export function activeProxyOrigin(): string {
  return new URL(PROXIES[activeProxy] ?? PROXIES[0]).origin
}

/**
 * GET `target` through the proxy chain and parse the JSON.
 *
 * Walks every proxy starting from the last known-good one, skipping any that
 * refuses, throttles, or hands back something that isn't a JSON object. Only
 * when the whole chain has been exhausted does it throw — as a RateLimitError
 * if throttling was the reason, so callers can back off rather than retry.
 * `service` names the feature for the user-facing message ("Price service").
 */
async function proxyJson(target: string, service: string): Promise<unknown> {
  let rateLimited = false
  let lastStatus = 0

  for (let i = 0; i < PROXIES.length; i++) {
    const idx = (activeProxy + i) % PROXIES.length
    await throttle()
    let res: Response
    try {
      res = await fetch(PROXIES[idx] + encodeURIComponent(target), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
    } catch {
      // Network error, blocked by CORS/CSP, or our own timeout. None of these
      // distinguish themselves to script, so all mean: try the next proxy.
      continue
    }
    if (PROXY_TROUBLE(res.status)) {
      if (res.status === 429) rateLimited = true
      lastStatus = res.status
      continue
    }
    // Other non-OK statuses (400/404) are usually Yahoo's own answer and carry
    // a useful JSON body, so they fall through to parsing.
    let json: unknown
    try {
      json = await res.json()
    } catch {
      lastStatus = res.status // proxy returned HTML (an interstitial or error page)
      continue
    }
    if (!json || typeof json !== 'object' || isProxyEnvelope(json)) {
      lastStatus = res.status
      continue
    }
    activeProxy = idx // stick with whatever answered
    return json
  }

  // Every proxy is exhausted. When they're all public ones this is routine —
  // they share free quotas — so the message points at the durable fix rather
  // than just telling the user to try again.
  const hint = SELF_HOSTED ? '' : ' Set up your own quote proxy for reliable prices (see DEPLOY.md).'
  if (rateLimited) throw new RateLimitError(`${service} is rate limited right now.${hint}`)
  throw new Error(
    (lastStatus
      ? `Could not reach ${service.toLowerCase()} — every proxy failed (last: HTTP ${lastStatus}).`
      : `Could not reach ${service.toLowerCase()} (proxy, network, or CORS).`) + hint,
  )
}

type YMeta = Record<string, unknown>

/** Positive finite number from Yahoo meta, else undefined (fields come and go per asset class). */
function optNum(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

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
    previousClose: optNum(meta.previousClose ?? meta.chartPreviousClose),
    dayHigh: optNum(meta.regularMarketDayHigh),
    dayLow: optNum(meta.regularMarketDayLow),
    fiftyTwoWeekHigh: optNum(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: optNum(meta.fiftyTwoWeekLow),
    volume: optNum(meta.regularMarketVolume),
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

/**
 * Like cleanSeries, but keeps each point's timestamp aligned with its price so
 * the value and the time axis never drift apart. Yahoo gives times in seconds;
 * we return epoch **milliseconds** ready for charting. Leading nulls (and their
 * timestamps) are dropped together; interior gaps are forward-filled.
 */
export function alignSeries(
  rawCloses: Array<number | null>,
  rawTimes: number[],
): { closes: number[]; times: number[] } {
  const closes: number[] = []
  const times: number[] = []
  let last: number | null = null
  for (let i = 0; i < rawCloses.length; i++) {
    const v = rawCloses[i]
    if (v != null && Number.isFinite(v)) last = v
    if (last != null) {
      closes.push(last)
      times.push((rawTimes[i] ?? 0) * 1000)
    }
  }
  return { closes, times }
}

interface ChartData {
  meta: YMeta
  /** Epoch ms, aligned 1:1 with `closes`. */
  times: number[]
  closes: number[]
}

async function yahooChart(yahoo: string, range = '1d', interval = '1d'): Promise<ChartData> {
  const target = `${CHART}${encodeURIComponent(yahoo)}?interval=${interval}&range=${range}`
  const j = (await proxyJson(target, 'Price service')) as {
    chart?: {
      result?: Array<{ meta?: YMeta; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }>
      error?: { description?: string }
    }
  }
  if (j?.chart?.error) throw new Error(j.chart.error.description || 'Symbol not found.')
  const result = j?.chart?.result?.[0]
  if (!result?.meta) throw new Error('Symbol not found.')
  const { closes, times } = alignSeries(
    result.indicators?.quote?.[0]?.close ?? [],
    result.timestamp ?? [],
  )
  return { meta: result.meta, times, closes }
}

/** Full quote (price, day change, %) for a Yahoo symbol. */
export async function fetchYahooQuote(yahoo: string): Promise<FullQuote> {
  return metaToQuote((await yahooChart(yahoo)).meta)
}

export interface QuoteWithSeries {
  quote: FullQuote
  closes: number[]
  /** Epoch ms, aligned 1:1 with `closes`. */
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
  const target = `${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`
  return parseSearch((await proxyJson(target, 'Search service')) as SearchJson)
}

/* ------------------------------- News ------------------------------- */

export interface NewsItem {
  id: string
  title: string
  publisher: string
  link: string
  /** Epoch ms. */
  publishedAt: number
  thumbnail?: string
  tickers: string[]
}

interface NewsJson {
  news?: Array<{
    uuid?: string
    title?: string
    publisher?: string
    link?: string
    providerPublishTime?: number
    thumbnail?: { resolutions?: Array<{ url?: string; width?: number }> }
    relatedTickers?: string[]
  }>
}

/** Smallest thumbnail that's still ≥ the wanted width (news list renders ~140px). */
function pickThumb(res?: Array<{ url?: string; width?: number }>): string | undefined {
  if (!res?.length) return undefined
  const usable = res.filter((r) => r.url && r.url.startsWith('https://'))
  if (!usable.length) return undefined
  const fit = usable.filter((r) => (r.width ?? 0) >= 140).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (fit[0] ?? usable[usable.length - 1]).url
}

/** Parse Yahoo's search response `news` array into clean items. */
export function parseNews(j: NewsJson): NewsItem[] {
  return (j.news ?? [])
    .filter((n) => n.title && n.link && n.link.startsWith('https://'))
    .map((n) => ({
      id: n.uuid || (n.link as string),
      title: n.title as string,
      publisher: n.publisher || 'Yahoo Finance',
      link: n.link as string,
      publishedAt: (n.providerPublishTime ?? 0) * 1000,
      thumbnail: pickThumb(n.thumbnail?.resolutions),
      tickers: (n.relatedTickers ?? []).slice(0, 4),
    }))
}

/** Latest news for a query — a ticker ("CBA.AX") or a topic ("stock market"). */
export async function fetchNews(query: string, count = 8): Promise<NewsItem[]> {
  const target = `${SEARCH}?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&listsCount=0`
  return parseNews((await proxyJson(target, 'News service')) as NewsJson)
}

/* ----------------------------- Trending ----------------------------- */

interface TrendingJson {
  finance?: { result?: Array<{ quotes?: Array<{ symbol?: string }> }> }
}

/** Parse Yahoo's trending response into a symbol list. */
export function parseTrending(j: TrendingJson): string[] {
  return (j.finance?.result?.[0]?.quotes ?? [])
    .map((q) => q.symbol)
    .filter((s): s is string => !!s)
}

/** Trending Yahoo symbols for a region (e.g. 'US', 'AU'). */
export async function fetchTrending(region: string, count = 6): Promise<string[]> {
  const target = `${TRENDING}${encodeURIComponent(region.toUpperCase())}?count=${count}`
  return parseTrending((await proxyJson(target, 'Trending service')) as TrendingJson).slice(0, count)
}
