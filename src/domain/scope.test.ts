import { describe, expect, it } from 'vitest'
import { sampleDataset } from '../fixtures/usbCChargers'
import { scopeDataset } from './scope'

describe('scopeDataset', () => {
  it.each(['US', 'EU'] as const)('keeps products, reviews and policies aligned for %s', (market) => {
    const result = scopeDataset(sampleDataset, market)
    const productIds = new Set(result.products.map((row) => row.productId))
    expect(result.products.every((row) => row.market === market)).toBe(true)
    expect(result.reviews.every((row) => productIds.has(row.productId))).toBe(true)
    expect(result.policies.every((row) => row.market === market)).toBe(true)
    expect(result.products.length).toBeGreaterThan(0)
  })

  it('preserves the complete dataset for BOTH', () => {
    expect(scopeDataset(sampleDataset, 'BOTH')).toBe(sampleDataset)
  })
})
