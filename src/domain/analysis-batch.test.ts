import { describe, expect, it, vi } from 'vitest'
import { analyzeBatches, AnalysisBatchCache, batchLimits, planAnalysisBatches, validateBatchRun, completedBatchDataset } from './analysis-batch'
import { EvidenceContractError, ProviderRequestError } from '../providers/provider'
import type { AnalysisProvider } from '../providers/provider'
import type { DatasetBundle, ProviderAnalysis } from './types'
import { buildInsightReportFromAnalysis } from './analysis'
import { createAnalysisRun, validateAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { canonicalJson, sha256Hex } from './integrity'
import { createHumanReview, buildReviewSummary } from './human-review'

function dataset(count = 101): DatasetBundle {
  return { products: [{ productId: 'SKU', title: 'Charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }],
    reviews: Array.from({ length: count }, (_, index) => ({ reviewId: `R${index}`, productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'Charger gets hot.', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null })), policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } }
}
function result(input: DatasetBundle): ProviderAnalysis {
  const product = input.products[0]
  return { evidenceProtocol: 2, model: 'synthetic-model', promptVersion: 'test/3', complianceRisks: [], themes: [{ id: 'heat', aspectId: 'thermal', productId: product.productId, market: product.market, label: '发热', sentiment: 'negative', evidenceLevel: 'quote-anchored/2', semanticStatus: 'pending-review', mentions: input.reviews.length,
    evidence: input.reviews.map((review) => ({ recordId: review.reviewId, evidenceType: 'review', capturedAt: review.reviewedAt, sourceUrl: review.sourceUrl, excerpt: `${review.title}: ${review.body}`, quoteAnchor: { reviewId: review.reviewId, field: 'body', quote: review.body, start: 0, end: review.body.length } })) }] }
}
function provider(analyze = async (input: DatasetBundle) => result(input)): AnalysisProvider {
  return { mode: 'bailian', analyze: vi.fn(analyze) }
}

describe('bounded sequential online batches', () => {
  it('plans at most 50 reviews per product/market without omissions', () => {
    const input = dataset()
    input.products.push({ ...input.products[0], productId: 'EU', market: 'EU', currency: 'EUR' })
    input.reviews.push({ ...input.reviews[0], reviewId: 'EU-R', productId: 'EU' })
    const plan = planAnalysisBatches(input)
    expect(plan.map((batch) => batch.dataset.reviews.length)).toEqual([50, 50, 1, 1])
    expect(plan[3].entry.market).toBe('EU')
    expect(plan.flatMap((batch) => batch.entry.reviewIds)).toEqual(input.reviews.map((review) => review.reviewId))
  })
  it('also applies character/UTF8 budget, rejects overlong single records before any calls', async () => {
    const input = dataset(3)
    input.reviews.forEach((review) => { review.body = '中文🙂'.repeat(1000) })
    const plan = planAnalysisBatches(input)
    expect(plan.every((batch) => JSON.stringify({ protocolVersion: 2, dataset: batch.dataset }).length <= batchLimits.characters && new TextEncoder().encode(JSON.stringify({ protocolVersion: 2, dataset: batch.dataset })).length <= batchLimits.bytes)).toBe(true)
    input.reviews[2].body = 'x'.repeat(25000)
    const engine = provider()
    await expect(analyzeBatches(input, engine)).rejects.toThrow('未发送、未截断')
    expect(engine.analyze).not.toHaveBeenCalled()
  })
  it('rejects duplicate and orphan scope before sending', () => {
    const input = dataset(1)
    input.reviews.push(input.reviews[0])
    expect(() => planAnalysisBatches(input)).toThrow('重复')
    input.reviews = [{ ...input.reviews[0], productId: 'missing' }]
    expect(() => planAnalysisBatches(input)).toThrow('无法关联')
  })
  it('merges stable aspects and unique quotes, exposing actual progress', async () => {
    const input = dataset()
    const updates: string[] = []
    const outcome = await analyzeBatches(input, provider(), { onProgress: (run) => updates.push(run.status) })
    expect(outcome.analysis?.themes).toHaveLength(1)
    expect(outcome.analysis?.themes[0].mentions).toBe(101)
    expect(outcome.run.batches.map((batch) => batch.attempts)).toEqual([1, 1, 1])
    expect(validateBatchRun(outcome.run, input).status).toBe('completed')
    expect(updates[0]).toBe('queued')
    expect(updates.at(-1)).toBe('completed')
  })
  it('retries transient failures at most twice without duplicate mentions', async () => {
    let calls = 0
    const engine = provider(async (input) => { if (++calls < 3) throw new ProviderRequestError('busy', true, 'temporary-provider-error'); return result(input) })
    const outcome = await analyzeBatches(dataset(2), engine, { retryDelayMs: 0 })
    expect(calls).toBe(3)
    expect(outcome.run.batches[0]).toMatchObject({ attempts: 3, status: 'completed' })
    expect(outcome.analysis?.themes[0].mentions).toBe(2)
    const failed = await analyzeBatches(dataset(2), provider(async () => { throw new ProviderRequestError('offline', true, 'network-or-timeout') }), { retryDelayMs: 0 })
    expect(failed.run.batches[0]).toMatchObject({ attempts: 3, status: 'failed' })
    expect(failed.analysis).toBeNull()
  })
  it('does not retry evidence or permissions and preserves completed batches only', async () => {
    const input = dataset(51)
    let calls = 0
    const outcome = await analyzeBatches(input, provider(async (batch) => { if (++calls === 2) throw new EvidenceContractError(); return result(batch) }))
    expect(outcome.run.status).toBe('partial')
    expect(outcome.run.batches[1]).toMatchObject({ error: 'evidence-contract', attempts: 1 })
    expect(completedBatchDataset(input, outcome.run).reviews).toHaveLength(50)
    const denied = await analyzeBatches(dataset(1), provider(async () => { throw new ProviderRequestError('403', false, 'non-retryable-provider-error') }))
    expect(denied.run.batches[0].attempts).toBe(1)
  })
  it('rejects cross-batch quotations even with IDs from the full dataset', async () => {
    const input = dataset(51)
    const outcome = await analyzeBatches(input, provider(async (batch) => result({ ...batch, reviews: [input.reviews[50]] })))
    expect(outcome.run.batches[0]).toMatchObject({ status: 'failed', error: 'evidence-contract', attempts: 1 })
    expect(outcome.analysis?.themes[0].mentions).toBe(1)
  })
  it('cancels active work and does not start remaining batches', async () => {
    const controller = new AbortController()
    const engine: AnalysisProvider = { mode: 'bailian', analyze: vi.fn(async (input, options) => {
      if (input.reviews[0].reviewId === 'R0') return result(input)
      controller.abort()
      expect(options?.signal?.aborted).toBe(true)
      throw new DOMException('cancel', 'AbortError')
    }) }
    const outcome = await analyzeBatches(dataset(), engine, { signal: controller.signal })
    expect(outcome.run.status).toBe('cancelled')
    expect(outcome.run.batches.map((batch) => batch.status)).toEqual(['completed', 'cancelled', 'cancelled'])
    expect(engine.analyze).toHaveBeenCalledTimes(2)
    expect(outcome.analysis?.themes[0].mentions).toBe(50)
  })
  it('cancels before send and during backoff', async () => {
    const controller = new AbortController()
    controller.abort()
    const engine = provider()
    const cancelled = await analyzeBatches(dataset(), engine, { signal: controller.signal })
    expect(engine.analyze).not.toHaveBeenCalled()
    expect(cancelled.run.batches.every((batch) => batch.status === 'cancelled')).toBe(true)
    const pending = new AbortController()
    const retry = provider(async () => { setTimeout(() => pending.abort(), 0); throw new ProviderRequestError('offline', true, 'network-or-timeout') })
    const waiting = await analyzeBatches(dataset(), retry, { signal: pending.signal, retryDelayMs: 1000 })
    expect(waiting.run.status).toBe('cancelled')
    expect(retry.analyze).toHaveBeenCalledTimes(1)
  })
  it('isolates cache by data, model, prompt and provider, never caches failures', async () => {
    const cache = new AnalysisBatchCache()
    const identity = { model: 'synthetic-model', promptVersion: 'test/3', providerOrigin: 'https://example.com' }
    const engine = provider()
    await analyzeBatches(dataset(1), engine, { cache, cacheIdentity: identity })
    const cached = await analyzeBatches(dataset(1), engine, { cache, cacheIdentity: identity })
    expect(cached.run.batches[0]).toMatchObject({ cached: true, attempts: 0 })
    expect(engine.analyze).toHaveBeenCalledTimes(1)
    for (const change of [{ model: 'new-model' }, { promptVersion: 'new-prompt' }, { providerOrigin: 'https://other.com' }]) await analyzeBatches(dataset(1), engine, { cache, cacheIdentity: { ...identity, ...change } })
    const changed = dataset(1)
    changed.reviews[0].body = 'Different text'
    await analyzeBatches(changed, engine, { cache, cacheIdentity: identity })
    expect(engine.analyze).toHaveBeenCalledTimes(5)
  })
  it('stores full input plus explicit successful sample scope; forged scope is rejected', async () => {
    const input = dataset(51)
    let calls = 0
    const { run: batches, analysis } = await analyzeBatches(input, provider(async (batch) => { if (++calls === 2) throw new EvidenceContractError(); return result(batch) }))
    const report = { ...buildInsightReportFromAnalysis(completedBatchDataset(input, batches), analysis!, 'bailian'), batchRun: batches }
    const run = createAnalysisRun('workspace', report, { category: 'Test', sourceLabel: 'Test', marketScope: 'ALL', dataset: input, pricingScenario: buildPricingScenario({ currency: 'USD', price: 30, landedCost: null, platformRate: null, adRate: null, fixedLaunchCost: null }, input.products[0]) }, 'online')
    expect(run.input.dataset.reviews).toHaveLength(51)
    expect(run.report.themes[0].sampleStats![0].sampleCount).toBe(50)
    const theme = run.report.themes[0]
    const reviewed = createHumanReview(run, theme.id, theme.evidence[0].quoteAnchor!, 'accepted', 'negative', 'Synthetic review', 1)
    expect(buildReviewSummary(run, [reviewed]).statistics[0].sample.sampleCount).toBe(50)
    const forged = structuredClone(run)
    forged.report.batchRun!.batches[1].reviewIds = ['R0']
    const { archiveDigest: _digest, ...content } = forged
    expect(() => validateAnalysisRun({ ...content, archiveDigest: sha256Hex(canonicalJson(content)) })).toThrow('批次引用范围')
  })
})
