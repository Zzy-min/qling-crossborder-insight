import { describe, expect, it } from 'vitest'
import { buildInsightReport } from '../domain/analysis'
import { sampleDataset } from '../fixtures/usbCChargers'
import { evaluateReport } from './evaluate'

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
      themeRecall: 1,
      riskRecall: 1,
      evidenceCoverage: 1,
      unknownEvidenceCount: 0,
      passed: true,
    })
  })
})
