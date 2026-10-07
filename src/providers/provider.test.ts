import { describe, expect, it, vi } from 'vitest'
import { sampleDataset } from '../fixtures/usbCChargers'
import { BailianProvider, EvidenceContractError, FixtureProvider, MockProvider, ProxyProvider, ProviderRequestError } from './provider'

describe('analysis provider contract', () => {
  it('fixture provider returns evidence-linked findings', async () => {
    const result = await new FixtureProvider().analyze(sampleDataset)
    expect(result.themes.length).toBeGreaterThan(0)
    expect(result.themes.every((theme) => theme.evidence.length > 0)).toBe(true)
  })

  it('mock provider returns an isolated result', async () => {
    const result = { themes: [], complianceRisks: [] }
    const provider = new MockProvider(result)
    expect(await provider.analyze(sampleDataset)).toEqual(result)
  })

  it('Bailian provider accepts cited records and never calls the real network', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      themes: [{ id: 'thermal', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1'] }],
      complianceRisks: [{ id: 'fcc', label: 'FCC', severity: 'medium', policyIds: ['us-fcc-label'] }],
    }) } }] }), { status: 200 }))
    const result = await new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset)
    expect(result.themes[0].evidence[0].recordId).toBe('review-hot-1')
    expect(result.complianceRisks[0].humanReviewRequired).toBe(true)
  })

  it('Bailian provider defaults to the token-plan endpoint and qwen3.7-plus', async () => {
    let capturedUrl = ''
    let capturedModel = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedModel = JSON.parse(String(init?.body)).model
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        themes: [{ id: 'thermal', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1'] }],
        complianceRisks: [],
      }) } }] }), { status: 200 })
    })
    await new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset)
    expect(capturedUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(capturedModel).toBe('qwen3.7-plus')
  })

  it('rejects invented evidence IDs', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      themes: [{ id: 'made-up', label: '虚构', sentiment: 'negative', reviewIds: ['unknown'] }],
      complianceRisks: [],
    }) } }] }), { status: 200 }))
    await expect(new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset))
      .rejects.toThrow('unknown review ID')
  })

  it('deduplicates cited IDs before calculating mentions', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      themes: [{ id: 'thermal', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1', 'review-hot-1'] }],
      complianceRisks: [],
    }) } }] })))
    const result = await new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset)
    expect(result.themes[0].mentions).toBe(1)
    expect(result.themes[0].evidence).toHaveLength(1)
  })

  it('rejects one compliance finding that mixes policy markets', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      themes: [],
      complianceRisks: [{ id: 'mixed', label: '混合风险', severity: 'medium', policyIds: ['us-fcc-label', 'eu-common-charger-scope'] }],
    }) } }] })))
    await expect(new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset))
      .rejects.toThrow('Model mixed policy markets in one risk: mixed')
  })

  it('rejects oversized model result collections', async () => {
    const themes = Array.from({ length: 21 }, (_, index) => ({ id: `theme-${index}`, label: '主题', sentiment: 'negative', reviewIds: ['review-hot-1'] }))
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ themes, complianceRisks: [] }) } }] })))
    await expect(new BailianProvider({ apiKey: 'test-only', fetcher }).analyze(sampleDataset)).rejects.toThrow()
  })
})

