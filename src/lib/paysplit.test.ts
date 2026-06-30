import { describe, expect, it } from 'vitest'
import { resolveAllocations } from './paysplit'
import type { Allocation } from '@/types/models'

const alloc = (toAccountId: string, mode: 'percent' | 'fixed', value: number): Allocation => ({
  id: `${toAccountId}-${mode}-${value}`,
  toAccountId,
  mode,
  value,
})

describe('resolveAllocations', () => {
  it('splits by percentage of the total pay', () => {
    const r = resolveAllocations(1000_00, [alloc('save', 'percent', 30), alloc('bills', 'percent', 20)])
    expect(r.valid).toBe(true)
    expect(r.lines.map((l) => l.amountMinor)).toEqual([300_00, 200_00])
    expect(r.allocatedMinor).toBe(500_00)
    expect(r.leftoverMinor).toBe(500_00) // remainder stays in the deposit account
  })

  it('supports fixed amounts and a mix with percentages', () => {
    const r = resolveAllocations(2000_00, [alloc('save', 'fixed', 500_00), alloc('bills', 'percent', 25)])
    expect(r.lines.map((l) => l.amountMinor)).toEqual([500_00, 500_00])
    expect(r.leftoverMinor).toBe(1000_00)
    expect(r.valid).toBe(true)
  })

  it('flags over-allocation as invalid', () => {
    const r = resolveAllocations(100_00, [alloc('a', 'percent', 80), alloc('b', 'fixed', 50_00)])
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/more than the pay amount/i)
  })

  it('is invalid with no pay amount', () => {
    const r = resolveAllocations(0, [alloc('a', 'percent', 50)])
    expect(r.valid).toBe(false)
  })

  it('rounds fractional percentages and leaves the remainder as leftover', () => {
    const r = resolveAllocations(1000_00, [alloc('a', 'percent', 33.33), alloc('b', 'percent', 33.33)])
    // 33.33% of 1000.00 = 333.30 each
    expect(r.lines.map((l) => l.amountMinor)).toEqual([333_30, 333_30])
    expect(r.leftoverMinor).toBe(1000_00 - 2 * 333_30)
  })

  it('ignores rows with no target account', () => {
    const r = resolveAllocations(500_00, [alloc('', 'percent', 50), alloc('save', 'percent', 10)])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ toAccountId: 'save', amountMinor: 50_00 })
  })
})
