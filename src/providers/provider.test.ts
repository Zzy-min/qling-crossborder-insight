import { describe, expect, it, vi } from 'vitest'
import { sampleDataset } from '../fixtures/usbCChargers'
import { BailianProvider, FixtureProvider, MockProvider, ProxyProvider } from './provider'

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
})
