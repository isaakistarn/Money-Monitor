import { describe, expect, it } from 'vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { metaToQuote, yahooSymbol, marketOf, cleanSeries, alignSeries, parseSearch, parseNews, parseTrending } from './quotes'
import { FALLBACK_PROXIES } from './proxies'

describe('yahoo chart meta → quote', () => {
  it('computes price, day change and percent from meta', () => {
    const q = metaToQuote({
      symbol: 'AAPL', shortName: 'Apple Inc.', fullExchangeName: 'NasdaqGS', currency: 'USD',
      regularMarketPrice: 281.74, chartPreviousClose: 283.78, regularMarketTime: 1_700_000_000,
    })
    expect(q.price).toBeCloseTo(281.74)
    expect(q.name).toBe('Apple Inc.')
    expect(q.currency).toBe('USD')
    expect(q.change).toBeCloseTo(281.74 - 283.78)
    expect(q.percentChange).toBeCloseTo(((281.74 - 283.78) / 283.78) * 100)
    expect(q.asOf).toBe(1_700_000_000 * 1000)
  })

  it('reads AUD for an ASX quote', () => {
    const q = metaToQuote({ symbol: 'CBA.AX', currency: 'AUD', exchangeName: 'ASX', regularMarketPrice: 164.62, previousClose: 163 })
    expect(q.currency).toBe('AUD')
    expect(q.price).toBeCloseTo(164.62)
  })

  it('throws when the price is missing or zero', () => {
    expect(() => metaToQuote({ currency: 'USD' })).toThrow()
    expect(() => metaToQuote({ regularMarketPrice: 0 })).toThrow()
  })
})

describe('yahooSymbol builder', () => {
  it('leaves US tickers untouched', () => {
    expect(yahooSymbol('AAPL')).toBe('AAPL')
    expect(yahooSymbol('aapl', 'NASDAQ')).toBe('AAPL')
  })

  it('adds the ASX suffix', () => {
    expect(yahooSymbol('CBA', 'ASX')).toBe('CBA.AX')
    expect(yahooSymbol('bhp', 'ASX')).toBe('BHP.AX')
  })

  it('respects an already-suffixed Yahoo ticker', () => {
    expect(yahooSymbol('CBA.AX', 'ASX')).toBe('CBA.AX')
    expect(yahooSymbol('USDAUD=X')).toBe('USDAUD=X')
  })

  it('builds crypto pairs', () => {
    expect(yahooSymbol('BTC/USD')).toBe('BTC-USD')
    expect(yahooSymbol('ETH', undefined, { crypto: true, quoteCurrency: 'AUD' })).toBe('ETH-AUD')
  })

  it('maps other exchanges (LSE, TSX)', () => {
    expect(yahooSymbol('HSBA', 'LSE')).toBe('HSBA.L')
    expect(yahooSymbol('SHOP', 'TSX')).toBe('SHOP.TO')
  })
})

describe('marketOf', () => {
  it('classifies ASX by exchange or .AX suffix', () => {
    expect(marketOf('CBA', 'ASX')).toBe('ASX')
    expect(marketOf('BHP.AX')).toBe('ASX')
    expect(marketOf('cba.ax')).toBe('ASX')
  })

  it('classifies US tickers (default and US exchanges)', () => {
    expect(marketOf('AAPL')).toBe('US')
    expect(marketOf('NVDA', 'NASDAQ')).toBe('US')
    expect(marketOf('BRK-B')).toBe('US') // share-class dash is not a crypto pair
  })

  it('classifies crypto pairs in either notation', () => {
    expect(marketOf('BTC/USD')).toBe('Crypto')
    expect(marketOf('ETH-USD')).toBe('Crypto')
    expect(marketOf('SOL-AUD')).toBe('Crypto')
  })

  it('puts other exchanges and FX in Other', () => {
    expect(marketOf('HSBA', 'LSE')).toBe('Other')
    expect(marketOf('SHOP.TO')).toBe('Other')
    expect(marketOf('USDAUD=X')).toBe('Other')
  })
})

