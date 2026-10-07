import { z } from 'zod'

const sourceUrl = z.string().max(2048).refine((value) => value.startsWith('https://') || value.startsWith('fixture:'))
const product = z.object({
  productId: z.string().trim().min(1).max(120), title: z.string().max(500), brand: z.string().max(200),
  market: z.enum(['US', 'EU', 'JP', 'UK']), currency: z.enum(['USD', 'EUR', 'JPY', 'GBP']), price: z.number().nonnegative(),
  rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().nonnegative().nullable(), capturedAt: z.string().date(), sourceUrl: sourceUrl.nullable(),
}).strict()
const review = z.object({
  reviewId: z.string().trim().min(1).max(120), productId: z.string().trim().min(1).max(120), locale: z.string().min(2).max(35),
  rating: z.number().min(1).max(5), title: z.string().max(1000), body: z.string().min(1).max(5000),
  reviewedAt: z.string().date(), verifiedPurchase: z.boolean().nullable(), sourceUrl: sourceUrl.nullable(),
}).strict()
const policy = z.object({
  policyId: z.string().trim().min(1).max(120), market: z.enum(['US', 'EU', 'JP', 'UK']), authority: z.string().max(300),
  topic: z.string().max(500), effectiveAt: z.string().date(), summary: z.string().min(1).max(5000), sourceUrl,
}).strict()
const schema = z.object({
  provenance: z.object({ products: z.enum(['demo', 'user-provided', 'official', 'unknown']), reviews: z.enum(['demo', 'user-provided', 'official', 'unknown']), policies: z.enum(['demo', 'user-provided', 'official', 'unknown']) }).strict().optional(),
  products: z.array(product).max(500), reviews: z.array(review).max(1000), policies: z.array(policy).max(200),
}).strict()

export function validateDataset(input) {
  return checkDataset(schema.parse(input))
}

export function validateImageDataset(input) {
  return checkDataset(schema.extend({ products: z.array(product).min(1).max(100), reviews: z.array(review).min(1).max(10000), policies: z.array(z.never()) }).parse(input))
}

function checkDataset(dataset) {
  const productIds = new Set(dataset.products.map((item) => item.productId))
  const duplicate = (items, key) => {
    const seen = new Set()
    for (const item of items) {
      if (seen.has(item[key])) throw new Error(`duplicate_${key}`)
      seen.add(item[key])
    }
  }
  duplicate(dataset.products, 'productId')
  duplicate(dataset.reviews, 'reviewId')
  duplicate(dataset.policies, 'policyId')
  if (dataset.reviews.some((item) => !productIds.has(item.productId))) throw new Error('orphan_product_reference')
  return dataset
}
