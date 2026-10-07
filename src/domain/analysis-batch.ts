import type { AnalysisProvider } from '../providers/provider'
import { EvidenceContractError, ProviderRequestError } from '../providers/provider'
import type { BatchRun, BatchEntry, DatasetBundle, ProviderAnalysis, ReviewTheme, ComplianceRisk } from './types'
import { canonicalJson, sha256Hex } from './integrity'
import { z } from 'zod'
import { validateAnchoredOutput } from './evidence-contract.mjs'

export const batchLimits = { reviews: 50, characters: 24000, bytes: 64000 } as const

const identifier = z.string().min(1).max(120)
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const batchRunSchema: z.ZodType<BatchRun> = z.object({ schemaVersion: z.literal('qling-online-batches/1'), runId: identifier, dataDigest: fingerprint,
  status: z.enum(['queued', 'running', 'partial', 'completed', 'failed', 'cancelled']), batches: z.array(z.object({
    id: identifier, productId: identifier, market: z.enum(['US', 'EU', 'JP', 'UK']), reviewIds: z.array(identifier).min(1).max(50), dataDigest: fingerprint,
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), attempts: z.number().int().min(0).max(3), cached: z.boolean(),
    error: z.enum(['network-or-timeout', 'temporary-provider-error', 'evidence-contract', 'non-retryable-provider-error']).optional(),
    model: z.string().min(1).max(200).optional(), promptVersion: z.string().min(1).max(200).optional(),
  }).strict()).min(1).max(10000) }).strict()

export class BatchPlanError extends Error {}

export function planAnalysisBatches(dataset: DatasetBundle): Array<{ entry: BatchEntry; dataset: DatasetBundle }> {
  const products = new Map(dataset.products.map((product) => [product.productId, product]))
  if (products.size !== dataset.products.length || new Set(dataset.reviews.map((review) => review.reviewId)).size !== dataset.reviews.length || dataset.reviews.some((review) => !products.has(review.productId))) throw new BatchPlanError('批次预检拒绝重复 ID 或无法关联商品的评论')
  const batches: Array<{ entry: BatchEntry; dataset: DatasetBundle }> = []
  const fits = (input: DatasetBundle) => { const payload = JSON.stringify({ protocolVersion: 2, dataset: input }); return input.reviews.length <= batchLimits.reviews && payload.length <= batchLimits.characters && new TextEncoder().encode(payload).length <= batchLimits.bytes }
  for (const product of dataset.products) {
    let current: DatasetBundle = { products: [product], reviews: [], policies: dataset.policies.filter((policy) => policy.market === product.market), ...(dataset.provenance ? { provenance: dataset.provenance } : {}) }
    const finish = () => {
      if (!current.reviews.length) return
      batches.push({ dataset: current, entry: { id: `batch-${batches.length + 1}`, productId: product.productId, market: product.market, reviewIds: current.reviews.map((review) => review.reviewId), dataDigest: sha256Hex(canonicalJson(current)), status: 'queued', attempts: 0, cached: false } })
      current = { ...current, reviews: [] }
    }
    for (const review of dataset.reviews.filter((row) => row.productId === product.productId)) {
      if (review.body.length > 5000 || review.title.length > 1000) throw new BatchPlanError(`评论 ${review.reviewId} 超过正文 5,000 / 标题 1,000 字符上限；未发送、未截断，请缩小资料范围`)
      if (!fits({ ...current, reviews: [review] })) throw new BatchPlanError(`评论 ${review.reviewId} 或关联商品/政策超过单批上下文预算；未发送、未截断，请缩小资料范围`)
      if (!fits({ ...current, reviews: [...current.reviews, review] })) finish()
      current.reviews.push(review)
    }
    finish()
  }
  if (!batches.length) throw new BatchPlanError('没有可分析的关联评论')
  return batches
}

export function completedBatchDataset(dataset: DatasetBundle, run: BatchRun): DatasetBundle {
  const ids = new Set(run.batches.filter((batch) => batch.status === 'completed').flatMap((batch) => batch.reviewIds))
  const reviews = dataset.reviews.filter((review) => ids.has(review.reviewId))
  const products = dataset.products.filter((product) => reviews.some((review) => review.productId === product.productId))
  return { ...dataset, reviews, products, policies: dataset.policies.filter((policy) => products.some((product) => product.market === policy.market)) }
}

