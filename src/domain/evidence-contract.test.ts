import { describe, expect, it } from 'vitest'
import { bindModelQuotes, validateAnchoredOutput, validateQuoteAnchor } from './evidence-contract.mjs'
import { sampleDataset } from '../fixtures/usbCChargers'

const review = sampleDataset.reviews[0]
const product = sampleDataset.products.find((item) => item.productId === review.productId)!
const anchor = { reviewId: review.reviewId, field: 'body' as const, quote: review.body, start: 0, end: review.body.length }
const output = () => ({ themes: [{ id: 'heat', aspectId: 'thermal', productId: product.productId, market: product.market, label: '发热', sentiment: 'mixed', quotes: [anchor] }], complianceRisks: [] })

describe('exact quote anchor protocol', () => {
  it('binds a unique unchanged substring and rejects ambiguous occurrences or partial offsets', () => {
    const dataset = { ...sampleDataset, reviews: [{ ...review, body: 'hot then hot again' }] }
    const raw = { ...output(), themes: [{ ...output().themes[0], quotes: [{ reviewId: review.reviewId, field: 'body', quote: 'hot again' }] }] }
    expect(bindModelQuotes(raw, dataset).themes[0].quotes[0]).toMatchObject({ start: 9, end: 18 })
    raw.themes[0].quotes[0].quote = 'hot'
    expect(() => bindModelQuotes(raw, dataset)).toThrow('ambiguous')
    expect(() => bindModelQuotes({ ...raw, themes: [{ ...raw.themes[0], quotes: [{ ...raw.themes[0].quotes[0], start: 0 }] }] }, dataset)).toThrow()
  })
  it('accepts an exact mixed finding and does not certify semantics', () => {
    expect(validateAnchoredOutput(output(), sampleDataset).themes[0].sentiment).toBe('mixed')
  })
  it.each([{ ...anchor, quote: 'invented' }, { ...anchor, start: -1 }, { ...anchor, end: anchor.end + 1 }, { ...anchor, start: 0.5 }, { ...anchor, reviewId: 'missing' }, { ...anchor, field: 'sourceUrl' }, { ...anchor, quote: '', end: 0 }])('rejects a malformed anchor %j', (quote) => {
    expect(() => validateQuoteAnchor(quote, sampleDataset)).toThrow()
  })
  it('rejects references from another product or market', () => {
    const other = output()
    other.themes[0].productId = 'unknown'
    expect(() => validateAnchoredOutput(other, sampleDataset)).toThrow()
    other.themes[0].productId = product.productId
    other.themes[0].market = product.market === 'US' ? 'EU' : 'US'
    expect(() => validateAnchoredOutput(other, sampleDataset)).toThrow()
  })
  it('rejects ID-only output, duplicated themes and unexpected fields', () => {
    expect(() => validateAnchoredOutput({ themes: [{ id: 'heat', reviewIds: [review.reviewId] }], complianceRisks: [] }, sampleDataset)).toThrow()
    const duplicate = output()
    duplicate.themes.push(duplicate.themes[0])
    expect(() => validateAnchoredOutput(duplicate, sampleDataset)).toThrow()
    expect(() => validateQuoteAnchor({ ...anchor, secret: 'not allowed' }, sampleDataset)).toThrow()
  })
  it('uses UTF-16 offsets and rejects splitting a surrogate pair', () => {
    const dataset = { ...sampleDataset, reviews: [{ ...review, body: '好😀不好热' }] }
    expect(validateQuoteAnchor({ ...anchor, quote: '😀', start: 1, end: 3 }, dataset).quote).toBe('😀')
    expect(() => validateQuoteAnchor({ ...anchor, quote: '\ud83d', start: 1, end: 2 }, dataset)).toThrow()
  })
  it('does not infer support from a negation even when the quote exists', () => {
    const dataset = { ...sampleDataset, reviews: [{ ...review, body: 'It does not get hot.' }] }
    const quote = { ...anchor, quote: 'hot', start: 16, end: 19 }
    expect(validateQuoteAnchor(quote, dataset).quote).toBe('hot')
  })
})
