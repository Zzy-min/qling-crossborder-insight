import { describe, expect, it } from 'vitest'
import {
  buildInsightReport,
  calculateCompetitionAndMargin,
  calculateImprovementSpace,
  calculateOpportunityScore,
  describeCompetitionInputs,
} from './analysis'
import { sampleDataset } from '../fixtures/usbCChargers'
import type { ProductRow, ReviewTheme } from './types'

function theme(overrides: Partial<ReviewTheme> & Pick<ReviewTheme, 'id'>): ReviewTheme {
  return { label: overrides.id, sentiment: 'negative', mentions: 1, evidence: [], ...overrides }
}

function product(overrides: Partial<ProductRow> & Pick<ProductRow, 'productId'>): ProductRow {
  return {
    title: overrides.productId,
    brand: 'TestBrand',
    market: 'US',
    currency: 'USD',
    price: 20,
    rating: 4,
    reviewCount: 100,
    capturedAt: '2026-08-01',
    sourceUrl: `fixture:${overrides.productId}`,
    ...overrides,
  }
}

describe('local rule anchor boundaries', () => {
  it('uses exact original offsets despite Unicode case-fold length changes', () => {
    const dataset = structuredClone(sampleDataset)
    dataset.reviews = [{ ...dataset.reviews[0], rating: 2, title: '', body: 'İ 😀 HOT' }]
    const reference = buildInsightReport(dataset).themes[0].evidence[0]
    expect(reference.quoteAnchor).toMatchObject({ field: 'body', start: 5, end: 8, quote: 'HOT' })
    expect(dataset.reviews[0].body.slice(reference.quoteAnchor!.start, reference.quoteAnchor!.end)).toBe('HOT')
  })
  it('does not combine title and body to invent a rule substring', () => {
    const dataset = structuredClone(sampleDataset)
    dataset.reviews = [{ ...dataset.reviews[0], rating: 2, title: 'second', body: 'device' }]
    expect(buildInsightReport(dataset).themes).toEqual([])
  })
  it('keeps negation matches pending rather than asserting semantic correctness', () => {
    const dataset = structuredClone(sampleDataset)
    dataset.reviews = [{ ...dataset.reviews[0], rating: 2, title: '', body: 'It does not get hot.' }]
    expect(buildInsightReport(dataset).themes[0]).toMatchObject({ semanticStatus: 'pending-review', evidenceLevel: 'quote-anchored/2' })
  })
})

