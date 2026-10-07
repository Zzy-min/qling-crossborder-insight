import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import Dexie from 'dexie'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { initialCostSet } from './cost-scenario'
import { WorkspaceDatabase, workspaceArchiveBackup, readWorkspaceArchive, type WorkspaceSnapshot } from './workspace'
import { canonicalJson, sha256Hex } from './integrity'
import { createValidationTask, reviseValidationTask, validateTask, validateTaskCollection, createTaskAttachment, validateTaskAttachment, attachmentMetadata, buildValidationTaskSummary, validateTaskBundle, type ValidationTask, type ValidationPlan } from './validation-task'

function fixture() {
  const product = { productId: 'SKU', title: 'Charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const workspace: WorkspaceSnapshot = { version: 2, id: 'workspace', name: 'Synthetic', updatedAt: new Date().toISOString(), pricingProductId: 'SKU', productScenarios: {}, deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL', pricing: initialProductPricing(product), scenarios: {}, dataset: { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } } }
  const run = createAnalysisRun(workspace.id, buildInsightReport(workspace.dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset: workspace.dataset, pricingScenario: buildPricingScenario(workspace.pricing, product), costSet: initialCostSet({ productId: product.productId, market: product.market, currency: product.currency }) }, 'local')
  const theme = run.report.themes[0]
  const plan: ValidationPlan = { title: '散热样机验证', hypothesis: '改变散热材料可能改善体验', metric: '对照样机测试温升与使用体验，门槛由用户设定', method: 'prototype', methodDetail: '相同环境与负载下比较原样机与改良样机，记录条件和全部结果', expectedCost: { value: null, status: 'unknown', currency: 'USD', identity: 'user-assumption', source: null, updatedAt: null } }
  const task = createValidationTask(run, theme.id, theme.evidence[0].quoteAnchor!, plan)
  return { workspace, run, task, plan }
}
function update(previous: ValidationTask, run: ReturnType<typeof fixture>['run'], status: ValidationTask['status'], decision: ValidationTask['decision'] = 'undecided', result = '') {
  return reviseValidationTask(previous, run, { status, decision, reason: '合成验证理由', result, attachments: previous.attachments })
}
function rehash(task: ValidationTask) { const { recordDigest: _digest, ...content } = task; return { ...content, recordDigest: sha256Hex(canonicalJson(content)) } }
const databases: WorkspaceDatabase[] = []
function database() { const db = new WorkspaceDatabase(crypto.randomUUID()); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete() })

