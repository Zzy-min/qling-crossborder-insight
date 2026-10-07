import { z } from 'zod'

export const ASPECT_IDS = ['thermal', 'port-reset', 'food-jam', 'app-wifi', 'cleaning-corner', 'fan-noise', 'cold-attenuation', 'solar-throttle', 'durability', 'usability', 'capacity', 'charging', 'packaging', 'value', 'other']
const identifier = z.string().trim().min(1).max(120)
const market = z.enum(['US', 'EU', 'JP', 'UK'])
export const quoteAnchorSchema = z.object({ reviewId: identifier, field: z.enum(['title', 'body']), quote: z.string().min(1).max(50000), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()
const outputSchema = z.object({
  themes: z.array(z.object({ id: identifier, aspectId: z.enum(ASPECT_IDS), productId: identifier, market, label: z.string().trim().min(1).max(200), sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']), quotes: z.array(quoteAnchorSchema).min(1).max(100) }).strict()).max(20),
  complianceRisks: z.array(z.object({ id: identifier, label: z.string().trim().min(1).max(200), severity: z.enum(['low', 'medium', 'high']), policyIds: z.array(identifier).min(1).max(50) }).strict()).max(20),
}).strict()

function splitSurrogate(text, offset) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
}

export function validateQuoteAnchor(value, dataset, scope) {
  const anchor = quoteAnchorSchema.parse(value)
  const review = dataset.reviews.find((item) => item.reviewId === anchor.reviewId)
  const product = review && dataset.products.find((item) => item.productId === review.productId)
  if (!review || !product || (scope && (product.productId !== scope.productId || product.market !== scope.market))) throw new Error('invalid_quote_scope')
  const text = review[anchor.field]
  if (anchor.start >= anchor.end || anchor.end > text.length || splitSurrogate(text, anchor.start) || splitSurrogate(text, anchor.end) || text.slice(anchor.start, anchor.end) !== anchor.quote) throw new Error('invalid_quote_text')
  return anchor
}

export function validateAnchoredOutput(value, dataset) {
  const result = outputSchema.parse(value)
  if (new Set(result.themes.map((theme) => theme.id)).size !== result.themes.length || new Set(result.complianceRisks.map((risk) => risk.id)).size !== result.complianceRisks.length) throw new Error('duplicate_claim_id')
  for (const theme of result.themes) {
    if (!dataset.products.some((product) => product.productId === theme.productId && product.market === theme.market)) throw new Error('invalid_theme_scope')
    for (const anchor of theme.quotes) validateQuoteAnchor(anchor, dataset, theme)
  }
  for (const risk of result.complianceRisks) {
    const policies = risk.policyIds.map((policyId) => dataset.policies.find((policy) => policy.policyId === policyId))
    if (policies.some((policy) => !policy) || new Set(policies.map((policy) => policy.market)).size !== 1) throw new Error('invalid_policy_scope')
  }
  return result
}

export function bindModelQuotes(value, dataset) {
  const output = structuredClone(value)
  if (!Array.isArray(output?.themes)) throw new Error('invalid_output_shape')
  for (const theme of output.themes) {
    if (!Array.isArray(theme?.quotes)) throw new Error('missing_quotes')
    for (const anchor of theme.quotes) {
      if (anchor?.start !== undefined || anchor?.end !== undefined) continue
      if (!anchor || !['title', 'body'].includes(anchor.field) || typeof anchor.quote !== 'string' || !anchor.quote) throw new Error('invalid_quote_text')
      const review = dataset.reviews.find((row) => row.reviewId === anchor.reviewId)
      if (!review) throw new Error('invalid_quote_scope')
      const original = review[anchor.field]
      const start = original.indexOf(anchor.quote)
      if (start < 0 || original.indexOf(anchor.quote, start + 1) !== -1) throw new Error('invalid_or_ambiguous_quote')
      anchor.start = start
      anchor.end = start + anchor.quote.length
    }
  }
  return validateAnchoredOutput(output, dataset)
}
