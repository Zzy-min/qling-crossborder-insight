import { describe, expect, it } from 'vitest'
import { productScenarioKey, initialProductPricing, pricingForProduct } from './product-pricing'
import { buildPricingScenario, pricingScenarioRows } from './market'
import { buildScenarioIntegrity } from './integrity'
import type { ProductRow } from './types'

const product: ProductRow = { productId: 'SKU', title: 'Charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
describe('per-product pricing', () => {
  it('separates product, market and currency without delimiter collisions', () => {
    const variants = [product, { ...product, productId: 'other' }, { ...product, market: 'EU' as const }, { ...product, currency: 'EUR' as const }]
    expect(new Set(variants.map(productScenarioKey)).size).toBe(4)
    expect(productScenarioKey({ ...product, productId: 'SKU:US:USD' })).not.toBe(productScenarioKey(product))
  })
  it('does not default costs or reuse another product with the same currency', () => {
    const costs = { [productScenarioKey(product)]: { ...initialProductPricing(product), landedCost: 12 } }
    expect(pricingForProduct(product, costs).landedCost).toBe(12)
    expect(pricingForProduct({ ...product, productId: 'other' }, costs).landedCost).toBeNull()
  })
  it('returns independent copies, retaining zero assumptions', () => {
    const original = { ...initialProductPricing(product), landedCost: 0 }
    const copy = pricingForProduct(product, { [productScenarioKey(product)]: original })
    expect(copy.landedCost).toBe(0)
    copy.landedCost = 10
    expect(original.landedCost).toBe(0)
  })
  it('rejects mixed-currency drafts', () => {
    expect(() => pricingForProduct(product, { [productScenarioKey(product)]: { ...initialProductPricing(product), currency: 'EUR' } })).toThrow('币种')
    expect(buildPricingScenario(initialProductPricing(product), { productId: 'SKU', market: 'EU', currency: 'EUR' }).status).toBe('invalid')
  })
  it('binds the scenario digest and report rows to product identity without changing v1', () => {
    const assumptions = { ...initialProductPricing(product), landedCost: 10, fixedLaunchCost: 0, platformRate: 0, adRate: 0 }
    const first = buildPricingScenario(assumptions, { productId: 'SKU', market: 'US', currency: 'USD' })
    const second = buildPricingScenario(assumptions, { productId: 'other', market: 'US', currency: 'USD' })
    expect(buildScenarioIntegrity(first).schemaVersion).toBe('qling-pricing-scenario/2')
    expect(buildScenarioIntegrity(first).digest).not.toBe(buildScenarioIntegrity(second).digest)
    expect(buildScenarioIntegrity(buildPricingScenario(assumptions)).schemaVersion).toBe('qling-pricing-scenario/1')
    expect(pricingScenarioRows(first)).toContainEqual({ label: '测算商品', value: 'SKU' })
  })
})