describe('parseSearch', () => {
  it('maps matches and skips futures/options noise', () => {
    const r = parseSearch({
      quotes: [
        { symbol: 'CBA.AX', shortname: 'CWLTH BANK FPO [CBA]', exchDisp: 'Australian', quoteType: 'EQUITY' },
        { symbol: 'AAPL', longname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
        { symbol: 'ESZ24.CME', shortname: 'E-mini', exchDisp: 'CME', quoteType: 'FUTURE' },
        { shortname: 'no symbol', quoteType: 'EQUITY' },
      ],
    })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ symbol: 'CBA.AX', name: 'CWLTH BANK FPO [CBA]', exchange: 'Australian' })
    expect(r[1]).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.' })
  })

  it('handles an empty response', () => {
    expect(parseSearch({})).toEqual([])
  })
})

describe('parseNews', () => {
  it('maps news items, picks a fitting thumbnail, and converts s→ms', () => {
    const r = parseNews({
      news: [
        {
          uuid: 'abc',
          title: 'RBA holds rates',
          publisher: 'Reuters',
          link: 'https://finance.yahoo.com/news/rba',
          providerPublishTime: 1_700_000_000,
          thumbnail: {
            resolutions: [
              { url: 'https://s.yimg.com/big.jpg', width: 1200 },
              { url: 'https://s.yimg.com/small.jpg', width: 140 },
            ],
          },
          relatedTickers: ['CBA.AX', 'WBC.AX'],
        },
        { uuid: 'no-link', title: 'Missing link' },
        { uuid: 'http-only', title: 'Insecure', link: 'http://example.com' },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      id: 'abc',
      title: 'RBA holds rates',
      publisher: 'Reuters',
      publishedAt: 1_700_000_000 * 1000,
      thumbnail: 'https://s.yimg.com/small.jpg',
      tickers: ['CBA.AX', 'WBC.AX'],
    })
  })

  it('handles an empty response and missing optional fields', () => {
    expect(parseNews({})).toEqual([])
    const r = parseNews({ news: [{ title: 'Bare', link: 'https://x.com/a' }] })
    expect(r[0]).toMatchObject({ id: 'https://x.com/a', publisher: 'Yahoo Finance', publishedAt: 0, tickers: [] })
    expect(r[0].thumbnail).toBeUndefined()
  })
})

describe('parseTrending', () => {
  it('extracts symbols and skips empties', () => {
    const r = parseTrending({
      finance: { result: [{ quotes: [{ symbol: 'BHP.AX' }, {}, { symbol: 'NVDA' }] }] },
    })
    expect(r).toEqual(['BHP.AX', 'NVDA'])
  })

  it('handles an empty response', () => {
    expect(parseTrending({})).toEqual([])
    expect(parseTrending({ finance: {} })).toEqual([])
  })
})

describe('cleanSeries', () => {
  it('forward-fills null gaps and drops leading nulls', () => {
    expect(cleanSeries([null, 10, null, 12, null])).toEqual([10, 10, 12, 12])
    expect(cleanSeries([1, 2, 3])).toEqual([1, 2, 3])
    expect(cleanSeries([null, null])).toEqual([])
  })
})

describe('alignSeries', () => {
  it('keeps timestamps aligned with prices and converts s→ms', () => {
    // Leading null drops BOTH the price and its timestamp; interior null is
    // forward-filled but keeps its own timestamp.
    const r = alignSeries([null, 10, null, 12], [100, 200, 300, 400])
    expect(r.closes).toEqual([10, 10, 12])
    expect(r.times).toEqual([200_000, 300_000, 400_000])
  })

  it('closes stay identical to cleanSeries', () => {
    const raw = [null, 5, 6, null, 8]
    const times = [1, 2, 3, 4, 5]
    expect(alignSeries(raw, times).closes).toEqual(cleanSeries(raw))
  })

  it('all-null yields empty arrays', () => {
    expect(alignSeries([null, null], [1, 2])).toEqual({ closes: [], times: [] })
  })
})

/* --------------------------- Proxy failover ---------------------------- */

/**
 * A fetch stub that answers per proxy prefix, recording the order tried.
 * `responder` receives the attempt index, because the module sticks with the
 * last proxy that worked — so which entry is tried first varies between tests
 * and only the ORDER of attempts is stable.
 */
function stubProxies(responder: (attempt: number) => Response | Promise<Response>) {
  const tried: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    tried.push(FALLBACK_PROXIES.find((p) => String(url).startsWith(p))!)
    return responder(tried.length - 1)
  })
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  return tried
}

