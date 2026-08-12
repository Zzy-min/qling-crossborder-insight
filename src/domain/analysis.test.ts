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
    expect(report.generatedAt).toBe('2026-08-12T00:00:00.000Z')
    expect(report.providerMode).toBe('fixture')
  })
})

