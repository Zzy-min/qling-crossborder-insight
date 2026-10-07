import type { ZodType } from 'zod'
import type { DatasetBundle, QuoteAnchor, Market, ReviewSentiment } from './types'
export const ASPECT_IDS: string[]
export const quoteAnchorSchema: ZodType<QuoteAnchor>
export function validateQuoteAnchor(value: unknown, dataset: DatasetBundle, scope?: { productId: string; market: Market }): QuoteAnchor
export function bindModelQuotes(value: unknown, dataset: DatasetBundle): ReturnType<typeof validateAnchoredOutput>
export function validateAnchoredOutput(value: unknown, dataset: DatasetBundle): {
  themes: Array<{ id: string; aspectId: string; productId: string; market: Market; label: string; sentiment: ReviewSentiment; quotes: QuoteAnchor[] }>
  complianceRisks: Array<{ id: string; label: string; severity: 'low' | 'medium' | 'high'; policyIds: string[] }>
}
