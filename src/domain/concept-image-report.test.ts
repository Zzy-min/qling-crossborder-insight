import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConceptImageReport, validateConceptImageReport } from './concept-image-report'
import { createConceptImageFile } from './concept-image-file'
import { createConceptImageRequest, conceptImageBinding } from './concept-image'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { canonicalJson, sha256Hex } from './integrity'
import { buildReportExport } from './report-export'
import { generateExecutiveMemoHtml } from './memo'

beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close() {} }))))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function fixture() {
  const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-07', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-07', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  const run = createAnalysisRun('workspace', buildInsightReport(dataset), { category: 'Synthetic', sourceLabel: 'Synthetic only', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
  const theme = run.report.themes[0]
  const request = createConceptImageRequest(run, theme.id, [theme.evidence[0].quoteAnchor!], 'Untested <script>alert(1)</script> concept')
  const response = { imageId: '0123456789abcdef', mediaType: 'image/png' as const, model: 'synthetic', reviewIds: ['R1'], binding: conceptImageBinding(request), cached: false }
  const blob = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' })
  const file = await createConceptImageFile(run, theme.id, response, blob)
  return { run, file }
}
function rehash<T extends { digest: string }>(value: T) { const { digest: _digest, ...content } = value; return { ...content, digest: sha256Hex(canonicalJson(content)) } }

describe('offline image report', () => {
  it('embeds exact bytes and provenance without changing original evidence or scenario digests', async () => {
    const { run, file } = await fixture()
    const before = buildReportExport(run.report, run.input)
    const report = await buildConceptImageReport(run, [file])
    expect(report.images[0].metadata.recordDigest).toBe(file.recordDigest)
    expect(report.images[0].dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(validateConceptImageReport(report, run)).toEqual(report)
    const after = buildReportExport(run.report, run.input)
    expect(after.evidenceDigest).toBe(before.evidenceDigest)
    expect(after.scenarioDigest).toBe(before.scenarioDigest)
    expect(report.digest).not.toBe(before.evidenceDigest)
  })
  it('rejects duplicate, cross-run, altered bytes, secret fields and unsafe links even after rehashing', async () => {
    const { run, file } = await fixture()
    await expect(buildConceptImageReport(run, [file, file])).rejects.toThrow('重复')
    await expect(buildConceptImageReport({ ...run, id: 'other' }, [file])).rejects.toThrow()
    const report = await buildConceptImageReport(run, [file])
    expect(() => validateConceptImageReport({ ...report, apiKey: 'forbidden' }, run)).toThrow()
    for (const dataUrl of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', report.images[0].dataUrl.replace(/.{4}$/, 'AAAA')]) {
      expect(() => validateConceptImageReport(rehash({ ...report, images: [{ ...report.images[0], dataUrl }] }), run)).toThrow()
    }
  })
  it('requires native decoding and preserves failures rather than silently omitting images', async () => {
    const { run, file } = await fixture()
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode rejected'))
    await expect(buildConceptImageReport(run, [file])).rejects.toThrow('decode rejected')
    const controller = new AbortController(); controller.abort()
    await expect(buildConceptImageReport(run, [file], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const empty = await buildConceptImageReport(run, [])
    expect(empty.images).toEqual([])
  })
  it('keeps HTML offline and escaped, and refuses images for a different archive', async () => {
    const { run, file } = await fixture()
    const imageReport = await buildConceptImageReport(run, [file])
    const options = { imageReport, archive: { id: run.id, digest: run.archiveDigest, savedAt: run.createdAt } }
    const html = generateExecutiveMemoHtml(run.report, options)
    expect(html).toContain(imageReport.images[0].dataUrl)
    expect(html).toContain(imageReport.digest)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain("script-src 'none'")
    expect(html).toContain('未验证概念参考')
    expect(() => generateExecutiveMemoHtml(run.report, { ...options, archive: { ...options.archive, id: 'wrong' } })).toThrow('存档不匹配')
  })
  it('refuses excessive image counts and oversized serialized reports without trimming', async () => {
    const { run, file } = await fixture()
    await expect(buildConceptImageReport(run, Array(51).fill(file))).rejects.toThrow('张数上限')
    const bytes = new Uint8Array(4_000_000); bytes.set(new Uint8Array(await file.blob.arrayBuffer()))
    const large = await createConceptImageFile(run, file.themeId, file.response, new Blob([bytes], { type: 'image/png' }))
    const copies = Array.from({ length: 4 }, () => {
      const { blob, recordDigest: _digest, ...metadata } = large
      const content = { ...metadata, id: crypto.randomUUID() }
      return { ...content, blob, recordDigest: sha256Hex(canonicalJson(content)) }
    })
    await expect(buildConceptImageReport(run, copies)).rejects.toThrow('20 MiB')
  })
})
