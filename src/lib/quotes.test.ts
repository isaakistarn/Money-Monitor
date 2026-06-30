import { describe, expect, it } from 'vitest'
import { parseQuote, parsePrice, RateLimitError } from './quotes'

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

  it('throws when the price is missing or zero', () => {
    expect(() => parseQuote({ currency: 'USD' })).toThrow()
    expect(() => parsePrice({ price: '0' })).toThrow()
  })
})
