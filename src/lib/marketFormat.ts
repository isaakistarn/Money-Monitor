/** Shared display helpers for the Markets dashboard. */

/** Price in the instrument's own currency, e.g. "$164.62" / "A$28.10". */
export function nativeMoney(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: price !== 0 && Math.abs(price) < 1 ? 4 : 2,
    }).format(price)
  } catch {
    return `${price.toFixed(2)} ${currency}`
  }
}

/** Plain number for index levels (points, not money), e.g. "8,514.20". */
export function indexPoints(v: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v)
}

/** Compact large counts, e.g. volume "12.4M". */
export function compactNumber(v: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v)
}

/** Relative "as of" label: "just now", "5 min ago", "3 h ago", then a date. */
export function asOfLabel(ms?: number): string {
  if (!ms) return ''
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** First→last move of a series, for coloring sparklines and range stats. */
export function pctOf(values: number[]): { up: boolean; pct: number } {
  if (!values || values.length < 2) return { up: true, pct: 0 }
  const first = values[0]
  const last = values[values.length - 1]
  return { up: last >= first, pct: first ? ((last - first) / first) * 100 : 0 }
}
