import { describe, expect, it } from 'vitest'
import { parseGlobalQuote, parseExchangeRate, RateLimitError } from './quotes'

describe('alpha vantage response parsing', () => {
  it('parses a global quote price', () => {
    expect(parseGlobalQuote({ 'Global Quote': { '05. price': '255.1234' } })).toBeCloseTo(255.1234)
  })

  it('parses a currency exchange rate', () => {
    expect(parseExchangeRate({ 'Realtime Currency Exchange Rate': { '5. Exchange Rate': '0.79000' } })).toBeCloseTo(0.79)
  })

  it('treats a "Note" as a rate-limit error', () => {
    expect(() => parseGlobalQuote({ Note: 'Thank you for using Alpha Vantage! 5 calls per minute' })).toThrow(RateLimitError)
  })

  it('treats "Information" (daily cap / bad key) as a rate-limit error', () => {
    expect(() => parseExchangeRate({ Information: 'the rate limit is 25 requests per day' })).toThrow(RateLimitError)
  })

  it('throws a normal error on an explicit Error Message', () => {
    expect(() => parseGlobalQuote({ 'Error Message': 'Invalid API call' })).toThrow()
  })

  it('throws when the quote is empty or zero', () => {
    expect(() => parseGlobalQuote({ 'Global Quote': {} })).toThrow()
    expect(() => parseExchangeRate({ 'Realtime Currency Exchange Rate': { '5. Exchange Rate': '0' } })).toThrow()
  })
})
