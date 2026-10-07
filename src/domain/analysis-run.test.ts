import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnalysisRun, validateAnalysisRun, analysisRunBackup } from './analysis-run'
import { buildInsightReport } from './analysis'
import { initialProductPricing } from './product-pricing'
import { buildPricingScenario } from './market'
import { initialCostSet } from './cost-scenario'
import { WorkspaceDatabase, readWorkspaceArchive, workspaceArchiveBackup } from './workspace'
import { canonicalJson, sha256Hex } from './integrity'
import type { WorkspaceSnapshot } from './workspace'

function snapshot(): WorkspaceSnapshot {
  const product = { productId: 'SKU', title: 'Charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  return { version: 2, id: 'workspace', name: 'Seller input', updatedAt: new Date().toISOString(), pricingProductId: 'SKU', productScenarios: {},
    dataset: { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'Charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } },
    deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL', pricing: initialProductPricing(product), scenarios: {} }
}

function run() {
  const workspace = snapshot()
  const product = workspace.dataset.products[0]
  return createAnalysisRun(workspace.id, buildInsightReport(workspace.dataset), { category: '用户商品集合', sourceLabel: 'Seller input', marketScope: 'ALL', dataset: workspace.dataset,
    pricingScenario: buildPricingScenario(workspace.pricing, { productId: product.productId, market: product.market, currency: product.currency }) }, 'local')
}

function rehash(value: ReturnType<typeof run>) {
  const { archiveDigest: _digest, ...content } = value
  return { ...content, archiveDigest: sha256Hex(canonicalJson(content)) }
}
const databases: WorkspaceDatabase[] = []
it('binds detailed costs to original archived target and rejects rehashed foreign scenarios', () => {
  const original = run()
  const set = initialCostSet(original.input.pricingScenario.target)
  const archived = createAnalysisRun(original.workspaceId, original.report, { ...original.input, costSet: set }, 'local')
  expect(validateAnalysisRun(JSON.parse(analysisRunBackup(archived)))).toEqual(archived)
  const changed = structuredClone(archived)
  changed.input.costSet!.scenarios.forEach(scenario => { scenario.target.productId = 'OTHER' })
  expect(() => validateAnalysisRun(rehash(changed))).toThrow('明细情景')
  expect(original.input).not.toHaveProperty('costSet')
})
const create = () => { const database = new WorkspaceDatabase(crypto.randomUUID()); databases.push(database); return database }
afterEach(async () => { for (const database of databases.splice(0)) await database.delete() })

describe('immutable analysis archives', () => {
  it('retains old records without adding anchors or rewriting their digests', () => {
    const workspace = snapshot()
    const current = run()
    const report = structuredClone(current.report)
    delete report.evidenceProtocol
    report.analysisVersion!.rules = 'qling-rules/1'
    for (const theme of report.themes) {
      delete theme.sampleStats
      delete theme.aspectId
      delete theme.evidenceLevel
      delete theme.semanticStatus
      for (const reference of theme.evidence) delete reference.quoteAnchor
    }
    const legacy = createAnalysisRun(workspace.id, report, current.input, 'local')
    expect(validateAnalysisRun(JSON.parse(analysisRunBackup(legacy)))).toEqual(legacy)
    expect(legacy.report.themes[0].evidence[0].quoteAnchor).toBeUndefined()
  })
  it('rejects tampered or missing anchors even after the archive is rehashed', () => {
    const changed = run()
    changed.report.themes[0].evidence[0].quoteAnchor!.quote = 'fake'
    expect(() => validateAnalysisRun(rehash(changed))).toThrow('invalid_quote_text')
    const missing = run()
    delete missing.report.themes[0].evidence[0].quoteAnchor
    expect(() => validateAnalysisRun(rehash(missing))).toThrow('锚点证据不完整')
  })
  it('rejects forged denominators even after rehashing the archive', () => {
    const changed = run()
    changed.report.themes[0].sampleStats![0].sampleCount = 999
    expect(() => validateAnalysisRun(rehash(changed))).toThrow('样本统计不匹配')
  })
  it('retains report versions, scoped original text and separate digests', () => {
    const archived = run()
    expect(archived.report.analysisVersion?.model).toBe('local-rules')
    expect(archived.input.dataset.reviews[0].body).toBe('Charger gets hot')
    expect(validateAnalysisRun(JSON.parse(analysisRunBackup(archived)))).toEqual(archived)
    expect(archived.archiveDigest).toMatch(/^[a-f0-9]{64}$/)
  })
  it('clones inputs rather than retaining mutable live references', () => {
    const workspace = snapshot()
    const product = workspace.dataset.products[0]
    const report = buildInsightReport(workspace.dataset)
    const archived = createAnalysisRun(workspace.id, report, { category: '用户商品集合', sourceLabel: 'Test', marketScope: 'ALL', dataset: workspace.dataset, pricingScenario: buildPricingScenario(workspace.pricing, product) }, 'local')
    workspace.dataset.reviews[0].body = 'changed'
    report.recommendation = 'changed'
    expect(archived.input.dataset.reviews[0].body).not.toBe('changed')
    expect(archived.report.recommendation).not.toBe('changed')
  })
  it('rejects changed text or costs, including full-report fields outside evidence digest', () => {
    const archived = run()
    archived.report.recommendation = 'altered recommendation'
    expect(() => validateAnalysisRun(archived)).toThrow('内容指纹')
    const changed = run()
    changed.input.pricingScenario.assumptions.price = 100
    expect(() => validateAnalysisRun(rehash(changed))).toThrow('指纹不匹配')
  })
  it('rejects missing references and dishonest source/mode labels even after rehash', () => {
    const changed = run()
    changed.report.themes[0].evidence[0].recordId = 'missing'
    expect(() => validateAnalysisRun(rehash(changed))).toThrow('存档引用')
    const mode = run()
    mode.outcome = 'online'
    expect(() => validateAnalysisRun(rehash(mode))).toThrow('模式')
    expect(() => validateAnalysisRun({ ...run(), apiKey: 'must-not-store' })).toThrow()
  })
  it('rejects action and concept references outside saved scope', () => {
    const action = run()
    action.report.actions[0].evidenceRecordIds = ['missing']
    expect(() => validateAnalysisRun(rehash(action))).toThrow('行动引用')
    const concept = run()
    concept.report.visualConcepts![0].citableReviewIds = ['missing']
    expect(() => validateAnalysisRun(rehash(concept))).toThrow('概念引用')
  })
  it('persists immutable runs and isolates them by workspace', async () => {
    const database = create()
    const archived = run()
    await database.saveAnalysisRun(archived)
    await expect(database.saveAnalysisRun(archived)).rejects.toThrow()
    database.close()
    await database.open()
    expect(await database.listAnalysisRuns('workspace')).toEqual([archived])
    expect(await database.listAnalysisRuns('other')).toEqual([])
  })
  it('reports quota failures without leaving partial history', async () => {
    const database = create()
    const failure = vi.spyOn(database.analysisRuns, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(database.saveAnalysisRun(run())).rejects.toThrow('full')
    failure.mockRestore()
    expect(await database.listAnalysisRuns('workspace')).toEqual([])
  })
  it('round-trips workspace + history backup, reassigning IDs on restore', async () => {
    const workspace = snapshot()
    const original = run()
    const archive = readWorkspaceArchive(workspaceArchiveBackup(workspace, [original]))
    const database = create()
    const imported = await database.restoreArchive({ ...archive.workspace, id: 'restored' }, archive.analysisRuns)
    expect(imported[0].id).not.toBe(original.id)
    expect(imported[0].workspaceId).toBe('restored')
    expect(imported[0].evidenceDigest).toBe(original.evidenceDigest)
    expect(imported[0].scenarioDigest).toBe(original.scenarioDigest)
    expect((await database.listAnalysisRuns('restored'))[0].report.generatedAt).toBe(original.report.generatedAt)
  })
  it('rejects cross-workspace history before any writes', () => {
    expect(() => workspaceArchiveBackup({ ...snapshot(), id: 'other' }, [run()])).toThrow('不属于')
    const text = JSON.stringify({ schemaVersion: 'qling-workspace-backup/3', workspace: snapshot(), analysisRuns: [{ ...run(), report: {} }] })
    expect(() => readWorkspaceArchive(text)).toThrow()
  })
  it('restores workspace and runs atomically, rolling back if operation changes', async () => {
    const database = create()
    const failure = vi.spyOn(database.settings, 'put').mockRejectedValue(new Error('settings failed'))
    await expect(database.restoreArchive(snapshot(), [run()])).rejects.toThrow('settings failed')
    failure.mockRestore()
    expect(await database.workspaces.count()).toBe(0)
    expect(await database.analysisRuns.count()).toBe(0)
    let checks = 0
    await expect(database.restoreArchive(snapshot(), [run()], () => ++checks === 1)).rejects.toThrow('已失效')
    expect(await database.workspaces.count()).toBe(0)
    expect(await database.analysisRuns.count()).toBe(0)
  })
})