export function validateBatchRun(value: unknown, dataset: DatasetBundle): BatchRun {
  const run = batchRunSchema.parse(value)
  const planned = planAnalysisBatches(dataset)
  if (run.dataDigest !== sha256Hex(canonicalJson(dataset)) || run.batches.length !== planned.length) throw new Error('分析批次数据指纹或范围不匹配')
  run.batches.forEach((batch, index) => {
    const expected = planned[index].entry
    if (canonicalJson([batch.id, batch.productId, batch.market, batch.reviewIds, batch.dataDigest]) !== canonicalJson([expected.id, expected.productId, expected.market, expected.reviewIds, expected.dataDigest])) throw new Error('分析批次引用范围不匹配')
    if (batch.status === 'queued' || batch.status === 'running' || (batch.cached && (batch.status !== 'completed' || batch.attempts !== 0)) || (batch.status === 'completed' && (!batch.model || !batch.promptVersion || batch.error || (!batch.cached && batch.attempts < 1))) || (batch.status === 'failed' && (!batch.error || batch.attempts < 1))) throw new Error('分析批次结束状态不完整')
  })
  const completed = run.batches.filter((batch) => batch.status === 'completed').length
  const failed = run.batches.filter((batch) => batch.status === 'failed').length
  if ((run.status === 'completed' && completed !== run.batches.length) || (run.status === 'partial' && (!completed || completed + failed !== run.batches.length || !failed)) || (run.status === 'failed' && failed !== run.batches.length) || ['queued', 'running'].includes(run.status)) throw new Error('分析运行结束状态不匹配')
  return run
}

export function batchRunLabel(run: BatchRun): string {
  const counts = (status: BatchEntry['status']) => run.batches.filter((batch) => batch.status === status).length
  const statuses = { queued: '排队中', running: '分析中', completed: '完整完成', partial: '部分完成', failed: '全部失败', cancelled: '已取消' }
  const reviews = run.batches.filter((batch) => batch.status === 'completed').reduce((sum, batch) => sum + batch.reviewIds.length, 0)
  const total = run.batches.reduce((sum, batch) => sum + batch.reviewIds.length, 0)
  return `${statuses[run.status]} · 成功 ${counts('completed')}/${run.batches.length} 批 · 失败 ${counts('failed')} 批 · 取消 ${counts('cancelled')} 批 · 在线完成范围 ${reviews}/${total} 条评论`
}

function mergeAnalyses(results: ProviderAnalysis[]): ProviderAnalysis {
  const themes = new Map<string, ReviewTheme>()
  const risks = new Map<string, ComplianceRisk>()
  for (const analysis of results) {
    for (const theme of analysis.themes) {
      const key = canonicalJson([theme.productId, theme.market, theme.aspectId, theme.sentiment])
      const prior = themes.get(key)
      const evidence = [...new Map([...(prior?.evidence ?? []), ...theme.evidence].map((reference) => [canonicalJson(reference.quoteAnchor), reference])).values()]
      themes.set(key, { ...theme, id: `batch-${sha256Hex(key).slice(0, 32)}`, evidence, mentions: new Set(evidence.map((reference) => reference.recordId)).size })
    }
    for (const risk of analysis.complianceRisks) {
      const key = canonicalJson([risk.market, risk.label, risk.severity, risk.evidence.map((reference) => reference.recordId).sort()])
      risks.set(key, { ...risk, id: `batch-${sha256Hex(key).slice(0, 32)}` })
    }
  }
  const versions = (key: 'model' | 'promptVersion') => { const values = [...new Set(results.map((result) => result[key] ?? 'unknown'))]; return values.length === 1 ? values[0] : 'multiple-versions-see-batches' }
  return { themes: [...themes.values()], complianceRisks: [...risks.values()], evidenceProtocol: 2, model: versions('model'), promptVersion: versions('promptVersion') }
}

