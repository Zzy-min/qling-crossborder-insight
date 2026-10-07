import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { createConceptImageRequest, conceptImageBinding } from './concept-image'
import { createConceptImageFile, validateConceptImageFile } from './concept-image-file'
import { WorkspaceDatabase, workspaceArchiveBackup, type WorkspaceSnapshot } from './workspace'
import { workspaceArchiveBackupWithImages, readWorkspaceArchiveWithImages } from './workspace-images'
import { canonicalJson, sha256Hex } from './integrity'
import Dexie from 'dexie'
import { buildComplianceSummary, createComplianceReview } from './compliance-review'
import { createHumanReview } from './human-review'
import { createValidationTask } from './validation-task'

const databases: WorkspaceDatabase[] = []
beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close() {} }))))
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const db of databases.splice(0)) await db.delete() })
function database() { const db = new WorkspaceDatabase(crypto.randomUUID()); databases.push(db); return db }

async function fixture() {
  const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const snapshot: WorkspaceSnapshot = { version: 2, id: 'workspace', name: 'Synthetic', updatedAt: new Date().toISOString(), pricingProductId: 'SKU', productScenarios: {}, deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL', pricing: initialProductPricing(product), scenarios: {}, dataset: { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } } }
  const run = createAnalysisRun(snapshot.id, buildInsightReport(snapshot.dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset: snapshot.dataset, pricingScenario: buildPricingScenario(snapshot.pricing, product) }, 'local')
  const theme = run.report.themes[0]
  const request = createConceptImageRequest(run, theme.id, [theme.evidence[0].quoteAnchor!], 'Untested proposal')
  const response = { imageId: '0123456789abcdef', mediaType: 'image/png' as const, model: 'synthetic', reviewIds: ['R1'], binding: conceptImageBinding(request), cached: false }
  const blob = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' })
  const file = await createConceptImageFile(run, theme.id, response, blob)
  return { snapshot, run, file }
}

describe('complete workspace image backup and restoration', () => {
  it('migrates version 7 without rewriting existing workspaces or analysis', async () => {
    const { snapshot, run } = await fixture()
    const name = crypto.randomUUID()
    const old = new Dexie(name)
    old.version(7).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', conceptImages: 'id,workspaceId,runId,[workspaceId+createdAt]' })
    await old.table('workspaces').add(snapshot); await old.table('analysisRuns').add(run); old.close()
    const db = new WorkspaceDatabase(name); databases.push(db)
    expect(await db.workspaces.get(snapshot.id)).toEqual(snapshot)
    expect(await db.analysisRuns.get(run.id)).toEqual(run)
    expect(await db.complianceReviews.count()).toBe(0)
    expect(db.verno).toBe(8)
  })
  it('preserves compliant v7 backup, rebinds all revisions and rolls back failed writes', async () => {
    const { snapshot, run, file } = await fixture(); const db = database()
    const assessment = { topic: 'User checklist', applicability: 'unknown' as const, conditions: null, productFacts: null, source: { title: 'Unknown source', authority: null, url: null, identity: 'unknown' as const, checkedAt: null }, status: 'pending' as const, reason: 'Need specifications', reviewer: 'Local user' }
    const first = createComplianceReview(run, 'SKU', 'item', assessment, 1)
    const second = createComplianceReview(run, 'SKU', 'item', { ...assessment, status: 'rejected', reason: 'Insufficient source' }, 2)
    const theme = run.report.themes[0]
    const review = createHumanReview(run, theme.id, theme.evidence[0].quoteAnchor!, 'accepted', 'negative', 'Synthetic check', 1)
    const task = createValidationTask(run, theme.id, theme.evidence[0].quoteAnchor!, { title: 'Synthetic supplier check', hypothesis: 'Specifications may determine scope', metric: 'Obtain specifications', method: 'supplier', methodDetail: 'Ask supplier for technical details', expectedCost: { value: null, status: 'unknown', currency: 'USD', identity: 'user-assumption', source: null, updatedAt: null } })
    await db.save(snapshot); await db.saveAnalysisRun(run); await db.saveComplianceReview(first); await db.saveComplianceReview(second)
    await expect(db.saveComplianceReview(second)).rejects.toThrow('冲突')
    db.close(); await db.open()
    expect(await db.listComplianceReviews(snapshot.id, [run])).toEqual([first, second])
    const text = await workspaceArchiveBackupWithImages(snapshot, [run], [review], [task], [], [file], [first, second])
    expect(JSON.parse(text).schemaVersion).toBe('qling-workspace-backup/7')
    const archive = await readWorkspaceArchiveWithImages(text)
    const restored = await db.restoreArchive({ ...snapshot, id: 'clone' }, archive.analysisRuns, () => true, archive.humanReviews, archive.validationTasks, archive.taskAttachments, archive.conceptImages, archive.complianceReviews)
    const records = await db.listComplianceReviews('clone', restored)
    expect(records.map(record => record.revision)).toEqual([1, 2])
    expect(records[0].itemId).toBe(first.itemId)
    expect(records[0].source).toEqual(first.source)
    expect(records[0].runId).toBe(restored[0].id)
    expect(records[0].recordDigest).not.toBe(first.recordDigest)
    expect(buildComplianceSummary(restored[0], records).rejected).toBe(1)
    expect((await db.listValidationTasks('clone', restored)).tasks).toHaveLength(1)
    expect(await db.listHumanReviews('clone', restored)).toHaveLength(1)
    expect(await db.listConceptImages('clone')).toHaveLength(1)
    const parsed = JSON.parse(text); parsed.complianceReviews[0].reason = 'tampered'
    await expect(readWorkspaceArchiveWithImages(JSON.stringify(parsed))).rejects.toThrow('指纹')
    const count = await db.analysisRuns.count()
    const failure = vi.spyOn(db.complianceReviews, 'add').mockRejectedValueOnce(new DOMException('No space', 'QuotaExceededError'))
    await expect(db.restoreArchive({ ...snapshot, id: 'failed-compliance' }, [run], () => true, [review], [], [], [file], [first, second])).rejects.toThrow()
    failure.mockRestore()
    expect(await db.workspaces.get('failed-compliance')).toBeUndefined()
    expect(await db.analysisRuns.count()).toBe(count)
    expect((await db.restore())?.id).toBe('clone')
    expect((await readWorkspaceArchiveWithImages(workspaceArchiveBackup(snapshot, [run]))).complianceReviews).toEqual([])
  })
  it('keeps legacy formats explicit and includes every image in version 6', async () => {
    const { snapshot, run, file } = await fixture()
    expect(await workspaceArchiveBackupWithImages(snapshot, [run])).toBe(workspaceArchiveBackup(snapshot, [run]))
    const legacy = await readWorkspaceArchiveWithImages(workspaceArchiveBackup(snapshot, [run]))
    expect(legacy.conceptImages).toEqual([])
    const text = await workspaceArchiveBackupWithImages(snapshot, [run], [], [], [], [file])
    expect(JSON.parse(text).schemaVersion).toBe('qling-workspace-backup/6')
    const read = await readWorkspaceArchiveWithImages(text)
    expect(read.conceptImages).toHaveLength(1)
    expect(read.conceptImages[0].recordDigest).toBe(file.recordDigest)
    expect(new Uint8Array(await read.conceptImages[0].blob.arrayBuffer())).toEqual(new Uint8Array(await file.blob.arrayBuffer()))
  })

  it('reassigns local IDs without rewriting original generation binding, retaining a flat original lineage on repeated restore', async () => {
    const { snapshot, run, file } = await fixture(); const db = database()
    await db.save(snapshot); await db.saveAnalysisRun(run); await db.saveConceptImage(file)
    const read = await readWorkspaceArchiveWithImages(await workspaceArchiveBackupWithImages(snapshot, [run], [], [], [], [file]))
    const second = { ...snapshot, id: 'restored' }
    const runs = await db.restoreArchive(second, read.analysisRuns, () => true, [], [], [], read.conceptImages)
    const images = await db.listConceptImages(second.id)
    expect(images).toHaveLength(1)
    expect(images[0].id).not.toBe(file.id)
    expect(images[0].runId).toBe(runs[0].id)
    expect(images[0].response).toEqual(file.response)
    expect(images[0].schemaVersion).toBe('qling-concept-image-file/2')
    if (images[0].schemaVersion !== 'qling-concept-image-file/2') throw new Error('missing origin')
    expect(images[0].origin.image.recordDigest).toBe(file.recordDigest)
    const again = await readWorkspaceArchiveWithImages(await workspaceArchiveBackupWithImages(second, runs, [], [], [], images))
    const third = { ...snapshot, id: 'restored-again' }
    await db.restoreArchive(third, again.analysisRuns, () => true, [], [], [], again.conceptImages)
    const thirdImages = await db.listConceptImages(third.id)
    if (thirdImages[0].schemaVersion !== 'qling-concept-image-file/2') throw new Error('missing origin')
    expect(thirdImages[0].origin).toEqual(images[0].origin)
    expect(await db.conceptImages.count()).toBe(3)
    expect((await db.listConceptImages(snapshot.id))[0].recordDigest).toBe(file.recordDigest)
  })

  it('rejects duplicates, missing/cross-scope runs, extra fields, corrupt nested bytes and mismatched origin', async () => {
    const { snapshot, run, file } = await fixture()
    await expect(workspaceArchiveBackupWithImages(snapshot, [run], [], [], [], [file, file])).rejects.toThrow()
    await expect(workspaceArchiveBackupWithImages(snapshot, [], [], [], [], [file])).rejects.toThrow()
    await expect(workspaceArchiveBackupWithImages({ ...snapshot, id: 'other' }, [run], [], [], [], [file])).rejects.toThrow()
    const parsed = JSON.parse(await workspaceArchiveBackupWithImages(snapshot, [run], [], [], [], [file]))
    await expect(readWorkspaceArchiveWithImages(JSON.stringify({ ...parsed, apiKey: 'not-permitted' }))).rejects.toThrow()
    const nested = JSON.parse(parsed.conceptImages[0]); nested.data = btoa('bad data'); parsed.conceptImages[0] = JSON.stringify(nested)
    await expect(readWorkspaceArchiveWithImages(JSON.stringify(parsed))).rejects.toThrow()
    const db = database(); const runs = await db.restoreArchive({ ...snapshot, id: 'clone' }, [run], () => true, [], [], [], [file])
    const restored = (await db.listConceptImages('clone'))[0]
    if (restored.schemaVersion !== 'qling-concept-image-file/2') throw new Error('missing origin')
    const changed = { ...restored, themeId: 'different-theme' }
    const { blob: _blob, recordDigest: _digest, ...content } = changed
    changed.recordDigest = sha256Hex(canonicalJson(content))
    await expect(validateConceptImageFile(changed, runs[0])).rejects.toThrow('不能改写')
  })

  it('rolls back workspace, runs and active setting on image quota/write failure', async () => {
    const { snapshot, run, file } = await fixture(); const db = database()
    await db.save(snapshot); await db.saveAnalysisRun(run); await db.saveConceptImage(file)
    const failure = vi.spyOn(db.conceptImages, 'add').mockRejectedValueOnce(new DOMException('No space', 'QuotaExceededError'))
    await expect(db.restoreArchive({ ...snapshot, id: 'failed' }, [run], () => true, [], [], [], [file])).rejects.toMatchObject({ name: 'QuotaExceededError' })
    failure.mockRestore()
    expect(await db.workspaces.get('failed')).toBeUndefined()
    expect(await db.analysisRuns.count()).toBe(1)
    expect(await db.conceptImages.count()).toBe(1)
    expect((await db.restore())?.id).toBe(snapshot.id)
  })

  it('refuses invalidated restores without touching original data', async () => {
    const { snapshot, run, file } = await fixture(); const db = database()
    await db.save(snapshot)
    await expect(db.restoreArchive({ ...snapshot, id: 'stale' }, [run], () => false, [], [], [], [file])).rejects.toThrow('已失效')
    expect(await db.analysisRuns.count()).toBe(0)
    expect(await db.conceptImages.count()).toBe(0)
    expect((await db.restore())?.id).toBe(snapshot.id)
  })
})
