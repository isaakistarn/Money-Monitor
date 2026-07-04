import type { Holding } from '@/types/models'

/** Current value of a holding in minor units: quantity × unit price, rounded. */
export function holdingValueMinor(quantity: number, unitPriceMinor: number): number {
  return Math.round((Number(quantity) || 0) * (unitPriceMinor || 0))
}

/** Gain/loss vs cost basis, or undefined when no cost basis is recorded. */
export function holdingGainMinor(valueMinor: number, costBasisMinor?: number): number | undefined {
  return costBasisMinor == null ? undefined : valueMinor - costBasisMinor
}

/**
 * Effective total cost basis in minor units. Prefers the per-unit buy price
 * (quantity × avgCostMinor) when set, otherwise falls back to the legacy
 * total-invested field. Undefined when neither is recorded.
 */
export function costBasisOf(
  h: Pick<Holding, 'quantity' | 'avgCostMinor' | 'costBasisMinor'>,
): number | undefined {
  if (h.avgCostMinor != null) return Math.round((Number(h.quantity) || 0) * h.avgCostMinor)
  return h.costBasisMinor
}

/** Gain/loss as a percentage of cost, or undefined when not computable. */
export function gainPct(valueMinor: number, costBasisMinor?: number): number | undefined {
  if (costBasisMinor == null || costBasisMinor === 0) return undefined
  return ((valueMinor - costBasisMinor) / costBasisMinor) * 100
}

export interface ValuedHolding extends Holding {
  valueMinor: number
  gainMinor?: number
  gainPct?: number
}

/** Attach computed value/gain to a holding. Gain is measured against the
 *  effective cost basis (per-unit buy price when available, else total invested). */
export function valueHolding(h: Holding): ValuedHolding {
  const valueMinor = holdingValueMinor(h.quantity, h.unitPriceMinor)
  const cost = costBasisOf(h)
  return {
    ...h,
    valueMinor,
    gainMinor: holdingGainMinor(valueMinor, cost),
    gainPct: gainPct(valueMinor, cost),
  }
}
