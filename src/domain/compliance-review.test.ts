import { describe, expect, it } from 'vitest'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { canonicalJson, sha256Hex } from './integrity'
import { buildComplianceSummary, complianceReviewBackup, readComplianceReviewBackup, createComplianceReview, validateComplianceCollection, validateComplianceReview, reassignComplianceReview, type ComplianceAssessment } from './compliance-review'
import { generateExecutiveMemoHtml } from './memo'

function context() {
  const product = { productId: 'SKU', title: 'Charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'Gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  return createAnalysisRun('workspace', buildInsightReport(dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'US', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
}
const pending: ComplianceAssessment = { topic: '电气适用性核对', applicability: 'unknown', conditions: null, productFacts: null,
  source: { title: '待查来源', authority: null, url: null, identity: 'unknown', checkedAt: null }, status: 'pending', reason: '等待供应商资料', reviewer: '本机用户' }
function rehash(value: ReturnType<typeof createComplianceReview>) {
  const { recordDigest: _digest, ...content } = value
  return { ...content, recordDigest: sha256Hex(canonicalJson(content)) }
}

describe('compliance applicability review contract', () => {
  it('keeps unknown values and does not manufacture policies or approval', () => {
    const run = context()
    const before = canonicalJson(run)
    const record = createComplianceReview(run, 'SKU', 'item', pending, 1)
    expect(buildComplianceSummary(run, [record])).toMatchObject({ pending: 1, confirmed: 0, rejected: 0 })
    expect(record.source.checkedAt).toBeNull()
    expect(canonicalJson(run)).toBe(before)
    expect(buildComplianceSummary(run, []).latest).toEqual([])
  })
  it('requires traceable conditions and product facts for either applicability confirmation', () => {
    const run = context()
    expect(() => createComplianceReview(run, 'SKU', 'item', { ...pending, status: 'confirmed' }, 1)).toThrow('人工确认')
    for (const applicability of ['applicable', 'not-applicable'] as const) {
      const record = createComplianceReview(run, 'SKU', 'item', { ...pending, status: 'confirmed', applicability,
        conditions: '待核对具体产品范围', productFacts: '用户声明的规格，未独立核验',
        source: { title: '合成测试来源', authority: '用户声明', url: 'https://example.com/policy', identity: 'user-provided', checkedAt: '2026-10-06' } }, 1)
      expect(buildComplianceSummary(run, [record]).confirmed).toBe(1)
      expect(buildComplianceSummary(run, [record]).limitation).toContain('不代表官方认证')
      for (const change of [{ applicability: 'unknown' as const }, { conditions: null }, { productFacts: null }, { source: { ...record.source, url: null } }, { source: { ...record.source, checkedAt: null } }, { source: { ...record.source, identity: 'unknown' as const, checkedAt: null } }]) {
        expect(() => validateComplianceReview(rehash({ ...record, ...change }), run)).toThrow()
      }
    }
  })
  it('rejects false dates and unsafe links without fetching any page', () => {
    const run = context()
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://user:secret@example.com', 'https://localhost', 'https://127.0.0.1']) {
      expect(() => createComplianceReview(run, 'SKU', 'item', { ...pending, source: { ...pending.source, url } }, 1)).toThrow()
    }
    expect(() => createComplianceReview(run, 'SKU', 'item', { ...pending, source: { ...pending.source, checkedAt: '2099-01-01' } }, 1)).toThrow('日期')
    expect(() => createComplianceReview(run, 'SKU', 'item', { ...pending, source: { ...pending.source, checkedAt: '2026-10-06' } }, 1)).toThrow('未知来源')
  })
  it('rejects rehashed wrong scope and extra fields', () => {
    const run = context()
    const record = createComplianceReview(run, 'SKU', 'item', pending, 1)
    for (const change of [{ workspaceId: 'other' }, { productId: 'other' }, { market: 'UK' as const }, { runDigest: '0'.repeat(64) }]) {
      expect(() => validateComplianceReview(rehash({ ...record, ...change }), run)).toThrow()
    }
    expect(() => validateComplianceReview({ ...record, apiKey: 'not-allowed' }, run)).toThrow()
    expect(() => validateComplianceReview({ ...record, reason: 'modified' }, run)).toThrow('指纹')
    expect(() => validateComplianceReview(record, { ...run, dataDigest: '0'.repeat(64) })).toThrow()
    const different = createAnalysisRun(run.workspaceId, run.report, { ...run.input, sourceLabel: 'Different input' }, run.outcome)
    expect(() => reassignComplianceReview(record, run, different)).toThrow('不能改换')
  })
  it('retains revisions and allows reconsideration without mutating earlier records', () => {
    const run = context()
    const first = createComplianceReview(run, 'SKU', 'item', pending, 1)
    const second = createComplianceReview(run, 'SKU', 'item', { ...pending, status: 'rejected', reason: '来源不足，拒绝原假设' }, 2)
    const summary = buildComplianceSummary(run, [second, first])
    expect(summary).toMatchObject({ pending: 0, rejected: 1, confirmed: 0 })
    expect(summary.records).toEqual([first, second])
    expect(summary.latest).toEqual([second])
    expect(first.status).toBe('pending')
    expect(buildComplianceSummary(run, [first]).digest).not.toBe(summary.digest)
  })
  it('rejects missing history, duplicate IDs, changed targets and absent runs', () => {
    const run = context()
    const first = createComplianceReview(run, 'SKU', 'item', pending, 1)
    const skipped = createComplianceReview(run, 'SKU', 'item', pending, 3)
    expect(() => buildComplianceSummary(run, [first, skipped])).toThrow('修订链')
    expect(() => buildComplianceSummary(run, [first, first])).toThrow('重复')
    const changed = createComplianceReview(run, 'SKU', 'item', { ...pending, topic: '不同主题' }, 2)
    expect(() => buildComplianceSummary(run, [first, changed])).toThrow('主题')
    expect(() => validateComplianceCollection([first], [])).toThrow('存档')
    expect(() => validateComplianceCollection([], [run, run])).toThrow('重复')
    expect(() => validateComplianceCollection(Array(10001).fill(first), [run])).toThrow('10,000')
  })
  it('rejects revision timestamps going backwards', () => {
    const run = context()
    const first = rehash({ ...createComplianceReview(run, 'SKU', 'item', pending, 1), createdAt: '2026-10-06T12:00:00.000Z' })
    const second = rehash({ ...createComplianceReview(run, 'SKU', 'item', pending, 2), createdAt: '2026-10-06T11:00:00.000Z' })
    expect(() => buildComplianceSummary(run, [first, second])).toThrow('时间倒退')
  })
  it('backs up the full original run and history without silently changing versions', () => {
    const run = context()
    const record = createComplianceReview(run, 'SKU', 'item', pending, 1)
    const text = complianceReviewBackup(run, [record])
    expect(JSON.parse(text).schemaVersion).toBe('qling-compliance-backup/1')
    expect(readComplianceReviewBackup(text)).toEqual({ run, records: [record] })
    const parsed = JSON.parse(text)
    parsed.records[0].reason = 'tampered'
    expect(() => readComplianceReviewBackup(JSON.stringify(parsed))).toThrow('指纹')
    expect(() => readComplianceReviewBackup(JSON.stringify({ ...JSON.parse(text), secret: 'not-allowed' }))).toThrow()
    expect(() => readComplianceReviewBackup(' '.repeat(20 * 1024 * 1024 + 1))).toThrow('20 MiB')
  })
  it('escapes every compliance field in HTML and refuses wrong scope or summary tampering', () => {
    const run = context()
    const attack = '<script>attack()</script>'
    const record = createComplianceReview(run, 'SKU', 'item', { ...pending, topic: attack, conditions: attack, productFacts: attack, reason: attack, reviewer: attack, source: { ...pending.source, title: attack, authority: attack } }, 1)
    const summary = buildComplianceSummary(run, [record])
    const options = { analysisRun: run, archive: { id: run.id, digest: run.archiveDigest, savedAt: run.createdAt }, complianceReview: summary }
    const html = generateExecutiveMemoHtml(run.report, options)
    expect(html).toContain('&lt;script&gt;attack()&lt;/script&gt;')
    expect(html).not.toContain(attack)
    expect(html).toContain(summary.digest)
    expect(html).toContain("script-src 'none'")
    expect(() => generateExecutiveMemoHtml(run.report, { ...options, archive: { ...options.archive, id: 'other' } })).toThrow('绑定')
    expect(() => generateExecutiveMemoHtml(run.report, { ...options, complianceReview: { ...summary, confirmed: 9 } })).toThrow('不匹配')
  })
})
