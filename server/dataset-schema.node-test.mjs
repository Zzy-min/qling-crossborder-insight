import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDataset } from './dataset-schema.mjs'

test('seller unknown metadata is retained without demo URLs or verification flags', () => {
  const input = { products: [{ productId: 'MY-SKU', title: 'Charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-01', sourceUrl: null }],
    reviews: [{ reviewId: 'R1', productId: 'MY-SKU', locale: 'en-US', rating: 2, title: '', body: 'gets hot', reviewedAt: '2026-10-02', verifiedPurchase: null, sourceUrl: null }], policies: [],
    provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } }
  assert.deepEqual(validateDataset(input), input)
})
