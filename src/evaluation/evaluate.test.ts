import { describe, expect, it } from 'vitest'
import { buildInsightReport } from '../domain/analysis'
import { sampleDataset } from '../fixtures/usbCChargers'
import { evaluateReport, summarizeEvaluation } from './evaluate'
import { createGoldenCases, goldenCases } from './goldenSet'

describe('golden evaluation gate', () => {
  it('passes the starter USB-C charger golden case', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-12T00:00:00.000Z')
    const knownIds = new Set([
      ...sampleDataset.products.map((row) => row.productId),
      ...sampleDataset.reviews.map((row) => row.reviewId),
      ...sampleDataset.policies.map((row) => row.policyId),
    ])
    const result = evaluateReport(report, {
      themeIds: ['thermal', 'port-reset'],
      riskIds: ['us-fcc-label'],
    }, knownIds)

    expect(result).toEqual({
      themePrecision: 1,
      themeRecall: 1,
      riskPrecision: 1,
      riskRecall: 1,
      evidenceCoverage: 1,
      unknownEvidenceCount: 0,
      passed: true,
    })
  })
})

describe('machine-seeded golden suite', () => {
  it('contains exactly 200 unique and explicitly unreviewed cases', () => {
    expect(goldenCases).toHaveLength(200)
    expect(new Set(goldenCases.map((item) => item.id)).size).toBe(200)
    expect(goldenCases.every((item) => item.reviewStatus === 'machine-seeded')).toBe(true)
    expect(new Set(goldenCases.map((item) => item.family))).toEqual(new Set(['thermal', 'port-reset', 'combined', 'neutral']))
  })

  it('rejects invalid requested sizes', () => {
    expect(() => createGoldenCases(0)).toThrow('positive integer')
  })

  it('meets aggregate evidence and recall gates', () => {
    const results = goldenCases.map(({ dataset, expected }) => {
    const report = buildInsightReport(dataset, '2026-08-12T00:00:00.000Z')
    const knownIds = new Set([
      ...dataset.products.map((row) => row.productId),
      ...dataset.reviews.map((row) => row.reviewId),
      ...dataset.policies.map((row) => row.policyId),
    ])
      return evaluateReport(report, expected, knownIds)
    })
    expect(summarizeEvaluation(results)).toEqual({
      caseCount: 200,
      passedCases: 200,
      passRate: 1,
      meanThemeRecall: 1,
      meanThemePrecision: 1,
      meanRiskRecall: 1,
      meanRiskPrecision: 1,
      evidenceCoverage: 1,
      unknownEvidenceCount: 0,
      passed: true,
    })
  })

  it('fails the aggregate gate when evidence is unknown', () => {
    const result = {
      themePrecision: 1,
      themeRecall: 1,
      riskPrecision: 1,
      riskRecall: 1,
      evidenceCoverage: 1,
      unknownEvidenceCount: 1,
      passed: false,
    }
    expect(summarizeEvaluation([result]).passed).toBe(false)
  })
})
