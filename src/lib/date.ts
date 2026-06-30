/** Date helpers — all month bucketing is done in the device's LOCAL timezone. */

export function todayISO(): string {
  return toISODate(new Date())
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'yyyy-mm' bucket from an ISO date string, in local time. */
export function ymOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function currentYm(): string {
  return ymOf(todayISO())
}

/** Human label, e.g. "Jun 2026". */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}

/** Friendly date label for rows: "Today", "Yesterday", or "12 Jun". */
export function relativeDateLabel(isoDate: string): string {
  const today = todayISO()
  if (isoDate === today) return 'Today'
  const d = new Date(isoDate + 'T00:00:00')
  const yest = new Date()
  yest.setDate(yest.getDate() - 1)
  if (isoDate === toISODate(yest)) return 'Yesterday'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Last N month buckets ending at the current month, oldest first. */
export function recentYms(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(toISODate(d).slice(0, 7))
  }
  return out
}

export function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function addMonthsISO(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return toISODate(d)
}
