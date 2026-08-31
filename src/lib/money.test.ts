import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectCurrency, formatMoney, parseMoney, minorToInput, currencySymbol, CURRENCIES } from './money'

/** Pretend the device resolves to `locale`, the way a browser would. */
function withLocale(locale: string | null) {
  const real = Intl.NumberFormat
  vi.stubGlobal(
    'Intl',
    {
      ...Intl,
      NumberFormat: class {
        resolvedOptions() {
          if (locale === null) throw new Error('Intl unavailable')
          return { locale }
        }
      },
    } as unknown as typeof Intl,
  )
  return () => vi.stubGlobal('Intl', { ...Intl, NumberFormat: real } as unknown as typeof Intl)
}

afterEach(() => vi.unstubAllGlobals())

describe('detectCurrency', () => {
  it('maps a region when the locale carries one', () => {
    withLocale('en-AU')
    expect(detectCurrency()).toBe('AUD')
    withLocale('en-GB')
    expect(detectCurrency()).toBe('GBP')
    withLocale('de-DE')
    expect(detectCurrency()).toBe('EUR')
  })

  it('falls back to AUD when the locale has no region', () => {
    // The common real-world case — 'en' rather than 'en-AU' — and the reason
    // the fallback matters as much as the region map.
    withLocale('en')
    expect(detectCurrency()).toBe('AUD')
  })

  it('falls back to AUD for an unmapped region', () => {
    withLocale('pt-BR')
    expect(detectCurrency()).toBe('AUD')
  })

  it('falls back to AUD rather than throwing when Intl is unavailable', () => {
    withLocale(null)
    expect(detectCurrency()).toBe('AUD')
  })
})

describe('money helpers default to AUD', () => {
  it('formats and parses without an explicit currency', () => {
    expect(formatMoney(123_45)).toContain('123.45')
    expect(currencySymbol()).toBe('A$')
    expect(parseMoney('12.34')).toBe(1234)
    expect(minorToInput(1234)).toBe('12.34')
  })

  it('still honours an explicit currency', () => {
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('JPY')).toBe('¥')
    // JPY has no minor unit, so parsing and rendering stay whole.
    expect(parseMoney('1200', 'JPY')).toBe(1200)
    expect(minorToInput(1200, 'JPY')).toBe('1200')
  })
})

describe('currency list', () => {
  it('offers AUD first, so it heads the Settings dropdown', () => {
    expect(Object.keys(CURRENCIES)[0]).toBe('AUD')
  })
})
