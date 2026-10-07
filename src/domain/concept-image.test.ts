import { describe, expect, it, vi } from 'vitest'
import { buildInsightReport } from './analysis'
import { createAnalysisRun } from './analysis-run'
import { buildPricingScenario } from './market'
import { initialProductPricing } from './product-pricing'
import { canonicalJson, sha256Hex } from './integrity'
import { createConceptImageRequest, conceptImageBinding, validateConceptImageResponse } from './concept-image'
import { imageDataDigest, validateAnchoredImageRequest } from '../../server/image-contract.mjs'
import { ProxyProvider } from '../providers/provider'

function fixture() {
  const product = { productId: 'SKU', title: 'Synthetic charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: '评论-1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  const run = createAnalysisRun('workspace', buildInsightReport(dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
  const theme = run.report.themes[0]
  const anchors = [theme.evidence[0].quoteAnchor!]
  const hypothesis = 'A ventilation prototype, not proven performance'
  const input = createConceptImageRequest(run, theme.id, anchors, hypothesis)
  const result = { imageId: '0123456789abcdef', mediaType: 'image/png' as const, model: 'synthetic-model', reviewIds: input.anchors.map(anchor => anchor.reviewId), binding: validateAnchoredImageRequest(input).binding, cached: false }
  return { run, theme, anchors, hypothesis, input, result }
}

describe('anchored concept image client', () => {
  it('builds an isolated request from a verified archive and agrees with the actual server contract', () => {
    const { run, input, result } = fixture()
    expect(input.dataset).not.toBe(run.input.dataset)
    expect(imageDataDigest(input.dataset)).toBe(run.dataDigest)
    expect(conceptImageBinding(input)).toEqual(result.binding)
    expect(validateConceptImageResponse(result, input)).toEqual(result)
    expect('prompt' in input).toBe(false)
    input.dataset.reviews[0].body = 'mutated'
    expect(run.input.dataset.reviews[0].body).toBe('charger gets hot')
    expect(() => validateConceptImageResponse(result, input)).toThrow('数据指纹')
  })

  it('rejects fabricated, duplicate, altered or non-archived anchors and invalid hypotheses before transmission', () => {
    const { run, theme, anchors } = fixture()
    expect(() => createConceptImageRequest(run, 'missing', anchors, 'proposal')).toThrow()
    expect(() => createConceptImageRequest(run, theme.id, [...anchors, ...anchors], 'proposal')).toThrow()
    expect(() => createConceptImageRequest(run, theme.id, [{ ...anchors[0], quote: 'cold' }], 'proposal')).toThrow()
    expect(() => createConceptImageRequest(run, theme.id, [], 'proposal')).toThrow()
    expect(() => createConceptImageRequest(run, theme.id, anchors, '  ')).toThrow()
    expect(() => createConceptImageRequest(run, theme.id, anchors, 'x'.repeat(1001))).toThrow()
    const changed = structuredClone(run); changed.input.dataset.reviews[0].body += ' changed'
    expect(() => createConceptImageRequest(changed, theme.id, anchors, 'proposal')).toThrow()
  })

  it('rejects changed bindings even when the attacker recomputes their digest', () => {
    const { input, result } = fixture()
    for (const key of ['workspaceId', 'runId', 'hypothesis', 'dataDigest', 'aspectId'] as const) {
      const altered = structuredClone(result)
      altered.binding[key] = key === 'dataDigest' ? '0'.repeat(64) : `${altered.binding[key]}-changed`
      const { bindingDigest: _digest, ...content } = altered.binding
      altered.binding.bindingDigest = sha256Hex(canonicalJson(content))
      expect(() => validateConceptImageResponse(altered, input)).toThrow()
    }
    const changedSource = structuredClone(result); changedSource.binding.sourceIdentity.reviews = 'official'
    expect(() => validateConceptImageResponse(changedSource, input)).toThrow()
    const changedMarket = structuredClone(result); changedMarket.binding.target.market = 'JP'
    expect(() => validateConceptImageResponse(changedMarket, input)).toThrow()
    const changedQuote = structuredClone(result); changedQuote.binding.anchors[0].quote += 'invented'
    expect(() => validateConceptImageResponse(changedQuote, input)).toThrow()
  })

  it('scopes aggregated offline themes to the selected product and rejects cross-market anchors', () => {
    const { run } = fixture()
    const dataset = { ...run.input.dataset,
      products: [...run.input.dataset.products, { ...run.input.dataset.products[0], productId: 'JP-SKU', market: 'JP' as const, currency: 'JPY' as const }],
      reviews: [...run.input.dataset.reviews, { ...run.input.dataset.reviews[0], reviewId: 'JP-REVIEW', productId: 'JP-SKU' }],
    }
    const mixed = createAnalysisRun(run.workspaceId, buildInsightReport(dataset), { ...run.input, dataset }, 'local')
    const theme = mixed.report.themes[0]
    const anchors = theme.evidence.map(item => item.quoteAnchor!)
    expect(() => createConceptImageRequest(mixed, theme.id, anchors, 'proposal')).toThrow()
    const single = createConceptImageRequest(mixed, theme.id, [anchors.find(anchor => anchor.reviewId === 'JP-REVIEW')!], 'proposal')
    expect(single.target).toEqual({ productId: 'JP-SKU', market: 'JP', currency: 'JPY' })
    expect(validateAnchoredImageRequest(single).binding).toEqual(conceptImageBinding(single))
  })

  it('rejects legacy results, extra URLs/secrets, wrong IDs and image types', () => {
    const { input, result } = fixture()
    for (const altered of [{ ...result, binding: { protocolVersion: 1 } }, { ...result, imageUrl: 'javascript:attack()' }, { ...result, apiKey: 'secret' }, { ...result, reviewIds: ['OTHER'] }, { ...result, reviewIds: [...result.reviewIds, ...result.reviewIds] }, { ...result, mediaType: 'image/svg+xml' }, { ...result, imageId: '../outside' }]) expect(() => validateConceptImageResponse(altered, input)).toThrow()
  })

  it('sends protocol 2 only and derives its local image URL, never trusts a remote returned URL', async () => {
    const { run, theme, anchors, hypothesis, result } = fixture()
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      const sent = JSON.parse(options!.body as string)
      expect(sent.protocolVersion).toBe(2)
      expect(sent.workspaceId).toBe(run.workspaceId)
      expect(validateAnchoredImageRequest(sent).binding).toEqual(result.binding)
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' })
      return new Response(JSON.stringify(result))
    })
    const image = await new ProxyProvider({ fetcher }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis)
    expect(image.imageUrl).toBe('/api/images/0123456789abcdef')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('pre-cancelled and invalid inputs never call the proxy', async () => {
    const { run, theme, anchors, hypothesis } = fixture()
    const fetcher = vi.fn(); const provider = new ProxyProvider({ fetcher })
    const controller = new AbortController(); controller.abort()
    await expect(provider.generateAnchoredConceptImage(run, theme.id, anchors, hypothesis, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(provider.generateAnchoredConceptImage(run, 'missing', anchors, hypothesis)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels a hanging metadata body without waiting for its next chunk', async () => {
    const { run, theme, anchors, hypothesis } = fixture()
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve })
    const cancelled = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull() { started() }, cancel: cancelled })))
    const controller = new AbortController()
    const pending = new ProxyProvider({ fetcher }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis, { signal: controller.signal })
    await ready
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toHaveBeenCalled()
  })

  it('bounds metadata bytes and does not retry server failures or binding mismatches', async () => {
    const { run, theme, anchors, hypothesis, result } = fixture()
    const cancelled = vi.fn()
    const oversized = vi.fn(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65_537)) }, cancel: cancelled })))
    await expect(new ProxyProvider({ fetcher: oversized }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis)).rejects.toThrow('64 KB')
    expect(cancelled).toHaveBeenCalled()
    for (const response of [new Response('', { status: 429 }), new Response(JSON.stringify({ ...result, reviewIds: ['OTHER'] }))]) {
      const fetcher = vi.fn(async () => response)
      await expect(new ProxyProvider({ fetcher }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis)).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects invalid JSON and UTF-8, and cancels an error body rather than retrying', async () => {
    const { run, theme, anchors, hypothesis } = fixture()
    for (const response of [new Response('not JSON'), new Response(new Uint8Array([0xff, 0xfe]))]) {
      const fetcher = vi.fn(async () => response)
      await expect(new ProxyProvider({ fetcher }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis)).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    const cancelled = vi.fn()
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 429 }))
    await expect(new ProxyProvider({ fetcher }).generateAnchoredConceptImage(run, theme.id, anchors, hypothesis)).rejects.toThrow('429')
    expect(cancelled).toHaveBeenCalled()
  })
})