describe('calculateImprovementSpace', () => {
  it('returns zero when nothing was clustered', () => {
    expect(calculateImprovementSpace([])).toBe(0)
  })

  it('weights negative and recurring themes instead of returning a constant', () => {
    expect(calculateImprovementSpace([theme({ id: 'single', mentions: 1 })])).toBe(60)
    expect(calculateImprovementSpace([
      theme({ id: 'recurring', mentions: 4 }),
      theme({ id: 'positive', sentiment: 'positive', mentions: 1 }),
    ])).toBe(50)
  })

  it('stays inside the zero to one hundred range', () => {
    const score = calculateImprovementSpace([theme({ id: 'a', mentions: 9 }), theme({ id: 'b', mentions: 7 })])
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('calculateCompetitionAndMargin', () => {
  it('returns zero without any competitor snapshot', () => {
    expect(calculateCompetitionAndMargin([])).toBe(0)
    expect(describeCompetitionInputs([])).toBe('无在售商品快照')
  })

  it('rewards a wide price band with evenly spread reviews over a crowded shelf', () => {
    const roomy = calculateCompetitionAndMargin([
      product({ productId: 'p1', price: 10 }),
      product({ productId: 'p2', price: 25 }),
      product({ productId: 'p3', price: 60 }),
    ])
    const crowded = calculateCompetitionAndMargin([
      product({ productId: 'p1', price: 20, reviewCount: 950 }),
      product({ productId: 'p2', price: 21, reviewCount: 50 }),
    ])

    expect(roomy).toBeGreaterThan(crowded)
    expect(crowded).toBeGreaterThan(0)
    expect(roomy).toBeLessThanOrEqual(100)
  })

  it('describes the inputs it actually used', () => {
    expect(describeCompetitionInputs([product({ productId: 'p1', price: 20 }), product({ productId: 'p2', price: 40 })]))
      .toBe('1 个币种货架 · USD 2 款 · 带宽 67% · 分散 50%')
  })

  it('keeps shelves in different currencies apart', () => {
    const mixed = [
      product({ productId: 'us-1', price: 20 }),
      product({ productId: 'us-2', price: 40 }),
      product({ productId: 'jp-1', price: 3800, currency: 'JPY' }),
      product({ productId: 'jp-2', price: 5200, currency: 'JPY' }),
    ]

    expect(describeCompetitionInputs(mixed)).toContain('2 个币种货架')
    expect(describeCompetitionInputs(mixed)).toContain('JPY 2 款')
    expect(calculateCompetitionAndMargin(mixed)).toBeLessThanOrEqual(100)
    // 单一快照的货架没有可比价格与分布，标成样本不足，不参与打分。
    expect(describeCompetitionInputs([product({ productId: 'jp-only', price: 3800, currency: 'JPY' })]))
      .toBe('1 个币种货架 · JPY 1 款（样本不足，不计分）')
    expect(calculateCompetitionAndMargin([
      product({ productId: 'jp-only', price: 3800, currency: 'JPY' }),
      product({ productId: 'gb-only', price: 45, currency: 'GBP' }),
    ])).toBe(0)
  })
})

describe('calculateOpportunityScore', () => {
  it('uses the documented deterministic weights', () => {
    expect(calculateOpportunityScore({
      painIntensity: 80,
      improvementSpace: 60,
      competitionAndMargin: 70,
      dataConfidence: 90,
      compliancePenalty: 20,
    })).toBe(59)
  })

  it('clamps the final result between zero and one hundred', () => {
    expect(calculateOpportunityScore({
      painIntensity: 0,
      improvementSpace: 0,
      competitionAndMargin: 0,
      dataConfidence: 0,
      compliancePenalty: 100,
    })).toBe(0)
  })
})

describe('buildInsightReport', () => {
  it('binds evidence to every theme and compliance risk', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-12T00:00:00.000Z')

    expect(report.themes.length).toBeGreaterThan(0)
    expect(report.themes.every((theme) => theme.evidence.length > 0)).toBe(true)
    expect(report.complianceRisks.length).toBeGreaterThan(0)
    expect(report.complianceRisks.every((risk) => risk.evidence.length > 0)).toBe(true)
    expect(report.complianceRisks.map((risk) => risk.market)).toEqual(['US', 'EU'])
    expect(report.generatedAt).toBe('2026-08-12T00:00:00.000Z')
    expect(report.providerMode).toBe('fixture')
  })

  it('adds deterministic data quality, evidence coverage, contributions and actions', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-12T00:00:00.000Z')

    expect(report.dataQuality).toMatchObject({
      totalReviews: 4,
      verifiedPurchaseRate: 1,
      linkedProducts: 2,
      deduplicatedCount: 0,
      privacyCheck: 'passed',
    })
    expect(report.dataQuality.marketCoverage).toEqual(['US', 'EU'])
    expect(report.evidenceCoverage.coverageRate).toBe(1)
    expect(report.evidenceCoverage.claimsWithEvidence).toBe(report.evidenceCoverage.totalClaims)
    expect(report.evidenceCoverage.productEvidenceCount).toBe(sampleDataset.products.length)
    expect(report.scoreContributions).toHaveLength(5)
    expect(report.scoreContributions.find((item) => item.key === 'compliancePenalty')).toMatchObject({
      weight: 0.15,
      direction: 'subtract',
      weightedContribution: -6,
    })
    expect(report.actions.map((action) => action.category)).toEqual(['product', 'market', 'compliance'])
    const knownIds = new Set([
      ...sampleDataset.products.map((item) => item.productId),
      ...sampleDataset.reviews.map((item) => item.reviewId),
      ...sampleDataset.policies.map((item) => item.policyId),
    ])
    expect(report.actions.every((action) => action.evidenceRecordIds.every((id) => knownIds.has(id)))).toBe(true)
  })

  it('stays conservative for an empty evidence set', () => {
    const report = buildInsightReport({ products: [], reviews: [], policies: [] }, '2026-08-12T00:00:00.000Z')

    expect(report.opportunityScore).toBeLessThan(60)
    expect(report.scoreBreakdown.improvementSpace).toBe(0)
    expect(report.scoreBreakdown.competitionAndMargin).toBe(0)
    expect(report.evidenceCoverage).toMatchObject({ totalClaims: 0, claimsWithEvidence: 0, coverageRate: 0 })
    expect(report.actions).toEqual([])
    expect(report.recommendation).toContain('证据不足')
  })

  it('states the inputs behind every ledger row', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-12T00:00:00.000Z')

    expect(report.scoreContributions.every((item) => item.detail.length > 0)).toBe(true)
    expect(report.scoreContributions.find((item) => item.key === 'competitionAndMargin')?.detail).toContain('个币种货架')
    expect(report.scoreContributions.find((item) => item.key === 'improvementSpace')?.detail).toContain('样本门槛不足')
    expect(report.scoreContributions.find((item) => item.key === 'dataConfidence')?.detail).toContain('输入声明')
  })

  it('moves the competition score when the shelf changes', () => {
    const timestamp = '2026-08-12T00:00:00.000Z'
    const balanced = buildInsightReport(sampleDataset, timestamp)
    const concentrated = buildInsightReport(
      {
        ...sampleDataset,
        products: sampleDataset.products.map((item, index) => (index === 0
          ? { ...item, reviewCount: item.reviewCount === null ? null : item.reviewCount * 50 }
          : item)),
      },
      timestamp,
    )

    expect(concentrated.scoreBreakdown.competitionAndMargin)
      .toBeLessThan(balanced.scoreBreakdown.competitionAndMargin)
  })
})
