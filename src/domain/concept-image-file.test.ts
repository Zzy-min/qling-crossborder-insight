import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { createConceptImageRequest, conceptImageBinding } from './concept-image'
import { createConceptImageFile, fetchConceptImageFile, validateConceptImageFile, conceptImageFileLimits, conceptImageFileBackup, readConceptImageFileBackup } from './concept-image-file'
import { canonicalJson, sha256Hex } from './integrity'
import { WorkspaceDatabase } from './workspace'
import { ProxyProvider } from '../providers/provider'
import Dexie from 'dexie'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=', 'base64'))
const databases: WorkspaceDatabase[] = []
const closeBitmap = vi.fn()
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: closeBitmap }))) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); closeBitmap.mockClear(); for (const db of databases.splice(0)) await db.delete() })

function fixture() {
  const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  const run = createAnalysisRun('workspace', buildInsightReport(dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
  const theme = run.report.themes[0]
  const input = createConceptImageRequest(run, theme.id, [theme.evidence[0].quoteAnchor!], 'Untested prototype')
  const response = { imageId: '0123456789abcdef', mediaType: 'image/png' as const, model: 'synthetic', reviewIds: ['R1'], binding: conceptImageBinding(input), cached: false }
  const blob = new Blob([png], { type: 'image/png' })
  return { run, theme, response, blob }
}
function database(name = crypto.randomUUID()) { const db = new WorkspaceDatabase(name); databases.push(db); return db }

describe('concept image binary and local persistence', () => {
  it('refuses PNG pixel bombs before calling the native decoder and rejects header/decode disagreement', async () => {
    const { run, theme, response, blob } = fixture()
    const bomb = new Uint8Array(png)
    const header = new DataView(bomb.buffer)
    header.setUint32(16, 100000); header.setUint32(20, 100000)
    await expect(createConceptImageFile(run, theme.id, response, new Blob([bomb], { type: 'image/png' }))).rejects.toThrow('解码前拒绝')
    expect(createImageBitmap).not.toHaveBeenCalled()
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 2, height: 1, close: closeBitmap } as unknown as ImageBitmap)
    await expect(createConceptImageFile(run, theme.id, response, blob)).rejects.toThrow('文件头不匹配')
    expect(closeBitmap).toHaveBeenCalledOnce()
  })
  it('binds decoded pixels, full bytes and immutable metadata to the saved analysis', async () => {
    const { run, theme, response, blob } = fixture()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    expect(file.fileDigest).toBe(sha256Hex(png))
    expect(file.identity).toBe('unverified-concept-reference')
    expect(file.width).toBe(1)
    expect(closeBitmap).toHaveBeenCalledOnce()
    expect(await validateConceptImageFile(file, run)).toEqual(file)
    const altered = { ...file, blob: new Blob([png, 'changed'], { type: 'image/png' }) }
    await expect(validateConceptImageFile(altered, run)).rejects.toThrow('内容指纹')
    await expect(validateConceptImageFile({ ...file, runDigest: '0'.repeat(64) }, run)).rejects.toThrow()
    await expect(createConceptImageFile(run, theme.id, { ...response, apiKey: 'secret' }, blob)).rejects.toThrow()
  })

  it('rejects MIME/header spoofing, failed decode, zero/huge dimensions and missing decoder', async () => {
    const { run, theme, response, blob } = fixture()
    await expect(createConceptImageFile(run, theme.id, response, new Blob(['<svg onload="attack()"/>'], { type: 'image/png' }))).rejects.toThrow('内容与类型')
    await expect(createConceptImageFile(run, theme.id, response, new Blob([png], { type: 'image/svg+xml' }))).rejects.toThrow()
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'))
    await expect(createConceptImageFile(run, theme.id, response, blob)).rejects.toThrow('decode failed')
    for (const dimensions of [{ width: 0, height: 1 }, { width: 4097, height: 1 }, { width: 4096, height: 4096 }]) {
      vi.mocked(createImageBitmap).mockResolvedValueOnce({ ...dimensions, close: closeBitmap } as unknown as ImageBitmap)
      await expect(createConceptImageFile(run, theme.id, response, blob)).rejects.toThrow('尺寸')
    }
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(createConceptImageFile(run, theme.id, response, blob)).rejects.toThrow('不能解码')
  })

  it('downloads only a validated proxy path and ignores a supplied remote image URL', async () => {
    const { run, theme, response } = fixture()
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      expect(url).toBe('/api/images/0123456789abcdef')
      expect(options?.redirect).toBe('error')
      expect(options?.headers).toEqual({ Accept: 'image/png' })
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    })
    const file = await new ProxyProvider({ fetcher }).downloadAnchoredConceptImage(run, theme.id, { ...response, imageUrl: 'https://attacker.example/image' })
    expect(file.bytes).toBe(png.length)
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(new ProxyProvider({ fetcher }).downloadAnchoredConceptImage(run, theme.id, { ...response, imageId: '../private' })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects wrong download headers or size before decode, bounds streamed bytes and cancels hanging reads', async () => {
    const { run, theme, response } = fixture()
    for (const downloaded of [new Response(png, { headers: { 'content-type': 'text/html' } }), new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '4000001' } })]) {
      await expect(fetchConceptImageFile(async () => downloaded, '/unused', run, theme.id, response, new AbortController().signal)).rejects.toThrow('下载失败')
    }
    const cancelled = vi.fn()
    await expect(fetchConceptImageFile(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4_000_001)) }, cancel: cancelled }), { headers: { 'content-type': 'image/png' } }), '/unused', run, theme.id, response, new AbortController().signal)).rejects.toThrow('4 MB')
    expect(cancelled).toHaveBeenCalledOnce()
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve })
    const controller = new AbortController()
    const pending = fetchConceptImageFile(async () => new Response(new ReadableStream({ pull() { started() }, cancel: cancelled }), { headers: { 'content-type': 'image/png' } }), '/unused', run, theme.id, response, controller.signal)
    await ready; controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('retains actual Blobs across close/reopen, isolates workspaces and never overwrites an existing image', async () => {
    const { run, theme, response, blob } = fixture(); const db = database()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    await expect(db.saveConceptImage(file)).rejects.toThrow('已保存')
    await db.saveAnalysisRun(run)
    await db.saveConceptImage(file)
    await expect(db.saveConceptImage(file)).rejects.toThrow()
    db.close(); await db.open()
    const stored = await db.listConceptImages(run.workspaceId)
    expect(stored).toHaveLength(1)
    expect(stored[0].blob instanceof Blob).toBe(true)
    expect(new Uint8Array(await stored[0].blob.arrayBuffer())).toEqual(png)
    expect(await db.listConceptImages('other-workspace')).toEqual([])
  })

  it('serializes concurrent saves against the 50-image quota, keeping all existing files', async () => {
    const { run, theme, response, blob } = fixture(); const db = database()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    await db.saveAnalysisRun(run)
    const fresh = () => {
      const { recordDigest: _digest, blob: storedBlob, ...content } = file
      const next = { ...content, id: crypto.randomUUID() }
      return { ...next, recordDigest: sha256Hex(canonicalJson(next)), blob: storedBlob }
    }
    await db.conceptImages.bulkAdd(Array.from({ length: conceptImageFileLimits.count - 1 }, fresh))
    const results = await Promise.allSettled([db.saveConceptImage(fresh()), db.saveConceptImage(fresh())])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await db.conceptImages.count()).toBe(50)
  })

  it('quota/write failures propagate without claiming persistence and permit a later explicit retry', async () => {
    const { run, theme, response, blob } = fixture(); const db = database()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    await db.saveAnalysisRun(run)
    const failed = vi.spyOn(db.conceptImages, 'add').mockRejectedValueOnce(new DOMException('No storage', 'QuotaExceededError'))
    await expect(db.saveConceptImage(file)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await db.conceptImages.count()).toBe(0)
    expect(await db.analysisRuns.count()).toBe(1)
    failed.mockRestore()
    await db.saveConceptImage(file)
    expect(await db.conceptImages.count()).toBe(1)
  })

  it('enforces workspace and total byte quotas without deleting any records', async () => {
    const { run, theme, response, blob } = fixture(); const db = database()
    await db.saveAnalysisRun(run)
    const largeBlob = new Blob([png, new Uint8Array(conceptImageFileLimits.bytes - png.length)], { type: 'image/png' })
    const large = await createConceptImageFile(run, theme.id, response, largeBlob)
    const small = await createConceptImageFile(run, theme.id, response, blob)
    const copy = (file: typeof large) => {
      const { blob: storedBlob, recordDigest: _digest, ...content } = file
      const next = { ...content, id: crypto.randomUUID() }
      return { ...next, blob: storedBlob, recordDigest: sha256Hex(canonicalJson(next)) }
    }
    await db.conceptImages.bulkAdd(Array.from({ length: 5 }, () => copy(large)))
    await expect(db.saveConceptImage(small)).rejects.toThrow('额度不足')
    expect(await db.conceptImages.count()).toBe(5)
    for (let index = 0; index < 4; index += 1) {
      const other = createAnalysisRun(`other-${index}`, run.report, run.input, run.outcome)
      await db.saveAnalysisRun(other)
      const request = createConceptImageRequest(other, theme.id, response.binding.anchors, response.binding.hypothesis)
      const otherFile = await createConceptImageFile(other, theme.id, { ...response, binding: conceptImageBinding(request) }, largeBlob)
      await db.conceptImages.bulkAdd(Array.from({ length: 5 }, () => copy(otherFile)))
    }
    const empty = createAnalysisRun('empty-workspace', run.report, run.input, run.outcome)
    await db.saveAnalysisRun(empty)
    const request = createConceptImageRequest(empty, theme.id, response.binding.anchors, response.binding.hypothesis)
    const emptyFile = await createConceptImageFile(empty, theme.id, { ...response, binding: conceptImageBinding(request) }, blob)
    await expect(db.saveConceptImage(emptyFile)).rejects.toThrow('额度不足')
    expect(await db.conceptImages.count()).toBe(25)
  })

  it('cancellation or scope invalidation during saving rolls back the image write', async () => {
    const { run, theme, response, blob } = fixture(); const db = database()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    await db.saveAnalysisRun(run)
    const controller = new AbortController(); controller.abort()
    await expect(db.saveConceptImage(file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    let current = true
    const originalAdd = db.conceptImages.add.bind(db.conceptImages)
    const invalidate = vi.spyOn(db.conceptImages, 'add').mockImplementation(record => originalAdd(record).then(key => { current = false; return key }))
    await expect(db.saveConceptImage(file, { stillCurrent: () => current })).rejects.toThrow('已失效')
    expect(await db.conceptImages.count()).toBe(0)
    invalidate.mockRestore()
  })

  it('latest database preserves the version 7 Blob table without rewriting version 6 analysis records', async () => {
    const { run } = fixture(); const name = crypto.randomUUID()
    const old = new Dexie(name)
    old.version(6).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]', validationTasks: 'id,workspaceId,runId,taskId,&[taskId+revision]', taskAttachments: 'id,workspaceId,taskId', mappingTemplates: 'id,createdAt' })
    await old.table('analysisRuns').add(run); await old.table('settings').add({ key: 'sentinel', value: 'unchanged' }); old.close()
    const db = database(name); await db.open()
    expect(await db.analysisRuns.get(run.id)).toEqual(run)
    expect(await db.settings.get('sentinel')).toEqual({ key: 'sentinel', value: 'unchanged' })
    expect(await db.conceptImages.count()).toBe(0)
    expect(db.verno).toBe(8)
  })

  it('backs up an unsaved image with its original run and restores identical bytes without secrets or silent version upgrades', async () => {
    const { run, theme, response, blob } = fixture()
    const file = await createConceptImageFile(run, theme.id, response, blob)
    const text = await conceptImageFileBackup(file, run)
    const restored = await readConceptImageFileBackup(text)
    expect(restored.run).toEqual(run)
    expect(restored.file.recordDigest).toBe(file.recordDigest)
    expect(restored.file.response.binding).toEqual(response.binding)
    expect(new Uint8Array(await restored.file.blob.arrayBuffer())).toEqual(png)
    expect(JSON.parse(text).schemaVersion).toBe('qling-concept-image-backup/1')
    expect(text).not.toContain('apiKey')
    const db = database(); await db.saveAnalysisRun(restored.run); await db.saveConceptImage(restored.file)
    expect(await db.conceptImages.count()).toBe(1)
    const secret = { ...JSON.parse(text), apiKey: 'not-permitted' }
    await expect(readConceptImageFileBackup(JSON.stringify(secret))).rejects.toThrow()
    const wrongBytes = JSON.parse(text); wrongBytes.data = btoa('changed')
    await expect(readConceptImageFileBackup(JSON.stringify(wrongBytes))).rejects.toThrow()
    const wrongScope = JSON.parse(text); wrongScope.image.workspaceId = 'other'
    await expect(readConceptImageFileBackup(JSON.stringify(wrongScope))).rejects.toThrow()
    const futureVersion = JSON.parse(text); futureVersion.schemaVersion = 'qling-concept-image-backup/2'
    await expect(readConceptImageFileBackup(JSON.stringify(futureVersion))).rejects.toThrow()
  })
})
