import type { Allocation } from '@/types/models'

/**
 * Pure resolver: turn a pay amount + allocation rules into concrete transfer
 * amounts (in minor units). Percentages are of the *total* pay; whatever isn't
 * allocated stays in the deposit account (the "leftover"). Kept side-effect free
 * so it can drive both the live preview and the actual execution, and be tested.
 */

export interface ResolvedLine {
  toAccountId: string
  amountMinor: number
  note?: string
}

export interface ResolvedSplit {
  lines: ResolvedLine[]
  allocatedMinor: number
  leftoverMinor: number
  /** True when the pay amount is positive and allocations don't exceed it. */
  valid: boolean
  error?: string
}

export function resolveAllocations(totalMinor: number, allocations: Allocation[]): ResolvedSplit {
  const lines: ResolvedLine[] = []
  let allocated = 0

  for (const a of allocations) {
    if (!a.toAccountId) continue
    const raw = a.mode === 'percent' ? (totalMinor * a.value) / 100 : a.value
    const amountMinor = Math.max(0, Math.round(raw))
    lines.push({ toAccountId: a.toAccountId, amountMinor, note: a.note })
    allocated += amountMinor
  }

  const leftoverMinor = totalMinor - allocated
  let valid = true
  let error: string | undefined
  if (!(totalMinor > 0)) {
    valid = false
    error = 'Enter a pay amount.'
  } else if (allocated > totalMinor) {
    valid = false
    error = 'Allocations add up to more than the pay amount.'
  }

  return { lines, allocatedMinor: allocated, leftoverMinor, valid, error }
}
