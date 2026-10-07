import { describe, expect, it } from 'vitest'
import { buildInsightReport } from './analysis'
import { buildReportExport, reportSchemaVersion } from './report-export'
import { buildPricingScenario } from './market'
import { buildEvidencePayloadV2, buildEvidenceIntegrity, sha256Hex } from './integrity'
import { sampleDataset } from '../fixtures/usbCChargers'
import { scopeDataset } from './scope'
import { provenanceSummary } from './provenance'
import { initialCostSet } from './cost-scenario'
import { initialSensitivitySpec, buildCostSensitivity } from './cost-sensitivity'

const input = {
  category: 'USB-C', marketScope: 'US', sourceLabel: '演示', dataset: scopeDataset(sampleDataset, 'US'),
  pricingScenario: buildPricingScenario({ currency: 'USD', price: 50, landedCost: 20, platformRate: 0.15, adRate: 0.12, fixedLaunchCost: 3000 }),
}

describe('versioned report export', () => {
  it('chooses the final schema once and never downgrades combined capabilities', () => {
    expect(reportSchemaVersion('1.2', {})).toBe('1.2')
    expect(reportSchemaVersion('1.4', {})).toBe('1.4')
    expect(reportSchemaVersion('1.5', { humanReview: true })).toBe('1.5')
    expect(reportSchemaVersion('1.2', { humanReview: true })).toBe('1.3')
    expect(reportSchemaVersion('1.5', { validationTasks: true })).toBe('1.6')
    expect(reportSchemaVersion('1.6', { imageReport: true })).toBe('1.7')
    for (const imageReport of [false, true]) for (const validationTasks of [false, true]) {
      expect(reportSchemaVersion('1.5', { imageReport, validationTasks, complianceReview: true })).toBe('1.8')
    }
    expect(reportSchemaVersion('1.8', { imageReport: true })).toBe('1.8')
  })
  const report = buildInsightReport(input.dataset)
  it('exports only explicitly enabled sensitivity with distinct version and digest', () => {
    const set = initialCostSet({ productId: input.dataset.products[0].productId, market: 'US', currency: 'USD' })
    expect(buildReportExport(report, { ...input, costSet: set }).schemaVersion).toBe('1.4')
    expect(initialSensitivitySpec(set)).toBeNull()
    set.sensitivity = { schemaVersion: 'qling-cost-sensitivity/1', ranges: { price: { min: 10, max: 50 }, adRate: { min: 0, max: 0.3 }, returnRate: { min: 0, max: 0.3 }, improvement: { min: 0, max: 5 } } }
    const exported = buildReportExport(report, { ...input, costSet: set })
    expect(exported.schemaVersion).toBe('1.5')
    expect(exported.costSensitivity?.digest).toBe(buildCostSensitivity(set)!.digest)
    expect(exported.costSensitivity?.axes[0].curves[0].points[0].contribution).toBeNull()
  })
  it('adds detailed v1.4 scenarios without silently changing legacy or evidence digests', () => {
    const set = initialCostSet({ productId: input.dataset.products[0].productId, market: 'US', currency: 'USD' })
    const before = buildReportExport(report, { ...input, costSet: set })
    expect(before.schemaVersion).toBe('1.4')
    const changed = structuredClone(set)
    changed.scenarios[0].price = { value: 50, status: 'included', currency: 'USD', identity: 'user-assumption', source: '合成假设', updatedAt: null }
    const after = buildReportExport(report, { ...input, costSet: changed })
    expect(after.evidenceDigest).toBe(before.evidenceDigest)
    expect(after.scenarioDigest).toBe(before.scenarioDigest)
    expect(after.costComparison?.[0].scenarioDigest).not.toBe(before.costComparison?.[0].scenarioDigest)
  })

  it('exports separate reproducible digests and preserves legacy pricing fields', () => {
    const payload = buildReportExport(report, input)
    expect(payload.schemaVersion).toBe('1.2')
    expect(payload.evidenceIntegrity.schemaVersion).toBe('qling-evidence-chain/2')
    expect(payload.evidenceIntegrity.coverage).toBe('scoped-dataset')
    expect(sha256Hex(payload.evidencePayload)).toBe(payload.evidenceDigest)
    expect(payload.pricingScenario?.currency).toBe('USD')
    expect(payload.scenarioDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.provenance?.reviews).toBe('demo')
  })

  it('cost changes affect only the scenario digest', () => {
    const before = buildReportExport(report, input)
    const changed = buildReportExport(report, { ...input, pricingScenario: buildPricingScenario({ ...input.pricingScenario.assumptions, landedCost: 25 }) })
    expect(changed.evidenceDigest).toBe(before.evidenceDigest)
    expect(changed.scenarioDigest).not.toBe(before.scenarioDigest)
  })

  it('includes all input text even if it was not selected as an excerpt', () => {
    const dataset = structuredClone(input.dataset)
    dataset.reviews[0].body += ' extra unquoted input'
    expect(sha256Hex(buildEvidencePayloadV2(report, 'US', dataset))).not.toBe(sha256Hex(buildEvidencePayloadV2(report, 'US', input.dataset)))
  })

  it('changes on excerpt edits and analysis version edits', () => {
    const changed = structuredClone(report)
    changed.themes[0].evidence[0].excerpt += ' corrected'
    const before = buildEvidenceIntegrity(report, 'US', { version: 2 }).digest
    expect(buildEvidenceIntegrity(changed, 'US', { version: 2 }).digest).not.toBe(before)
    expect(buildEvidenceIntegrity({ ...report, analysisVersion: { rules: 'v2', model: 'local', prompt: 'none' } }, 'US', { version: 2 }).digest).not.toBe(before)
  })

  it('is stable under row, reference, and object-key reordering', () => {
    const reversed = { ...input.dataset, reviews: [...input.dataset.reviews].reverse(), products: [...input.dataset.products].reverse() }
    const reordered = { ...report, generatedAt: '2099-01-01', themes: [...report.themes].reverse().map((theme) => ({ ...theme, evidence: [...theme.evidence].reverse() })) }
    expect(buildEvidencePayloadV2(reordered, 'US', reversed)).toBe(buildEvidencePayloadV2(report, 'US', input.dataset))
  })

  it('preserves v1 identity rather than silently replacing legacy payloads', () => {
    expect(buildEvidenceIntegrity(report, 'US').schemaVersion).toBe('qling-evidence-chain/1')
    expect(buildEvidenceIntegrity(report, 'US', { version: 2 }).digest).not.toBe(buildEvidenceIntegrity(report, 'US').digest)
  })

  it('does not infer official identity from the provider or URL', () => {
    expect(provenanceSummary()).toContain('来源身份未知')
    const supplied = buildInsightReport({ ...input.dataset, provenance: { products: 'demo', reviews: 'user-provided', policies: 'unknown' } })
    expect(provenanceSummary(supplied.provenance)).toContain('用户提供 · 未独立核验')
    expect(provenanceSummary(supplied.provenance)).not.toContain('官方来源资料')
  })
})
