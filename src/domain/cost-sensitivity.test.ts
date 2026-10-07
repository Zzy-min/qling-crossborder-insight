import { describe, expect, it } from 'vitest'
import { initialCostSet, validateCostSet, type CostItem } from './cost-scenario'
import { buildCostSensitivity, initialSensitivitySpec } from './cost-sensitivity'

function input() {
  const set = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
  const known = (value: number): CostItem => ({ value, status: 'included', currency: 'USD', identity: 'measured', source: '合成假设', updatedAt: '2026-10-06' })
  for (const scenario of set.scenarios) {
    scenario.price = known(50)
    for (const key of ['landed', 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement', 'fixedLaunch'] as const) scenario.costs[key] = known(0)
    Object.assign(scenario.costs, { landed: known(20), adRate: known(0.1), returnRate: known(0.1), returnIncrementalLoss: known(10), fixedLaunch: known(1200) })
  }
  set.sensitivity = initialSensitivitySpec(set)!
  return set
}

describe('single-variable sensitivity', () => {
  it('does not retrofit plots or invent ranges for unknown historical costs', () => {
    const set = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
    expect(initialSensitivitySpec(set)).toBeNull()
    expect(buildCostSensitivity(set)).toBeNull()
  })
  it('samples eleven points with exact endpoints without altering measured input', () => {
    const set = input()
    const original = structuredClone(set)
    const result = buildCostSensitivity(set)!
    const points = result.axes[0].curves[0].points
    expect(points).toHaveLength(11)
    expect(points[0].value).toBe(40)
    expect(points[10].value).toBe(60)
    expect(points[5].contribution).toBe(24)
    expect(points[5].breakEvenUnits).toBe(50)
    expect(set).toEqual(original)
  })
  it('varies advertising, returns and improvement once without double-deducting refunds', () => {
    const result = buildCostSensitivity(input())!
    expect(result.axes.find(axis => axis.axis === 'adRate')!.curves[0].points[0].contribution).toBeCloseTo(26.5)
    expect(result.axes.find(axis => axis.axis === 'returnRate')!.curves[0].points[0].contribution).toBeCloseTo(24.5)
    expect(result.axes.find(axis => axis.axis === 'improvement')!.curves[0].points[10].contribution).toBe(19)
  })
  it('retains negative and zero contributions but never reports finite break-even', () => {
    const set = input()
    set.sensitivity!.ranges.price = { min: 10, max: 30 }
    const points = buildCostSensitivity(set)!.axes[0].curves[0].points
    expect(points[0].contribution).toBeLessThan(0)
    expect(points[0].breakEvenUnits).toBeNull()
    expect(points[10].contribution).toBeGreaterThan(0)
  })
  it('does not fill unrelated unknown costs or unknown fixed investment', () => {
    const set = input()
    set.scenarios[0].costs.fulfillment = { ...set.scenarios[0].costs.fulfillment, status: 'unknown', value: null }
    set.scenarios[1].costs.fixedLaunch = { ...set.scenarios[1].costs.fixedLaunch, status: 'unknown', value: null }
    const curves = buildCostSensitivity(set)!.axes[0].curves
    expect(curves[0].points.every(point => point.contribution === null && point.missing.includes('fulfillment'))).toBe(true)
    expect(curves[1].points.every(point => point.contribution !== null && point.breakEvenUnits === null)).toBe(true)
  })
  it('validates finite ordered ranges and bounded rates while allowing constant ranges', () => {
    const set = input()
    set.sensitivity!.ranges.adRate = { min: 0.1, max: 0.1 }
    expect(new Set(buildCostSensitivity(set)!.axes[1].curves[0].points.map(point => point.value)).size).toBe(1)
    for (const range of [{ min: 0.2, max: 0.1 }, { min: 0, max: 1.1 }, { min: 0, max: Infinity }]) {
      set.sensitivity!.ranges.adRate = range
      expect(() => validateCostSet(set)).toThrow()
    }
    set.sensitivity!.ranges.adRate = { min: 0, max: 1 }
    set.sensitivity!.ranges.price = { min: 0, max: 50 }
    expect(() => buildCostSensitivity(set)).toThrow()
  })
  it('records numeric failures as explicit missing points, not fake zeros', () => {
    const set = input()
    set.sensitivity!.ranges.improvement = { min: 1e308, max: 1.7e308 }
    set.scenarios.forEach(scenario => { scenario.costs.landed.value = 1e308 })
    const points = buildCostSensitivity(set)!.axes[3].curves[0].points
    expect(points.every(point => point.status === 'calculation-error' && point.contribution === null)).toBe(true)
  })
  it('fingerprints ranges, full assumptions and formulas reproducibly', () => {
    const set = input()
    const before = buildCostSensitivity(set)!
    expect(buildCostSensitivity(structuredClone(set))!.digest).toBe(before.digest)
    set.sensitivity!.ranges.price.max = 70
    expect(buildCostSensitivity(set)!.digest).not.toBe(before.digest)
    set.scenarios[0].costs.storage.source = 'another assumption'
    expect(buildCostSensitivity(set)!.digest).not.toBe(before.digest)
  })
})
