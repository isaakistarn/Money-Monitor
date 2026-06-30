import { describe, expect, it } from 'vitest'
import { holdingValueMinor, holdingGainMinor, gainPct, valueHolding } from './portfolio'
import type { Holding } from '@/types/models'

describe('portfolio math', () => {
  it('values a holding as quantity × unit price (minor units)', () => {
    expect(holdingValueMinor(10, 150_00)).toBe(1500_00)
  })

  it('handles fractional quantities and rounds to minor units', () => {
    expect(holdingValueMinor(0.05, 4_000_000_00)).toBe(200_000_00) // 0.05 BTC @ £40,000
    expect(holdingValueMinor(1.5, 99)).toBe(149) // 1.5 × 0.99 = 1.485 -> 1.49
  })

  it('computes gain/loss only when a cost basis is given', () => {
    expect(holdingGainMinor(1500_00, 1200_00)).toBe(300_00)
    expect(holdingGainMinor(1500_00, undefined)).toBeUndefined()
  })

  it('computes gain percentage, guarding divide-by-zero', () => {
    expect(gainPct(1200_00, 1000_00)).toBeCloseTo(20)
    expect(gainPct(900_00, 1000_00)).toBeCloseTo(-10)
    expect(gainPct(1000_00, 0)).toBeUndefined()
    expect(gainPct(1000_00, undefined)).toBeUndefined()
  })

  it('valueHolding attaches value, gain and pct', () => {
    const h = { id: 'x', name: 'Apple', type: 'stock', quantity: 4, unitPriceMinor: 250_00, costBasisMinor: 800_00, createdAt: '' } as Holding
    const v = valueHolding(h)
    expect(v.valueMinor).toBe(1000_00)
    expect(v.gainMinor).toBe(200_00)
    expect(v.gainPct).toBeCloseTo(25)
  })
})
