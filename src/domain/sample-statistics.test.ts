import { describe, expect, it } from 'vitest'
import { negativeReviewIds, sampleStatistics, sampleStatisticsLabel } from './sample-statistics'
import { sampleDataset } from '../fixtures/usbCChargers'
import type { ReviewTheme } from './types'

function data(count = 20) {
  const product = sampleDataset.products[0]
  return { products: [product], policies: [], reviews: Array.from({ length: count }, (_, index) => ({ ...sampleDataset.reviews[0], productId: product.productId, reviewId: `R${index}`, reviewedAt: '2026-10-06' })) }
}
function finding(count = 4, sentiment: ReviewTheme['sentiment'] = 'negative'): ReviewTheme {
  return { id: 'heat', aspectId: 'thermal', label: '发热', sentiment, mentions: 999, evidence: Array.from({ length: count }, (_, index) => ({ recordId: `R${index}`, evidenceType: 'review', capturedAt: '2026-10-06', sourceUrl: null, excerpt: '' })) }
}

describe('sample statistics', () => {
  it.each([
    [20, 5, 3, 'high-mention-high-negative'],
    [20, 5, 2, 'high-mention-low-negative'],
    [30, 3, 2, 'low-mention-high-negative'],
    [30, 3, 1, 'low-mention-low-negative'],
  ])('classifies sample quadrants at declared thresholds (%i / %i / %i)', (samples, mentions, negatives, quadrant) => {
    const negative = finding(negatives)
    const neutral = finding(mentions, 'neutral')
    neutral.evidence = neutral.evidence.slice(negatives)
    expect(sampleStatistics(negative, [negative, neutral], data(samples))[0].quadrant).toBe(quadrant)
  })
  it('does not label undefined rates as measured zeros', () => {
    const theme = finding()
    const empty = sampleStatistics(theme, [theme], data(0))[0]
    expect(sampleStatisticsLabel(empty)).toContain('无有效样本，不可计算')
    expect(sampleStatisticsLabel(empty)).toContain('无方面提及，不可计算')
    expect(sampleStatisticsLabel(empty)).not.toContain('0/0')
  })
  it('counts negative reviews once while keeping aspect conflicts separate', () => {
    const negative = finding(4)
    const positive = finding(2, 'positive')
    expect([...negativeReviewIds([negative, negative, positive], data())]).toEqual(['R2', 'R3'])
    positive.aspectId = 'charging'
    expect(negativeReviewIds([negative, positive], data()).size).toBe(4)
  })
  it('uses unique reviews rather than model mentions or repeated anchors', () => {
    const theme = finding()
    theme.evidence.push(theme.evidence[0])
    const dataset = data()
    dataset.reviews.push(dataset.reviews[0])
    expect(sampleStatistics(theme, [theme], dataset)[0]).toMatchObject({ sampleCount: 20, mentionCount: 4, mentionRate: 0.2, negativeRate: 1, quadrant: 'high-mention-high-negative' })
  })
  it.each([[19, 4], [20, 2]])('gates small samples and low support (%i / %i)', (count, mentions) => {
    const theme = finding(mentions)
    expect(sampleStatistics(theme, [theme], data(count))[0].quadrant).toBeNull()
  })
  it('merges conflicting and mixed sentiment without counting them negative', () => {
    const negative = finding(4)
    const positive = { ...finding(2, 'positive'), id: 'heat-positive' }
    expect(sampleStatistics(negative, [negative, positive], data())[0]).toMatchObject({ mentionCount: 4, negativeCount: 2, mixedCount: 2, negativeRate: 0.5, quadrant: 'high-mention-low-negative' })
    const mixed = finding(4, 'mixed')
    expect(sampleStatistics(mixed, [mixed], data())[0].negativeCount).toBe(0)
  })
  it('does not pool products, markets or a different aspect', () => {
    const dataset = data()
    dataset.products.push({ ...dataset.products[0], productId: 'EU', market: 'EU', currency: 'EUR' })
    dataset.reviews.push({ ...dataset.reviews[0], productId: 'EU', reviewId: 'EU-R' })
    const theme = finding(4)
    const other = { ...finding(10), id: 'charging', aspectId: 'charging' }
    const stats = sampleStatistics(theme, [theme, other], dataset)
    expect(stats[0].mentionCount).toBe(4)
    expect(stats[1]).toMatchObject({ sampleCount: 1, mentionCount: 0, quadrant: null })
  })
  it('handles empty and neutral data without division by zero', () => {
    const theme = finding(3, 'neutral')
    expect(sampleStatistics(theme, [theme], data())[0]).toMatchObject({ negativeCount: 0, negativeRate: 0 })
    expect(sampleStatistics(theme, [theme], data(0))[0]).toMatchObject({ mentionRate: 0, negativeRate: 0, timeRange: null, quadrant: null })
  })
  it('uses the current imported time range, not import time', () => {
    const dataset = data()
    dataset.reviews[0].reviewedAt = '2025-01-01'
    const theme = finding()
    expect(sampleStatistics(theme, [theme], dataset)[0].timeRange).toEqual({ from: '2025-01-01', to: '2026-10-06' })
  })
})
