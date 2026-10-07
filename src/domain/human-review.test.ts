import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHumanReview, validateHumanReview, buildReviewSummary } from './human-review'
import { createAnalysisRun } from './analysis-run'
import { buildInsightReport } from './analysis'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { WorkspaceDatabase, readWorkspaceArchive, workspaceArchiveBackup } from './workspace'
import type { WorkspaceSnapshot } from './workspace'
import { canonicalJson, sha256Hex } from './integrity'
import { generateExecutiveMemoHtml } from './memo'

function context() {
  const product = { productId: 'SKU', title: 'Charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const workspace: WorkspaceSnapshot = { version: 2, id: 'workspace', name: 'Review', updatedAt: new Date().toISOString(), pricingProductId: product.productId, productScenarios: {}, pricing: initialProductPricing(product),
    dataset: { products: [product], reviews: Array.from({ length: 20 }, (_, index) => ({ reviewId: `R${index}`, productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: index < 4 ? 'Charger gets hot' : 'Simple charger', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null })), policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } },
    deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL', scenarios: {} }
  const run = createAnalysisRun(workspace.id, buildInsightReport(workspace.dataset), { category: '用户商品集合', sourceLabel: 'Test', marketScope: 'ALL', dataset: workspace.dataset, pricingScenario: buildPricingScenario(workspace.pricing, product) }, 'local')
  const theme = run.report.themes[0]
  const anchor = theme.evidence[0].quoteAnchor!
  const record = createHumanReview(run, theme.id, anchor, 'accepted', 'negative', '原文支持方面和情绪', 1)
  return { workspace, run, theme, anchor, record }
}
const databases: WorkspaceDatabase[] = []
const database = () => { const value = new WorkspaceDatabase(crypto.randomUUID()); databases.push(value); return value }
afterEach(async () => { for (const value of databases.splice(0)) await value.delete() })

