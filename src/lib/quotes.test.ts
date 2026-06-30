import { describe, expect, it } from 'vitest'
import { metaToQuote, yahooSymbol, cleanSeries } from './quotes'

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

describe('cleanSeries', () => {
  it('forward-fills null gaps and drops leading nulls', () => {
    expect(cleanSeries([null, 10, null, 12, null])).toEqual([10, 10, 12, 12])
    expect(cleanSeries([1, 2, 3])).toEqual([1, 2, 3])
    expect(cleanSeries([null, null])).toEqual([])
  })
})
