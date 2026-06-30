import { describe, expect, it } from 'vitest'
import { parseQuote, parsePrice, parseFullQuote, RateLimitError } from './quotes'

describe('twelve data response parsing', () => {
  it('parses a quote price and its native currency', () => {
    const q = parseQuote({ symbol: 'AAPL', close: '255.1234', currency: 'USD', exchange: 'NASDAQ' })
    expect(q.price).toBeCloseTo(255.1234)
    expect(q.currency).toBe('USD')
  })

  it('reads AUD currency for an ASX quote', () => {
    const q = parseQuote({ symbol: 'CBA', close: '120.50', currency: 'AUD', exchange: 'ASX' })
    expect(q.price).toBeCloseTo(120.5)
    expect(q.currency).toBe('AUD')
  })

  it('parses a /price (crypto) and /exchange_rate response', () => {
    expect(parsePrice({ price: '95000.50' })).toBeCloseTo(95000.5)
    expect(parsePrice({ rate: '0.65' })).toBeCloseTo(0.65)
  })

  it('treats a 429 / credit-limit error as a rate-limit error', () => {
    expect(() => parseQuote({ status: 'error', code: 429, message: 'You have run out of API credits' })).toThrow(RateLimitError)
    expect(() => parsePrice({ status: 'error', code: 400, message: 'API credit limit per minute reached' })).toThrow(RateLimitError)
  })

  it('throws a normal error for other failures', () => {
    expect(() => parseQuote({ status: 'error', code: 404, message: 'symbol not found' })).toThrow()
  })

  it('parses a full watchlist quote (price, change, %, market state)', () => {
    const q = parseFullQuote({
      symbol: 'CBA', name: 'Commonwealth Bank', exchange: 'ASX', currency: 'AUD',
      close: '120.50', change: '1.25', percent_change: '1.05', is_market_open: true,
    })
    expect(q).toMatchObject({ symbol: 'CBA', name: 'Commonwealth Bank', exchange: 'ASX', currency: 'AUD', isMarketOpen: true })
    expect(q.price).toBeCloseTo(120.5)
    expect(q.change).toBeCloseTo(1.25)
    expect(q.percentChange).toBeCloseTo(1.05)
  })

  it('full quote surfaces rate-limit errors too', () => {
    expect(() => parseFullQuote({ status: 'error', code: 429, message: 'out of API credits' })).toThrow(RateLimitError)
  })

  it('throws when the price is missing or zero', () => {
    expect(() => parseQuote({ currency: 'USD' })).toThrow()
    expect(() => parsePrice({ price: '0' })).toThrow()
  })
})
