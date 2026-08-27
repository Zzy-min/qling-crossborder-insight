import type { DatasetBundle } from './types'

export type MarketScope = 'ALL' | 'US' | 'EU' | 'JP' | 'UK' | 'BOTH'

export function scopeDataset(dataset: DatasetBundle, scope: MarketScope): DatasetBundle {
  if (scope === 'ALL' || scope === 'BOTH') return dataset
  const products = dataset.products.filter((product) => product.market === scope)
  const productIds = new Set(products.map((product) => product.productId))
  return {
    products,
    reviews: dataset.reviews.filter((review) => productIds.has(review.productId)),
    policies: dataset.policies.filter((policy) => policy.market === scope),
  }
}
