import { describe, expect, it } from 'vitest'
import { buildInsightReport, calculateOpportunityScore } from './analysis'
import { sampleDataset } from '../fixtures/usbCChargers'

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
    expect(report.evidenceCoverage).toMatchObject({ totalClaims: 0, claimsWithEvidence: 0, coverageRate: 0 })
    expect(report.actions).toEqual([])
    expect(report.recommendation).toContain('证据不足')
  })
})
