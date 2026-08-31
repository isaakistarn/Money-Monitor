/** All money is stored as integer minor units to avoid floating-point drift. */

export const CURRENCIES: Record<string, { symbol: string; name: string }> = {
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  GBP: { symbol: '£', name: 'British Pound' },
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  INR: { symbol: '₹', name: 'Indian Rupee' },
}

/**
 * Currency for a brand-new install, guessed from the device locale.
 *
 * Only a guess: plenty of locales resolve without a region ('en' rather than
 * 'en-AU'), so the fallback matters as much as the map. It is AUD because that
 * is this app's home; the user can change it in Settings, and `seed.ts` stores
 * the result on first run so an existing install is never re-guessed.
 */
const DEFAULT_CURRENCY = 'AUD'

export function detectCurrency(): string {
  try {
    const region = new Intl.NumberFormat().resolvedOptions().locale.split('-')[1]
    const map: Record<string, string> = {
      GB: 'GBP', US: 'USD', AU: 'AUD', CA: 'CAD', JP: 'JPY', IN: 'INR',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
    }
    return (region && map[region]) || DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

/** Format minor units for display. JPY has 0 fraction digits, others 2. */
export function formatMoney(
  minor: number,
  currency = DEFAULT_CURRENCY,
  opts: { signed?: boolean; compact?: boolean } = {},
): string {
  const fraction = currency === 'JPY' ? 0 : 2
  const divisor = currency === 'JPY' ? 1 : 100
  const value = minor / divisor
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
    notation: opts.compact ? 'compact' : 'standard',
  })
  if (opts.signed && minor > 0) return '+' + formatter.format(value)
  return formatter.format(value)
}

/** Parse a user-typed string ("12.34", "1,200") into minor units. Returns NaN if invalid. */
export function parseMoney(input: string, currency = DEFAULT_CURRENCY): number {
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return NaN
  const multiplier = currency === 'JPY' ? 1 : 100
  return Math.round(value * multiplier)
}

/** Minor units -> a plain editable string ("1234" pence -> "12.34"). */
export function minorToInput(minor: number, currency = DEFAULT_CURRENCY): string {
  if (currency === 'JPY') return String(minor)
  return (minor / 100).toFixed(2)
}

export function currencySymbol(currency = DEFAULT_CURRENCY): string {
  return CURRENCIES[currency]?.symbol ?? currency
}