describe('browser proxy provider', () => {
  it('cancels before sending and passes client abort through the active request', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn()
    await expect(new ProxyProvider({ fetcher }).analyze(sampleDataset, { signal: controller.signal })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    const active = new AbortController()
    const abortFetcher = vi.fn(async (_url, options) => {
      active.abort()
      expect(options?.signal?.aborted).toBe(true)
      throw new DOMException('abort', 'AbortError')
    })
    await expect(new ProxyProvider({ fetcher: abortFetcher }).analyze(sampleDataset, { signal: active.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it.each([
    [429, {}, true], [503, { error: 'provider_not_configured' }, false], [403, {}, false],
    [502, { error: 'provider_error', upstreamStatus: 429 }, true],
    [502, { error: 'provider_error', upstreamStatus: 401 }, false],
    [502, { error: 'invalid_provider_response', reason: 'content_not_json' }, false],
  ])('classifies retry eligibility for HTTP %i without returning upstream payloads', async (status, body, retryable) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status }))
    const failure = await new ProxyProvider({ fetcher }).analyze(sampleDataset).catch((error) => error)
    expect(failure).toBeInstanceOf(ProviderRequestError)
    expect(failure.retryable).toBe(retryable)
  })
  it('maps server quote rejection to a bounded client error without propagating payloads', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_provider_response', reason: 'invalid_evidence_contract', ignored: 'private payload' }), { status: 502 }))
    await expect(new ProxyProvider({ fetcher }).analyze(sampleDataset, { protocolVersion: 2 })).rejects.toBeInstanceOf(EvidenceContractError)
    await expect(new ProxyProvider({ fetcher }).analyze(sampleDataset, { protocolVersion: 2 })).rejects.toThrow('AI evidence contract rejected')
  })
  it('requests protocol 2 and materializes exact scoped mixed anchors', async () => {
    const review = sampleDataset.reviews[0]
    const product = sampleDataset.products.find((item) => item.productId === review.productId)!
    const content = JSON.stringify({ themes: [{ id: 'heat', aspectId: 'thermal', label: '发热', sentiment: 'mixed', productId: product.productId, market: product.market, quotes: [{ reviewId: review.reviewId, field: 'body', quote: review.body, start: 0, end: review.body.length }] }], complianceRisks: [] })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ protocolVersion: 2, choices: [{ message: { content } }] })))
    const result = await new ProxyProvider({ fetcher }).analyze(sampleDataset, { protocolVersion: 2 })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ protocolVersion: 2, dataset: sampleDataset })
    expect(result.themes[0]).toMatchObject({ sentiment: 'mixed', evidenceLevel: 'quote-anchored/2', semanticStatus: 'pending-review', mentions: 1 })
    expect(result.themes[0].evidence[0].quoteAnchor?.quote).toBe(review.body)
    expect(result.themes[0].quadrant).toBeUndefined()
  })
  it('never silently downgrades ID-only or forged protocol 2 quotes', async () => {
    for (const envelope of [
      { choices: [{ message: { content: JSON.stringify({ themes: [], complianceRisks: [] }) } }] },
      { protocolVersion: 2, choices: [{ message: { content: JSON.stringify({ themes: [{ id: 'heat', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1'] }], complianceRisks: [] }) } }] },
      { protocolVersion: 2, choices: [{ message: { content: JSON.stringify({ themes: [{ id: 'heat', aspectId: 'thermal', productId: sampleDataset.reviews[0].productId, market: 'US', label: '发热', sentiment: 'negative', quotes: [{ reviewId: sampleDataset.reviews[0].reviewId, field: 'body', quote: 'invented', start: 0, end: 8 }] }], complianceRisks: [] }) } }] },
    ]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope)))
      await expect(new ProxyProvider({ fetcher }).analyze(sampleDataset, { protocolVersion: 2 })).rejects.toThrow()
    }
  })
  it('binds the default browser fetch to its global receiver', async () => {
    vi.stubGlobal('fetch', async function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return new Response(JSON.stringify({ providerConfigured: true }))
    })
    try {
      expect(await new ProxyProvider().isConfigured()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports configured health without receiving a secret', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, providerConfigured: true })))
    expect(await new ProxyProvider({ baseUrl: 'http://127.0.0.1:8787/', fetcher }).isConfigured()).toBe(true)
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/health', expect.anything())
  })

  it('materializes proxy output and rejects invented IDs', async () => {
    const content = JSON.stringify({ themes: [{ id: 'thermal', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1'] }], complianceRisks: [] })
    let requestInit: RequestInit | undefined
    const fetcher: typeof fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    const result = await new ProxyProvider({ fetcher }).analyze(sampleDataset)
    expect(result.themes[0].evidence[0].recordId).toBe('review-hot-1')
    expect(requestInit?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('falls back to unavailable when health cannot be reached', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    expect(await new ProxyProvider({ fetcher }).isConfigured()).toBe(false)
  })

  it('converts an abort timeout into a friendly timeout error', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('signal timed out', 'TimeoutError')
    })
    await expect(new ProxyProvider({ fetcher }).analyze(sampleDataset))
      .rejects.toThrow('AI proxy request timeout after 70s')
  })

  it('passes an abort signal tied to the configured timeout', async () => {
    let capturedInit: RequestInit | undefined
    const content = JSON.stringify({ themes: [], complianceRisks: [] })
    const fetcher: typeof fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    await new ProxyProvider({ fetcher, timeoutMs: 5000 }).analyze(sampleDataset)
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal)
  })
})
