/** All money is stored as integer minor units to avoid floating-point drift. */

export const CURRENCIES: Record<string, { symbol: string; name: string }> = {
  GBP: { symbol: '£', name: 'British Pound' },
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  INR: { symbol: '₹', name: 'Indian Rupee' },
}

export function detectCurrency(): string {
  try {
    const region = new Intl.NumberFormat().resolvedOptions().locale.split('-')[1]
    const map: Record<string, string> = {
      GB: 'GBP', US: 'USD', AU: 'AUD', CA: 'CAD', JP: 'JPY', IN: 'INR',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
    }
    return (region && map[region]) || 'GBP'
  } catch {
    return 'GBP'
  }
}

/** Format minor units for display. JPY has 0 fraction digits, others 2. */
export function formatMoney(
  minor: number,
  currency = 'GBP',
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
export function parseMoney(input: string, currency = 'GBP'): number {
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return NaN
  const multiplier = currency === 'JPY' ? 1 : 100
  return Math.round(value * multiplier)
}

/** Minor units -> a plain editable string ("1234" pence -> "12.34"). */
export function minorToInput(minor: number, currency = 'GBP'): string {
  if (currency === 'JPY') return String(minor)
  return (minor / 100).toFixed(2)
}

export function currencySymbol(currency = 'GBP'): string {
  return CURRENCIES[currency]?.symbol ?? currency
}