describe('human review audit contract', () => {
  it('keeps original predictions and separates confirmed, rejected and pending', () => {
    const { run, theme, anchor, record } = context()
    const before = canonicalJson(run)
    const corrected = createHumanReview(run, theme.id, anchor, 'accepted', 'mixed', '部分正向，部分负向', 2)
    const summary = buildReviewSummary(run, [record, corrected])
    expect(summary).toMatchObject({ accepted: 1, rejected: 0, pending: 3 })
    expect(summary.statistics[0].sample).toMatchObject({ basis: 'human-reviewed', sampleCount: 20, mentionCount: 1, negativeCount: 0, mixedCount: 1, quadrant: null })
    const rejected = createHumanReview(run, theme.id, anchor, 'rejected', null, '不足以支持此方面', 3)
    expect(buildReviewSummary(run, [record, corrected, rejected])).toMatchObject({ accepted: 0, rejected: 1, pending: 3, statistics: [] })
    expect(canonicalJson(run)).toBe(before)
    expect(corrected.originalSentiment).toBe('negative')
  })
  it('uses accepted unique reviews and the complete sample denominator', () => {
    const { run, theme } = context()
    const records = theme.evidence.map((reference, index) => createHumanReview(run, theme.id, reference.quoteAnchor!, 'accepted', index < 3 ? 'negative' : 'neutral', '已核对上下文', index + 1))
    expect(buildReviewSummary(run, records).statistics[0].sample).toMatchObject({ sampleCount: 20, mentionCount: 4, negativeCount: 3, mentionRate: .2, negativeRate: .75, quadrant: 'high-mention-high-negative' })
  })
  it('rejects wrong scope, offsets, prediction, secrets, missing reasons and decision contradictions', () => {
    const { run, theme, anchor, record } = context()
    for (const change of [{ workspaceId: 'other' }, { runDigest: '0'.repeat(64) }, { anchor: { ...anchor, end: anchor.end + 1 } }, { originalSentiment: 'positive' }, { decision: 'rejected' }]) {
      const { recordDigest: _digest, ...content } = { ...record, ...change }
      expect(() => validateHumanReview({ ...content, recordDigest: sha256Hex(canonicalJson(content)) }, run)).toThrow()
    }
    expect(() => validateHumanReview({ ...record, apiKey: 'not-allowed' }, run)).toThrow()
    expect(() => createHumanReview(run, theme.id, anchor, 'accepted', 'negative', '  ', 2)).toThrow()
    expect(() => validateHumanReview({ ...record, reason: 'changed' }, run)).toThrow('指纹')
    expect(() => buildReviewSummary(run, [record, { ...record }])).toThrow('重复')
    const skipped = createHumanReview(run, theme.id, anchor, 'accepted', 'negative', '缺失先前事件', 2)
    expect(() => buildReviewSummary(run, [skipped])).toThrow('修订链不完整')
  })
  it('persists revisions without overwrites and restores after reopening', async () => {
    const db = database()
    const { run, record, theme, anchor } = context()
    await expect(db.saveHumanReview(record)).rejects.toThrow('请先')
    await db.saveAnalysisRun(run)
    await db.saveHumanReview(record)
    await expect(db.saveHumanReview(record)).rejects.toThrow('冲突')
    await db.saveHumanReview(createHumanReview(run, theme.id, anchor, 'rejected', null, '重新判断', 2))
    db.close()
    await db.open()
    const records = await db.listHumanReviews(run.workspaceId, [run])
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual(record)
    expect(buildReviewSummary(run, records).rejected).toBe(1)
    expect(await db.listHumanReviews('other', [])).toEqual([])
  })
  it('rejects concurrent stale revisions atomically', async () => {
    const db = database()
    const { run, record, theme, anchor } = context()
    await db.saveAnalysisRun(run)
    const second = createHumanReview(run, theme.id, anchor, 'rejected', null, '另一个标签页', 1)
    const results = await Promise.allSettled([db.saveHumanReview(record), db.saveHumanReview(second)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.humanReviews.count()).toBe(1)
  })
  it('keeps quota failures out of saved statistics and allows retry', async () => {
    const db = database()
    const { run, record } = context()
    await db.saveAnalysisRun(run)
    const failure = vi.spyOn(db.humanReviews, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(db.saveHumanReview(record)).rejects.toThrow('full')
    failure.mockRestore()
    expect(await db.listHumanReviews(run.workspaceId, [run])).toEqual([])
    await db.saveHumanReview(record)
    expect(await db.humanReviews.count()).toBe(1)
  })
  it('round-trips v4 backups, reassigns review scopes, preserves old report digests', async () => {
    const { workspace, run, record } = context()
    const archive = readWorkspaceArchive(workspaceArchiveBackup(workspace, [run], [record]))
    expect(archive.humanReviews).toEqual([record])
    const db = database()
    const [restored] = await db.restoreArchive({ ...workspace, id: 'restored' }, archive.analysisRuns, () => true, archive.humanReviews)
    const reviews = await db.listHumanReviews('restored', [restored])
    expect(reviews[0]).toMatchObject({ workspaceId: 'restored', runId: restored.id, reason: record.reason, originalSentiment: record.originalSentiment })
    expect(restored.evidenceDigest).toBe(run.evidenceDigest)
    expect(restored.scenarioDigest).toBe(run.scenarioDigest)
    expect(buildReviewSummary(restored, reviews).accepted).toBe(1)
    const legacy = JSON.parse(workspaceArchiveBackup(workspace, [run]))
    legacy.schemaVersion = 'qling-workspace-backup/3'
    delete legacy.humanReviews
    expect(readWorkspaceArchive(JSON.stringify(legacy)).humanReviews).toEqual([])
  })
  it('rolls back all restored tables on review write failure', async () => {
    const db = database()
    const { workspace, run, record } = context()
    const failure = vi.spyOn(db.humanReviews, 'add').mockRejectedValue(new Error('review write failed'))
    await expect(db.restoreArchive(workspace, [run], () => true, [record])).rejects.toThrow('review write failed')
    failure.mockRestore()
    expect(await db.workspaces.count()).toBe(0)
    expect(await db.analysisRuns.count()).toBe(0)
    expect(await db.humanReviews.count()).toBe(0)
  })
  it('adds v4 review table without manufacturing annotations for v3 history', async () => {
    const db = database()
    const { workspace, run } = context()
    const old = new Dexie(db.name)
    old.version(3).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]' })
    await old.table('workspaces').add(workspace)
    await old.table('analysisRuns').add(run)
    old.close()
    await db.open()
    expect(await db.listAnalysisRuns(workspace.id)).toEqual([run])
    expect(await db.listHumanReviews(workspace.id, [run])).toEqual([])
  })
  it('escapes malicious review reasons and retains separate fingerprints in HTML', () => {
    const { run, theme, anchor } = context()
    const record = createHumanReview(run, theme.id, anchor, 'rejected', null, '<img src=x onerror=alert(1)><script>evil()</script>', 1)
    const summary = buildReviewSummary(run, [record])
    const html = generateExecutiveMemoHtml(run.report, { humanReview: summary })
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain(summary.digest)
    expect(html).toContain('人工驳回 1')
  })
})
