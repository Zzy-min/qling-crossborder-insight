import { describe, expect, it } from 'vitest'
import { buildCompetitorSnapshot, simulatePricing } from './market'
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
})