function validateBatchAnalysis(analysis: ProviderAnalysis, dataset: DatasetBundle): void {
  try {
    if (analysis.evidenceProtocol !== 2) throw new EvidenceContractError()
    validateAnchoredOutput({ themes: analysis.themes.map((theme) => ({ id: theme.id, aspectId: theme.aspectId, productId: theme.productId, market: theme.market, label: theme.label, sentiment: theme.sentiment, quotes: theme.evidence.map((reference) => reference.quoteAnchor) })), complianceRisks: analysis.complianceRisks.map((risk) => ({ id: risk.id, label: risk.label, severity: risk.severity, policyIds: risk.evidence.map((reference) => reference.recordId) })) }, dataset)
  } catch { throw new EvidenceContractError() }
}

export class AnalysisBatchCache {
  private values = new Map<string, ProviderAnalysis>()
  get(key: string) { const value = this.values.get(key); return value ? structuredClone(value) : undefined }
  set(key: string, value: ProviderAnalysis) {
    if (canonicalJson(value).length > 250000) return
    this.values.set(key, structuredClone(value))
    if (this.values.size > 20) this.values.delete(this.values.keys().next().value!)
  }
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const stop = () => { clearTimeout(timer); reject(new DOMException('Analysis cancelled', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, delay)
    signal?.addEventListener('abort', stop, { once: true })
  })
}

export async function analyzeBatches(dataset: DatasetBundle, provider: AnalysisProvider, options: {
  signal?: AbortSignal; runId?: string; onProgress?: (run: BatchRun) => void; cache?: AnalysisBatchCache;
  cacheIdentity?: { model: string; promptVersion: string; providerOrigin: string }; retryDelayMs?: number;
} = {}): Promise<{ run: BatchRun; analysis: ProviderAnalysis | null }> {
  const planned = planAnalysisBatches(structuredClone(dataset))
  const run: BatchRun = { schemaVersion: 'qling-online-batches/1', runId: options.runId ?? crypto.randomUUID(), dataDigest: sha256Hex(canonicalJson(dataset)), status: 'queued', batches: planned.map((batch) => batch.entry) }
  const results: ProviderAnalysis[] = []
  const emit = () => options.onProgress?.(structuredClone(run))
  emit()
  for (const batch of planned) {
    if (options.signal?.aborted) break
    run.status = 'running'
    batch.entry.status = 'running'
    emit()
    const key = options.cacheIdentity ? canonicalJson({ dataDigest: batch.entry.dataDigest, ...options.cacheIdentity }) : null
    const cached = key ? options.cache?.get(key) : undefined
    if (cached) { validateBatchAnalysis(cached, batch.dataset); batch.entry.cached = true; batch.entry.status = 'completed'; batch.entry.model = cached.model; batch.entry.promptVersion = cached.promptVersion; results.push(cached); emit(); continue }
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (options.signal?.aborted) break
      batch.entry.attempts = attempt
      emit()
      try {
        const analysis = await provider.analyze(batch.dataset, { protocolVersion: 2, signal: options.signal, runId: run.runId })
        if (options.signal?.aborted) break
        validateBatchAnalysis(analysis, batch.dataset)
        batch.entry.status = 'completed'
        batch.entry.model = analysis.model ?? 'unknown'
        batch.entry.promptVersion = analysis.promptVersion ?? 'unknown'
        delete batch.entry.error
        results.push(analysis)
        if (key && analysis.model === options.cacheIdentity?.model && analysis.promptVersion === options.cacheIdentity?.promptVersion) options.cache?.set(key, analysis)
        break
      } catch (error) {
        if (options.signal?.aborted) break
        batch.entry.error = error instanceof EvidenceContractError ? 'evidence-contract' : error instanceof ProviderRequestError ? error.kind : 'non-retryable-provider-error'
        if (error instanceof ProviderRequestError && error.retryable && attempt < 3) {
          try { await waitForRetry((options.retryDelayMs ?? 500) * 2 ** (attempt - 1), options.signal) } catch { break }
          continue
        }
        batch.entry.status = 'failed'
        break
      }
    }
    emit()
  }
  const completed = run.batches.filter((batch) => batch.status === 'completed').length
  if (options.signal?.aborted) {
    run.status = 'cancelled'
    run.batches.forEach((batch) => { if (['queued', 'running'].includes(batch.status)) batch.status = 'cancelled' })
  } else run.status = completed === run.batches.length ? 'completed' : completed ? 'partial' : 'failed'
  emit()
  return { run, analysis: results.length ? mergeAnalyses(results) : null }
}
