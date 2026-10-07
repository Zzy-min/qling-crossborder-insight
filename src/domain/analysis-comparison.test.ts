import { describe, expect, it } from 'vitest'
import { buildInsightReport, buildInsightReportFromAnalysis } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { compareAnalysisRuns, comparisonHtml } from './analysis-comparison'
import { initialProductPricing } from './product-pricing'
import { buildPricingScenario } from './market'
import { initialCostSet, type CostSet } from './cost-scenario'
import type { BatchRun, DatasetBundle, InsightReport } from './types'
import { planAnalysisBatches, completedBatchDataset } from './analysis-batch'
import { canonicalJson, sha256Hex } from './integrity'

function dataset(): DatasetBundle {
  return { products: [{ productId: 'SKU', title: 'Sample', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }],
    reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null },
      { reviewId: 'R2', productId: 'SKU', locale: 'en-US', rating: 4, title: '', body: 'fast charging', reviewedAt: '2026-10-05', verifiedPurchase: true, sourceUrl: null }],
    policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } }
}
function run(data = dataset(), options: { workspace?: string; report?: InsightReport; costs?: CostSet; outcome?: 'local' | 'online' } = {}) {
  const product = data.products[0]
  return createAnalysisRun(options.workspace ?? 'workspace', options.report ?? buildInsightReport(data), { category: '用户商品集合', sourceLabel: '合成资料', marketScope: 'ALL', dataset: data,
    pricingScenario: buildPricingScenario(initialProductPricing(product), product), ...(options.costs ? { costSet: options.costs } : {}) }, options.outcome ?? 'local')
}
function includedCosts() {
  const costs = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
  for (const scenario of costs.scenarios) {
    scenario.price = { ...scenario.price, value: 30, status: 'included' }
    for (const key of ['landed', 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement', 'fixedLaunch'] as const) scenario.costs[key] = { ...scenario.costs[key], value: 0, status: 'included' }
    scenario.costs.landed.value = 10; scenario.costs.fixedLaunch.value = 100
  }
  return costs
}

describe('scoped historical analysis comparisons', () => {
  it('compares identical scopes despite input order and does not alter archives', () => {
    const before = run()
    const data = dataset(); data.reviews.reverse()
    const after = run(data)
    const original = JSON.stringify(before)
    const value = compareAnalysisRuns(before, after, 'SKU')
    expect(value.comparable).toBe(true)
    expect(value.before.scope.sampleDigest).toBe(value.after.scope.sampleDigest)
    expect(value.rows.every(row => row.delta?.mentionCount === 0)).toBe(true)
    expect(JSON.stringify(before)).toBe(original)
    expect(compareAnalysisRuns(before, after, 'SKU')).toEqual(value)
  })
  it.each(['body', 'rating', 'locale', 'reviewedAt', 'verifiedPurchase', 'reviewId'] as const)('suppresses trend delta when %s changes, even if counts are equal', field => {
    const data = dataset()
    Object.assign(data.reviews[0], { [field]: { body: 'charger gets hot sometimes', rating: 3, locale: 'zh-CN', reviewedAt: '2026-10-04', verifiedPurchase: false, reviewId: 'NEW' }[field] })
    const value = compareAnalysisRuns(run(), run(data), 'SKU')
    expect(value.comparable).toBe(false)
    expect(value.reasons.join(' ')).toContain('样本结构变化')
    expect(value.rows.every(row => row.delta === null)).toBe(true)
  })
  it('does not intersect different samples and discloses the original shape and unknown purchase declaration', () => {
    const data = dataset(); data.reviews.pop()
    const value = compareAnalysisRuns(run(), run(data), 'SKU')
    expect(value.before.scope.sampleCount).toBe(2)
    expect(value.after.scope.sampleCount).toBe(1)
    expect(value.before.scope.structure.purchaseDeclarations).toEqual({ true: 1, unknown: 1 })
    expect(value.before.scope.timeRange).toEqual({ from: '2026-10-05', to: '2026-10-06' })
    expect(value.comparable).toBe(false)
  })
  it('rejects cross workspace, missing product, market/currency mismatch and comparing a run to itself', () => {
    const before = run()
    expect(compareAnalysisRuns(before, run(dataset(), { workspace: 'OTHER' }), 'SKU').reasons.join()).toContain('工作区')
    expect(compareAnalysisRuns(before, run(), 'MISSING').reasons.join()).toContain('没有有效')
    const data = dataset(); data.products[0].market = 'EU'; data.products[0].currency = 'EUR'
    const changed = compareAnalysisRuns(before, run(data), 'SKU')
    expect(changed.comparable).toBe(false)
    expect(changed.rows.every(row => row.delta === null)).toBe(true)
    expect(compareAnalysisRuns(before, before, 'SKU').reasons.join()).toContain('不同')
  })
  it('only compares the explicit product, not unrelated collection changes', () => {
    const data = dataset()
    data.products.push({ ...data.products[0], productId: 'OTHER', market: 'JP', currency: 'JPY' })
    data.reviews.push({ ...data.reviews[0], reviewId: 'OTHER-R', productId: 'OTHER' })
    expect(compareAnalysisRuns(run(), run(data), 'SKU').comparable).toBe(true)
  })
  it('discloses changed analysis versions and never promotes legacy IDs to aspects', () => {
    const data = dataset(); const report = buildInsightReport(data)
    report.analysisVersion!.prompt = 'changed-prompt'
    expect(compareAnalysisRuns(run(), run(data, { report }), 'SKU').reasons.join()).toContain('提示词配置变化')
    const legacy = buildInsightReport(data)
    legacy.evidenceProtocol = 1; legacy.analysisVersion!.rules = 'qling-rules/1'
    for (const theme of legacy.themes) { delete theme.aspectId; delete theme.sampleStats; delete theme.evidenceLevel; delete theme.semanticStatus; theme.evidence.forEach(reference => delete reference.quoteAnchor) }
    const value = compareAnalysisRuns(run(), run(data, { report: legacy }), 'SKU')
    expect(value.comparable).toBe(false)
    expect(value.after.findings).toEqual([])
  })
  it('keeps unique aspect counts and combines conflicting predictions as mixed', () => {
    const data = dataset(); const local = buildInsightReport(data)
    const thermal = local.themes.find(theme => theme.aspectId === 'thermal')!
    const report = buildInsightReportFromAnalysis(data, { evidenceProtocol: 2, themes: [{ ...thermal, productId: 'SKU', market: 'US' }, { ...thermal, id: 'OTHER-T', productId: 'SKU', market: 'US', sentiment: 'positive' }], complianceRisks: [] }, 'bailian')
    const before = run(data, { report, outcome: 'online' })
    const value = compareAnalysisRuns(before, run(data, { report, outcome: 'online' }), 'SKU')
    const finding = value.before.findings.find(item => item.aspectId === 'thermal')!
    expect(finding.mentionCount).toBe(1)
    expect(finding.negativeCount).toBe(0)
    expect(finding.mixedCount).toBe(1)
    expect(finding.mentionRate).toBe(0.5)
  })
  it('never treats partial or cancelled online ranges as complete and exposes original denominators', () => {
    const data = dataset()
    data.reviews = Array.from({ length: 51 }, (_, index) => ({ ...data.reviews[0], reviewId: `R${index}` }))
    const planned = planAnalysisBatches(data)
    const batch: BatchRun = { schemaVersion: 'qling-online-batches/1', runId: 'batch-run', dataDigest: sha256Hex(canonicalJson(data)), status: 'partial', batches: planned.map((item, index) => index === 0 ? { ...item.entry, status: 'completed', attempts: 1, model: 'synthetic', promptVersion: 'synthetic' } : { ...item.entry, status: 'failed', attempts: 1, error: 'evidence-contract' }) }
    const subset = completedBatchDataset(data, batch)
    const themes = buildInsightReport(subset).themes.map(theme => ({ ...theme, productId: 'SKU', market: 'US' as const }))
    const report = { ...buildInsightReportFromAnalysis(subset, { evidenceProtocol: 2, themes, complianceRisks: [], model: 'synthetic', promptVersion: 'synthetic' }, 'bailian'), batchRun: batch }
    const partial = run(data, { report, outcome: 'online' })
    const value = compareAnalysisRuns(partial, run(data), 'SKU')
    expect(value.before.scope.sampleCount).toBe(50)
    expect(value.before.scope.originalSampleCount).toBe(51)
    expect(value.reasons.join()).toContain('未完成在线批次')
    expect(value.rows.every(row => row.delta === null)).toBe(true)
    batch.status = 'cancelled'; batch.batches[1] = { ...planned[1].entry, status: 'cancelled' }
    expect(compareAnalysisRuns(run(data, { report, outcome: 'online' }), run(data), 'SKU').comparable).toBe(false)
  })
  it('keeps unknown contribution distinct from zero and cost conditions independent from changed comments', () => {
    const unknown = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
    const costs = includedCosts()
    const value = compareAnalysisRuns(run(dataset(), { costs: unknown }), run(dataset(), { costs }), 'SKU')
    expect(value.costRows[0].before?.result.contributionPerUnit).toBeNull()
    expect(value.costRows[0].contributionDelta).toBeNull()
    const changed = dataset(); changed.reviews.pop()
    const pressure = structuredClone(costs); pressure.scenarios[0].costs.landed.value = 35
    const comparison = compareAnalysisRuns(run(dataset(), { costs }), run(changed, { costs: pressure }), 'SKU')
    expect(comparison.comparable).toBe(false)
    expect(comparison.costRows[0].contributionDelta).toBe(-25)
    expect(comparison.costRows[0].breakEvenDelta).toBeNull()
    const oneSided = compareAnalysisRuns(run(), run(dataset(), { costs }), 'SKU')
    expect(oneSided.costRows[0].before).toBeNull()
    expect(oneSided.costRows[0].after?.result.contributionPerUnit).toBe(20)
    expect(oneSided.costRows[0].contributionDelta).toBeNull()
  })
  it('rejects tampered archives and escapes malicious cost sources and HTML labels without links or scripts', () => {
    const before = run(); before.input.dataset.reviews[0].body = 'tampered'
    expect(() => compareAnalysisRuns(before, run(), 'SKU')).toThrow()
    const attack = '<script>attack()</script><img src=x onerror=alert(1)>'
    const costs = includedCosts(); costs.scenarios[0].price.source = attack
    const data = dataset(); data.products[0].productId = attack; data.reviews.forEach(review => { review.productId = attack }); costs.scenarios.forEach(scenario => { scenario.target.productId = attack })
    const value = compareAnalysisRuns(run(data, { costs }), run(data, { costs }), attack)
    const html = comparisonHtml(value)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain("script-src 'none'")
    expect(html).toContain(value.digest)
  })
  it('rejects overflowing cost differences instead of exporting Infinity as JSON null with a different fingerprint', () => {
    const before = includedCosts(); const after = includedCosts()
    for (const scenario of before.scenarios) { scenario.price.value = 1e308; scenario.costs.landed.value = 0; scenario.costs.fixedLaunch.value = 0 }
    for (const scenario of after.scenarios) { scenario.price.value = 1; scenario.costs.landed.value = 1e308; scenario.costs.fixedLaunch.value = 0 }
    const value = compareAnalysisRuns(run(dataset(), { costs: before }), run(dataset(), { costs: after }), 'SKU')
    expect(value.costRows.every(row => row.contributionDelta === null)).toBe(true)
    expect(value.costRows[0].limitation).toContain('超出安全')
    expect(JSON.stringify(value)).not.toContain('Infinity')
  })
})
