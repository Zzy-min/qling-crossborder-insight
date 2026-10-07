import { describe, expect, it } from 'vitest'
import { compareCostScenarios, evaluateCostScenario, initialCostScenario, formatContributionRate, type CostItem, type CostScenario } from './cost-scenario'

function known(value: number): CostItem { return { value, status: 'included', currency: 'USD', identity: 'user-assumption', source: '合成成本假设', updatedAt: '2026-10-06' } }
it('does not format overflowing percentages or scenario deltas as Infinity', () => {
  expect(formatContributionRate(null)).toBe('未计算')
  expect(formatContributionRate(0)).toBe('0.00%')
  expect(formatContributionRate(-1e308)).toContain('超出安全')
  const scenarios = ['baseline', 'improvement', 'stress'].map(kind => {
    const scenario = complete(kind as CostScenario['kind'])
    for (const key of ['landed', 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement', 'fixedLaunch'] as const) scenario.costs[key] = known(0)
    scenario.price = known(kind === 'baseline' ? 1e308 : 1)
    if (kind !== 'baseline') scenario.costs.landed = known(1e308)
    return scenario
  })
  expect(compareCostScenarios(scenarios)[1].contributionDelta).toBeNull()
})
function complete(kind: CostScenario['kind'] = 'baseline'): CostScenario {
  const scenario = initialCostScenario({ productId: 'SKU', market: 'US', currency: 'USD' }, kind)
  scenario.price = known(50)
  for (const key of ['landed', 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement', 'fixedLaunch'] as const) scenario.costs[key] = known(0)
  Object.assign(scenario.costs, { landed: known(20), platformRate: known(0.15), fulfillment: known(4), adRate: known(0.1), storage: known(0.5), returnRate: known(0.1), returnIncrementalLoss: known(10), fixedLaunch: known(1200) })
  return scenario
}

describe('detailed contribution scenarios', () => {
  it('starts unknown without demo costs or false zero assumptions', () => {
    const scenario = initialCostScenario({ productId: 'SKU', market: 'US', currency: 'USD' }, 'baseline')
    const { result } = evaluateCostScenario(scenario)
    expect(result.status).toBe('missing-variable-costs')
    expect(result.contributionPerUnit).toBeNull()
    expect(result.breakEvenUnits).toBeNull()
    expect(result.missing).toContain('returnIncrementalLoss')
  })
  it('deducts incremental return loss once and computes contribution, not net profit', () => {
    const { result } = evaluateCostScenario(complete())
    expect(result).toMatchObject({ status: 'ready', variableCostPerUnit: 38, contributionPerUnit: 12, contributionMarginRate: 0.24, breakEvenUnits: 100 })
  })
  it('keeps contribution when fixed investment is unknown', () => {
    const scenario = complete()
    scenario.costs.fixedLaunch.value = null
    scenario.costs.fixedLaunch.status = 'unknown'
    expect(evaluateCostScenario(scenario).result).toMatchObject({ status: 'missing-fixed-cost', contributionPerUnit: 12, breakEvenUnits: null, missing: ['fixedLaunch'] })
  })
  it('distinguishes explicit exclusion, known zero and unknown', () => {
    const scenario = complete()
    scenario.costs.storage = { ...known(0), status: 'not-included' }
    const { result } = evaluateCostScenario(scenario)
    expect(result.contributionPerUnit).toBe(12.5)
    expect(result.limitations).toContain('用户明确不计入：storage')
    expect(() => evaluateCostScenario({ ...scenario, costs: { ...scenario.costs, storage: { ...scenario.costs.storage, value: null } } })).toThrow()
  })
  it('never gives finite break-even for zero or negative contribution', () => {
    for (const landed of [32, 40]) {
      const scenario = complete()
      scenario.costs.landed = known(landed)
      const { result } = evaluateCostScenario(scenario)
      expect(result.status).toBe('non-positive-contribution')
      expect(result.contributionPerUnit).toBeLessThanOrEqual(0)
      expect(result.breakEvenUnits).toBeNull()
    }
  })
  it('prevents duplicate landed cost even when split value is zero', () => {
    const scenario = complete()
    scenario.costs.procurement = known(0)
    expect(() => evaluateCostScenario(scenario)).toThrow('不可同时计入')
    scenario.landedMode = 'split'
    expect(() => evaluateCostScenario(scenario)).toThrow('不可同时计入')
    scenario.costs.landed = { ...known(0), status: 'unknown', value: null }
    scenario.costs.procurement = known(16)
    scenario.costs.freightDuty = known(4)
    expect(evaluateCostScenario(scenario).result.contributionPerUnit).toBe(12)
  })
  it('rejects mixed currencies, bad dates, non-finite values and invalid rates', () => {
    for (const item of [{ ...known(0), currency: 'EUR' }, { ...known(0), updatedAt: '2026-02-30' }, known(Infinity), known(-1), known(1.01)]) {
      const scenario = complete()
      scenario.costs.returnRate = item as CostItem
      expect(() => evaluateCostScenario(scenario)).toThrow()
    }
  })
  it('rejects zero price, extra fields and credential-bearing payloads', () => {
    expect(() => evaluateCostScenario({ ...complete(), price: known(0) })).toThrow()
    expect(() => evaluateCostScenario({ ...complete(), apiKey: 'synthetic-not-a-key' })).toThrow()
  })
  it('fingerprints provenance, assumptions, formula and results without altering input', () => {
    const scenario = complete()
    const before = structuredClone(scenario)
    const first = evaluateCostScenario(scenario)
    expect(scenario).toEqual(before)
    expect(evaluateCostScenario(structuredClone(scenario)).scenarioDigest).toBe(first.scenarioDigest)
    scenario.costs.landed.source = '另一份假设'
    expect(evaluateCostScenario(scenario).scenarioDigest).not.toBe(first.scenarioDigest)
    scenario.costs.landed.value = 21
    expect(evaluateCostScenario(scenario).result.contributionPerUnit).toBe(11)
  })
  it('compares improvement and stress as conditional deltas only', () => {
    const improvement = complete('improvement')
    improvement.costs.returnRate = known(0.02)
    improvement.costs.improvement = known(0.5)
    const stress = complete('stress')
    stress.costs.adRate = known(0.2)
    const compared = compareCostScenarios([complete(), improvement, stress])
    expect(compared[1].contributionDelta).toBeCloseTo(0.3)
    expect(compared[2].contributionDelta).toBe(-5)
    expect(compared[1].result.limitations.join('')).toContain('不证明改良已经生效')
  })
  it('requires three comparable distinct scenario kinds', () => {
    expect(() => compareCostScenarios([complete()])).toThrow()
    expect(() => compareCostScenarios([complete(), complete(), complete()])).toThrow()
    const stress = complete('stress')
    stress.target.productId = 'OTHER'
    expect(() => compareCostScenarios([complete(), complete('improvement'), stress])).toThrow('不同商品')
  })
  it('does not turn unknown values into comparison gains or unsafe break-even', () => {
    const improvement = complete('improvement')
    improvement.costs.adRate = { ...known(0), status: 'unknown', value: null }
    expect(compareCostScenarios([complete(), improvement, complete('stress')])[1].contributionDelta).toBeNull()
    const scenario = complete()
    scenario.costs.fixedLaunch = known(Number.MAX_VALUE)
    expect(() => evaluateCostScenario(scenario)).toThrow('安全整数')
  })
})
