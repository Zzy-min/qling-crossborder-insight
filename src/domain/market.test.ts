import { describe, expect, it } from 'vitest'
import { buildCompetitorSnapshot, buildPricingScenario, pricingSeed, simulatePricing } from './market'
import { sampleDataset } from '../fixtures/usbCChargers'
import { scopeDataset } from './scope'

describe('buildCompetitorSnapshot', () => {
  it('sorts competitors by price and calculates market medians', () => {
    const snapshot = buildCompetitorSnapshot(scopeDataset(sampleDataset, 'US').products)
    expect(snapshot.products.map((row) => row.price)).toEqual([29.99, 39.99, 49.99])
    expect(snapshot.medianPrice).toBe(39.99)
    expect(snapshot.medianRating).toBe(4.3)
    expect(snapshot.currency).toBe('USD')
  })

  it('rejects mixed currencies instead of producing a misleading median', () => {
    expect(() => buildCompetitorSnapshot([
      sampleDataset.products[0],
      { ...sampleDataset.products[0], productId: 'eu', market: 'EU', currency: 'EUR' },
    ])).toThrow('one currency')
  })
})

describe('simulatePricing', () => {
  it('calculates contribution and break-even units without claiming demand', () => {
    const result = simulatePricing({ price: 39.99, landedCost: 18, platformRate: 0.15, adRate: 0.12, fixedLaunchCost: 2500 })
    expect(result.contributionPerUnit).toBe(11.19)
    expect(result.contributionMarginRate).toBe(0.2799)
    expect(result.breakEvenUnits).toBe(224)
  })

  it('rejects scenarios with no positive contribution', () => {
    expect(() => simulatePricing({ price: 20, landedCost: 19, platformRate: 0.1, adRate: 0.1, fixedLaunchCost: 1000 }))
      .toThrow('positive contribution')
  })

  it('seeds a non-dollar scenario from that currency median', () => {
    const seed = pricingSeed([
      { ...sampleDataset.products[0], productId: 'j1', market: 'JP', currency: 'JPY', price: 4000 },
      { ...sampleDataset.products[0], productId: 'j2', market: 'JP', currency: 'JPY', price: 6000 },
    ], 'JPY')
    expect(seed).toEqual({ price: 5000, landedCost: 2250 })
    expect(pricingSeed(sampleDataset.products, 'GBP')).toBeNull()
  })
})

describe('buildPricingScenario', () => {
  const assumptions = { currency: 'EUR' as const, price: 50, landedCost: 20, platformRate: 0.15, adRate: 0.12, fixedLaunchCost: 3000 }

  it('uses the same assumptions for reported contribution and break-even', () => {
    const scenario = buildPricingScenario(assumptions)
    expect(scenario.status).toBe('ready')
    expect(scenario.assumptions).toEqual(assumptions)
    expect(scenario.result).toMatchObject({ contributionPerUnit: 16.5, contributionMarginRate: 0.33, breakEvenUnits: 182 })
  })

  it('retains a missing launch cost without inventing a zero-cost break-even', () => {
    const scenario = buildPricingScenario({ ...assumptions, fixedLaunchCost: null })
    expect(scenario.status).toBe('missing-launch-cost')
    expect(scenario.assumptions).toMatchObject({ currency: 'EUR', price: 50, landedCost: 20, fixedLaunchCost: null })
    expect(scenario.result).toBeNull()
  })

  it.each([{ landedCost: 60 }, { price: Number.NaN }, { platformRate: 0.9 }, { fixedLaunchCost: -1 }])('retains invalid assumptions but never exports a calculated result: %j', (changes) => {
    const scenario = buildPricingScenario({ ...assumptions, ...changes })
    expect(scenario.status).toBe('invalid')
    expect(scenario.assumptions).toEqual({ ...assumptions, ...changes })
    expect(scenario.result).toBeNull()
  })
})