const chartBody = JSON.stringify({
  chart: { result: [{ meta: { symbol: 'AAPL', regularMarketPrice: 100, previousClose: 100 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] },
})
const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } })

describe('proxy failover', () => {
  // The proxy chain is fixed at module load from VITE_QUOTES_PROXY, so these
  // tests stub the env and re-import rather than reading whatever the machine
  // happens to have configured — otherwise a developer with a self-hosted proxy
  // in .env.local sees a one-entry chain and every failover test fails locally
  // while CI passes.
  let quotes: typeof import('./quotes')

  async function loadWith(proxy: string) {
    vi.stubEnv('VITE_QUOTES_PROXY', proxy)
    vi.resetModules()
    quotes = await import('./quotes')
  }

  beforeEach(() => loadWith('')) // '' is falsy → the public fallback chain
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('skips a proxy that demands an API key (the HTTP 401 that broke prices)', async () => {
    const tried = stubProxies((n) => (n === 0 ? json('{"error":"A valid API key is required."}', 401) : json(chartBody)))
    expect((await quotes.fetchYahooQuote('AAPL')).price).toBe(100)
    expect(tried).toHaveLength(2)
  })

  it('skips a proxy whose error envelope arrives with HTTP 200', async () => {
    const tried = stubProxies((n) => (n === 0 ? json('{"error":"A valid API key is required."}') : json(chartBody)))
    await expect(quotes.fetchYahooQuote('AAPL')).resolves.toMatchObject({ price: 100 })
    expect(tried).toHaveLength(2)
  })

  it('skips a proxy that returns an HTML error page', async () => {
    const tried = stubProxies((n) => (n === 0 ? new Response('<html>502</html>', { status: 200 }) : json(chartBody)))
    await expect(quotes.fetchYahooQuote('AAPL')).resolves.toMatchObject({ price: 100 })
    expect(tried).toHaveLength(2)
  })

  it('sticks with the proxy that worked instead of retrying dead ones', async () => {
    const tried = stubProxies((n) => (n === 0 ? json('{}', 401) : json(chartBody)))
    await quotes.fetchYahooQuote('AAPL')
    await quotes.fetchYahooQuote('MSFT')
    // 2 attempts for the first call, then 1 for the second — not 2 again.
    expect(tried).toHaveLength(3)
  })

  it('reports rate limiting only once every proxy has throttled', async () => {
    const tried = stubProxies(() => json('{}', 429))
    await expect(quotes.fetchYahooQuote('AAPL')).rejects.toBeInstanceOf(quotes.RateLimitError)
    expect(tried).toHaveLength(FALLBACK_PROXIES.length) // every one was given a chance
  })

  it('surfaces a plain error when every proxy is down', async () => {
    stubProxies(() => json('{}', 503))
    const err = await quotes.fetchYahooQuote('AAPL').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(quotes.RateLimitError)
    expect(String(err.message)).toMatch(/every proxy failed/i)
  })

  it("passes Yahoo's own symbol error through instead of blaming the proxy", async () => {
    stubProxies(() => json(JSON.stringify({ chart: { error: { description: 'No data found, symbol may be delisted' } } }), 404))
    await expect(quotes.fetchYahooQuote('NOPE')).rejects.toThrow(/delisted/)
  })

  it('uses a self-hosted proxy ALONE, never falling back to the public chain', async () => {
    const SELF = 'https://my-worker.workers.dev/?url='
    await loadWith(SELF)
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return json('{}', 500) // always fails, so any fallback would show up
      }) as unknown as typeof fetch,
    )
    await expect(quotes.fetchYahooQuote('AAPL')).rejects.toThrow()
    expect(urls).toHaveLength(1)
    expect(urls[0].startsWith(SELF)).toBe(true)
    // The privacy guarantee: no public proxy is contacted when self-hosting.
    expect(urls.some((u) => FALLBACK_PROXIES.some((p) => u.startsWith(p)))).toBe(false)
  })
})