describe('evidence-bound validation tasks', () => {
  it('accepts permitted extensions when browser MIME is missing and normalizes Markdown', async () => {
    const { task } = fixture()
    expect((await createTaskAttachment(new File(['synthetic'], 'notes.log'), task)).type).toBe('text/plain')
    expect((await createTaskAttachment(new File(['synthetic'], 'notes.md', { type: 'text/markdown' }), task)).type).toBe('text/plain')
    await expect(createTaskAttachment(new File(['synthetic'], 'notes.exe'), task)).rejects.toThrow()
  })
  it('starts pending and binds original quote, cost digests and unknown costs without changing report', () => {
    const { task, run } = fixture()
    expect(task.status).toBe('pending')
    expect(task.costDigests).toHaveLength(3)
    expect(task.plan.expectedCost.value).toBeNull()
    expect(task.anchor).toEqual(run.report.themes[0].evidence[0].quoteAnchor)
    expect(run.input.dataset.reviews[0].body.slice(task.anchor.start, task.anchor.end)).toBe(task.anchor.quote)
    expect(run.report.themes[0].semanticStatus).toBe('pending-review')
  })
  it('records running/verified/adopted with full history while keeping original plan', () => {
    const { task, run } = fixture()
    const running = update(task, run, 'running')
    const verified = update(running, run, 'verified', 'adopted', '合成用户报告：样机结果达到预设门槛，未独立核验')
    const summary = buildValidationTaskSummary(run, [task, running, verified])
    expect(summary.latest[0].status).toBe('verified')
    expect(summary.records).toHaveLength(3)
    expect(summary.latest[0].plan).toEqual(task.plan)
    expect(summary.notice).toContain('未经独立核验')
    expect(buildValidationTaskSummary(run, [verified, task, running])).toEqual(summary)
  })
  it('rejects skipping verification, missing results and adopting rejected or deferred hypotheses', () => {
    const { task, run } = fixture()
    expect(() => update(task, run, 'verified', 'adopted', 'result')).toThrow('状态转换')
    const running = update(task, run, 'running')
    expect(() => update(running, run, 'verified', 'adopted')).toThrow('记录结果')
    expect(() => update(running, run, 'rejected', 'adopted', 'result')).toThrow()
    expect(() => update(task, run, 'deferred', 'adopted')).toThrow()
    expect(() => update(task, run, 'pending', 'adopted')).toThrow()
  })
  it('permits deferred return to pending but preserves terminal verdicts', () => {
    const { task, run } = fixture()
    const deferred = update(task, run, 'deferred')
    expect(update(deferred, run, 'pending').revision).toBe(3)
    const rejected = update(update(task, run, 'running'), run, 'rejected', 'not-adopted', '对照未达门槛')
    expect(() => update(rejected, run, 'running')).toThrow('状态转换')
  })
  it('rejects wrong quotes, cross-workspace/market and currency even after rehash', () => {
    const { task, run } = fixture()
    for (const changed of [{ ...task, workspaceId: 'OTHER' }, { ...task, anchor: { ...task.anchor, quote: 'invented' } }, { ...task, target: { ...task.target, market: 'EU' as const } }, { ...task, plan: { ...task.plan, expectedCost: { ...task.plan.expectedCost, currency: 'EUR' as const } } }]) expect(() => validateTask(rehash(changed), run)).toThrow()
  })
  it('rejects overwritten hypotheses, missing revisions and reordered digests', () => {
    const { task, run } = fixture()
    const running = update(task, run, 'running')
    expect(() => validateTaskCollection([running], [run])).toThrow('起始记录')
    expect(() => validateTaskCollection([task, rehash({ ...running, plan: { ...running.plan, hypothesis: '新假设' } })], [run])).toThrow('不能改写')
    expect(() => validateTaskCollection([task, task], [run])).toThrow('重复')
  })
  it('hashes raw bytes like standard SHA-256, not UTF-8 encoded binary strings', () => {
    const bytes = new Uint8Array([0, 255, 128, 65])
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
  it('validates file bytes, sizes, MIME signatures, extensions and rejects executable formats', async () => {
    const { task } = fixture()
    const file = await createTaskAttachment(new File(['合成验证结果'], 'result.txt', { type: 'text/plain' }), task)
    expect(validateTaskAttachment(file)).toEqual(file)
    expect(() => validateTaskAttachment({ ...file, digest: '0'.repeat(64) })).toThrow('指纹')
    expect(() => validateTaskAttachment({ ...file, bytes: file.bytes + 1 })).toThrow()
    await expect(createTaskAttachment(new File(['<script>x()</script>'], 'result.html', { type: 'text/plain' }), task)).rejects.toThrow('扩展名')
    await expect(createTaskAttachment(new File(['not PNG'], 'image.png', { type: 'image/png' }), task)).rejects.toThrow('签名')
    await expect(createTaskAttachment(new File([], 'empty.txt', { type: 'text/plain' }), task)).rejects.toThrow('5 MB')
    await expect(createTaskAttachment(new File([new Uint8Array(5_000_001)], 'big.txt', { type: 'text/plain' }), task)).rejects.toThrow('5 MB')
  })
  it('rejects missing or cross-task attachments and never drops previous files', async () => {
    const { task, run } = fixture()
    const file = await createTaskAttachment(new File(['result'], 'result.txt', { type: 'text/plain' }), task)
    const running = reviseValidationTask(task, run, { status: 'running', decision: 'undecided', reason: '记录文件', result: '阶段结果', attachments: [attachmentMetadata(file)] })
    expect(() => validateTaskBundle([task, running], [], [run])).toThrow('缺失')
    expect(() => validateTaskBundle([task, running], [{ ...file, taskId: 'OTHER' }], [run])).toThrow('跨范围')
    expect(() => reviseValidationTask(running, run, { status: 'running', decision: 'undecided', reason: '不可删除', result: 'updated', attachments: [] })).toThrow('丢弃')
  })
})

describe('task transactions, migration and complete backup', () => {
  it('requires a saved run and rejects concurrent revisions without overwrite', async () => {
    const { task, run } = fixture()
    const db = database()
    await expect(db.saveValidationTask(task)).rejects.toThrow('已保存')
    await db.saveAnalysisRun(run)
    await db.saveValidationTask(task)
    const running = update(task, run, 'running')
    const outcomes = await Promise.allSettled([db.saveValidationTask(running), db.saveValidationTask({ ...running, id: crypto.randomUUID() })])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect((await db.listValidationTasks(run.workspaceId, [run])).tasks).toHaveLength(2)
  })
  it('persists files and task revisions together and restores after database reopen', async () => {
    const { task, run } = fixture()
    const db = database()
    await db.saveAnalysisRun(run); await db.saveValidationTask(task)
    const file = await createTaskAttachment(new File(['result'], 'result.txt', { type: 'text/plain' }), task)
    const running = reviseValidationTask(task, run, { status: 'running', decision: 'undecided', reason: '阶段结果', result: '有记录', attachments: [attachmentMetadata(file)] })
    const fail = vi.spyOn(db.taskAttachments, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(db.saveValidationTask(running, [file])).rejects.toThrow('full')
    expect(await db.validationTasks.count()).toBe(1)
    expect(await db.taskAttachments.count()).toBe(0)
    fail.mockRestore()
    await db.saveValidationTask(running, [file])
    db.close(); await db.open()
    expect((await db.listValidationTasks(run.workspaceId, [run])).attachments[0]).toEqual(file)
  })
  it('round-trips v5 backup, reassigns all IDs and preserves original quote, plan and attachment bytes', async () => {
    const { workspace, task, run } = fixture()
    const file = await createTaskAttachment(new File(['result'], 'result.txt', { type: 'text/plain' }), task)
    const running = reviseValidationTask(task, run, { status: 'running', decision: 'undecided', reason: '记录', result: '阶段结果', attachments: [attachmentMetadata(file)] })
    const text = workspaceArchiveBackup(workspace, [run], [], [task, running], [file])
    const backup = readWorkspaceArchive(text)
    expect(JSON.parse(text).schemaVersion).toBe('qling-workspace-backup/5')
    const db = database()
    const restored = await db.restoreArchive({ ...workspace, id: 'new-workspace' }, backup.analysisRuns, () => true, [], backup.validationTasks, backup.taskAttachments)
    const bundle = await db.listValidationTasks('new-workspace', restored)
    expect(bundle.tasks[0].taskId).not.toBe(task.taskId)
    expect(bundle.tasks[0].plan).toEqual(task.plan)
    expect(bundle.tasks[0].anchor).toEqual(task.anchor)
    expect(bundle.attachments[0].data).toBe(file.data)
    expect(bundle.attachments[0].id).not.toBe(file.id)
    expect(buildValidationTaskSummary(restored[0], bundle.tasks).digest).not.toBe(buildValidationTaskSummary(run, [task, running]).digest)
  })
  it('restoration rollback leaves the original workspace and every table intact', async () => {
    const { workspace, task, run } = fixture()
    const db = database()
    await db.save(workspace)
    const fail = vi.spyOn(db.validationTasks, 'add').mockRejectedValue(new Error('quota'))
    await expect(db.restoreArchive({ ...workspace, id: 'failed-copy' }, [run], () => true, [], [task], [])).rejects.toThrow('quota')
    fail.mockRestore()
    expect(await db.workspaces.count()).toBe(1)
    expect((await db.restore())?.id).toBe(workspace.id)
    expect(await db.analysisRuns.count()).toBe(0)
    expect(await db.validationTasks.count()).toBe(0)
  })
  it('migrates v4 without invented task labels and preserves older backup formats', async () => {
    const { workspace, run } = fixture()
    const name = crypto.randomUUID()
    const old = new Dexie(name)
    old.version(4).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]' })
    await old.table('workspaces').add(workspace); await old.table('analysisRuns').add(run)
    old.close()
    const db = new WorkspaceDatabase(name); databases.push(db); await db.open()
    expect(await db.validationTasks.count()).toBe(0)
    expect(await db.analysisRuns.get(run.id)).toEqual(run)
    expect(readWorkspaceArchive(workspaceArchiveBackup(workspace, [run])).validationTasks).toEqual([])
  })
  it('rejects tampered complete backups and extra credential fields', () => {
    const { workspace, task, run } = fixture()
    const backup = JSON.parse(workspaceArchiveBackup(workspace, [run], [], [task]))
    backup.validationTasks[0].plan.hypothesis = 'tampered'
    expect(() => readWorkspaceArchive(JSON.stringify(backup))).toThrow('指纹')
    expect(() => validateTask({ ...task, apiKey: 'synthetic-secret' }, run)).toThrow()
  })
})
