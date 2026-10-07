import { describe, expect, it } from 'vitest'
import { CATEGORY_PRESETS, getCategoryPreset } from './categories'
import { buildInsightReport } from '../domain/analysis'

describe('CATEGORY_PRESETS', () => {
  it('provides at least 3 distinct industry presets', () => {
    expect(CATEGORY_PRESETS.length).toBeGreaterThanOrEqual(3)
    const ids = CATEGORY_PRESETS.map((cat) => cat.id)
    expect(new Set(ids).size).toBe(CATEGORY_PRESETS.length)
  })

  it.each(CATEGORY_PRESETS)('has valid datasets for %s', (category) => {
    expect(category.dataset.products.length).toBeGreaterThan(0)
    expect(category.dataset.reviews.length).toBeGreaterThan(0)
    expect(category.dataset.policies.length).toBeGreaterThan(0)
    expect(category.defaultPrice).toBeGreaterThan(0)
    expect(category.defaultLandedCost).toBeGreaterThan(0)

    const report = buildInsightReport(category.dataset)
    expect(report.opportunityScore).toBeGreaterThanOrEqual(0)
    expect(report.themes.length).toBeGreaterThan(0)
    expect(report.complianceRisks.length).toBeGreaterThan(0)
    expect(report.visualConcepts?.length).toBeGreaterThan(0)
    expect(report.visualConcepts?.every((concept) => concept.estimatedCost === '未测算')).toBe(true)
    expect(report.visualConcepts?.every((concept) => !/98\.5|42dB|6–8|1\.5%/.test(concept.designSolution))).toBe(true)
  })

  it('getCategoryPreset returns matching or default category', () => {
    expect(getCategoryPreset('smart-pet-feeders').name).toContain('宠物')
    expect(getCategoryPreset('unknown-id').id).toBe('usb-c-chargers')
  })
})
