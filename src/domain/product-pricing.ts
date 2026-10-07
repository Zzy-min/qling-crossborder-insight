import type { PricingAssumptions } from './market'
import type { ProductRow } from './types'

export function productScenarioKey(product: Pick<ProductRow, 'productId' | 'market' | 'currency'>): string {
  return JSON.stringify([product.productId, product.market, product.currency])
}

export function initialProductPricing(product: ProductRow): PricingAssumptions {
  return { currency: product.currency, price: product.price, landedCost: null, platformRate: null, adRate: null, fixedLaunchCost: null }
}

export function pricingForProduct(product: ProductRow, scenarios: Record<string, PricingAssumptions>): PricingAssumptions {
  const saved = scenarios[productScenarioKey(product)]
  if (saved && saved.currency !== product.currency) throw new Error('商品成本草稿币种不匹配')
  return saved ? { ...saved } : initialProductPricing(product)
}
