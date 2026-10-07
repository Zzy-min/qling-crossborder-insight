import { z } from 'zod'
import { extractComplianceRisks, extractThemes } from '../domain/analysis'
import type { DatasetBundle, EvidenceRef, ProviderAnalysis, ProviderMode } from '../domain/types'
import { validateAnchoredOutput } from '../domain/evidence-contract.mjs'
import type { AnalysisRun } from '../domain/analysis-run'
import type { QuoteAnchor } from '../domain/types'
import type { ConceptImageResponse } from '../domain/concept-image'

export interface AnalyzeOptions {
  protocolVersion?: 1 | 2
  signal?: AbortSignal
  runId?: string
}

export interface AnalysisProvider {
  readonly mode: ProviderMode
  analyze(dataset: DatasetBundle, options?: AnalyzeOptions): Promise<ProviderAnalysis>
}

export class FixtureProvider implements AnalysisProvider {
  readonly mode = 'fixture' as const

  async analyze(dataset: DatasetBundle): Promise<ProviderAnalysis> {
    return {
      themes: extractThemes(dataset),
      complianceRisks: extractComplianceRisks(dataset),
    }
  }
}

export class MockProvider implements AnalysisProvider {
  readonly mode = 'mock' as const

  constructor(private readonly result: ProviderAnalysis) {}

  async analyze(_dataset: DatasetBundle): Promise<ProviderAnalysis> {
    return structuredClone(this.result)
  }
}

const modelOutputSchema = z.object({
  themes: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(200),
    sentiment: z.enum(['positive', 'negative']),
    reviewIds: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  })).max(20),
  complianceRisks: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(200),
    severity: z.enum(['low', 'medium', 'high']),
    policyIds: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  })).max(20),
})

function materializeModelOutput(content: string, dataset: DatasetBundle, protocolVersion: 1 | 2 = 1): ProviderAnalysis {
  if (protocolVersion === 2) {
    const parsed = validateAnchoredOutput(JSON.parse(content), dataset)
    const legacyRisks = materializeModelOutput(JSON.stringify({ themes: [], complianceRisks: parsed.complianceRisks }), dataset).complianceRisks
    return { evidenceProtocol: 2, complianceRisks: legacyRisks, themes: parsed.themes.map(({ quotes, ...theme }) => ({
      ...theme, evidenceLevel: 'quote-anchored/2', semanticStatus: 'pending-review',
      mentions: new Set(quotes.map((anchor) => anchor.reviewId)).size,
      evidence: [...new Map(quotes.map((anchor) => [JSON.stringify(anchor), anchor])).values()].map((anchor) => {
        const review = dataset.reviews.find((item) => item.reviewId === anchor.reviewId)!
        return { recordId: review.reviewId, evidenceType: 'review' as const, sourceUrl: review.sourceUrl, capturedAt: review.reviewedAt, excerpt: `${review.title}: ${review.body}`, quoteAnchor: anchor }
      }),
    })) }
  }
  const parsed = modelOutputSchema.parse(JSON.parse(content))
  const reviewMap = new Map(dataset.reviews.map((row) => [row.reviewId, row]))
  const policyMap = new Map(dataset.policies.map((row) => [row.policyId, row]))
  const reviewEvidence = (id: string): EvidenceRef => {
    const row = reviewMap.get(id)
    if (!row) throw new Error(`Model cited unknown review ID: ${id}`)
    return { sourceUrl: row.sourceUrl, capturedAt: row.reviewedAt, excerpt: `${row.title}: ${row.body}`, recordId: id, evidenceType: 'review' }
  }
  const policyEvidence = (id: string): EvidenceRef => {
    const row = policyMap.get(id)
    if (!row) throw new Error(`Model cited unknown policy ID: ${id}`)
    return { sourceUrl: row.sourceUrl, capturedAt: row.effectiveAt, excerpt: row.summary, recordId: id, evidenceType: 'policy' }
  }
  return {
    themes: parsed.themes.map(({ reviewIds, ...theme }) => {
      const uniqueReviewIds = [...new Set(reviewIds)]
      return {
        ...theme,
        mentions: uniqueReviewIds.length,
        evidence: uniqueReviewIds.map(reviewEvidence),
      }
    }),
    complianceRisks: parsed.complianceRisks.map(({ policyIds, ...risk }) => {
      const uniquePolicyIds = [...new Set(policyIds)]
      const policies = uniquePolicyIds.map((id) => {
        const policy = policyMap.get(id)
        if (!policy) throw new Error(`Model cited unknown policy ID: ${id}`)
        return policy
      })
      const markets = new Set(policies.map((policy) => policy.market))
      if (markets.size !== 1) throw new Error(`Model mixed policy markets in one risk: ${risk.id}`)
      const evidence = uniquePolicyIds.map(policyEvidence)
      const policy = policies[0]
      return { ...risk, market: policy.market, evidence, humanReviewRequired: true as const }
    }),
  }
}

function modelContent(envelope: unknown): string {
  const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1) }).parse(envelope)
  return parsed.choices[0].message.content
}

export interface ProxyProviderOptions {
  baseUrl?: string
  fetcher?: typeof fetch
  /** 请求超时（毫秒）。默认 70s，略高于服务端代理的 60s 上游超时。 */
  timeoutMs?: number
}

export class EvidenceContractError extends Error {
  constructor() { super('AI evidence contract rejected') }
}

export class ProviderRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly kind: 'network-or-timeout' | 'temporary-provider-error' | 'non-retryable-provider-error') { super(message) }
}

export class ProxyProvider implements AnalysisProvider {
  readonly mode = 'bailian' as const
  providerOrigin: string | null = null
  model: string | null = null
  promptVersion: string | null = null
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: ProxyProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis)
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 70_000
  }

  async isConfigured(): Promise<boolean> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/health`, { headers: { Accept: 'application/json' } })
      if (!response.ok) return false
      const health = z.object({ providerConfigured: z.boolean(), providerEndpoint: z.string().optional(), model: z.string().max(200).optional(), promptVersion: z.string().max(200).optional() }).parse(await response.json())
      this.model = health.model ?? null
      this.promptVersion = health.promptVersion ?? null
      if (health.providerEndpoint) {
        const endpoint = new URL(health.providerEndpoint)
        this.providerOrigin = ['https:', 'http:'].includes(endpoint.protocol) ? endpoint.origin : null
      }
      return health.providerConfigured
    } catch {
      return false
    }
  }

  async analyze(dataset: DatasetBundle, options: AnalyzeOptions = {}): Promise<ProviderAnalysis> {
    options.signal?.throwIfAborted()
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.protocolVersion === 2 ? { protocolVersion: 2, dataset } : dataset),
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ProviderRequestError(`AI proxy request timeout after ${Math.round(this.timeoutMs / 1000)}s`, true, 'network-or-timeout')
      }
      throw new ProviderRequestError('AI proxy network unavailable', true, 'network-or-timeout')
    }
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null)
      if (options.protocolVersion === 2 && z.object({ reason: z.literal('invalid_evidence_contract') }).safeParse(errorBody).success) throw new EvidenceContractError()
      const details = z.object({ error: z.string().optional(), upstreamStatus: z.number().int().optional() }).safeParse(errorBody)
      const value = details.success ? details.data : {}
      const retryable = value.error !== 'provider_not_configured' && ([429, 503, 504].includes(response.status) || (response.status === 502 && (['provider_unavailable', 'provider_timeout'].includes(value.error ?? '') || [408, 429, 500, 502, 503, 504].includes(value.upstreamStatus ?? 0))))
      throw new ProviderRequestError(`AI proxy request failed: HTTP ${response.status}`, retryable, retryable ? 'temporary-provider-error' : 'non-retryable-provider-error')
    }
    try {
      const envelope: unknown = await response.json()
      if (options.protocolVersion === 2) z.object({ protocolVersion: z.literal(2) }).parse(envelope)
      const model = z.object({ model: z.string().max(200).optional() }).parse(envelope).model
      return { ...materializeModelOutput(modelContent(envelope), dataset, options.protocolVersion), model, promptVersion: response.headers.get('x-qling-prompt-version') ?? undefined }
    } catch (error) {
      if (options.protocolVersion === 2) throw new EvidenceContractError()
      throw error
    }
  }

  async generateAnchoredConceptImage(run: AnalysisRun, themeId: string, anchors: QuoteAnchor[], hypothesis: string, options: { signal?: AbortSignal } = {}) {
    options.signal?.throwIfAborted()
    const { createConceptImageRequest, validateConceptImageResponse } = await import('../domain/concept-image')
    options.signal?.throwIfAborted()
    const input = createConceptImageRequest(run, themeId, anchors, hypothesis)
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(165_000)]) : AbortSignal.timeout(165_000)
    signal.throwIfAborted()
    const response = await this.fetcher(`${this.baseUrl}/api/images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
    })
    signal.throwIfAborted()
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new Error(`Concept image request failed: HTTP ${response.status}`)
    }
    if (!response.body) throw new Error('生图响应为空')
    const reader = response.body.getReader()
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        size += value.byteLength
        if (size > 64 * 1024) throw new Error('生图响应超过 64 KB')
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const parsed = validateConceptImageResponse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), input)
      signal.throwIfAborted()
      return { ...parsed, imageUrl: `${this.baseUrl}/api/images/${parsed.imageId}` }
    } catch (error) {
      cancel()
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      reader.releaseLock()
    }
  }

  async downloadAnchoredConceptImage(run: AnalysisRun, themeId: string, image: ConceptImageResponse & { imageUrl?: string }, options: { signal?: AbortSignal } = {}) {
    options.signal?.throwIfAborted()
    const { fetchConceptImageFile } = await import('../domain/concept-image-file')
    const { imageUrl: _ignored, ...metadata } = image
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    return fetchConceptImageFile(this.fetcher, `${this.baseUrl}/api/images/${metadata.imageId}`, run, themeId, metadata, signal)
  }

  async generateConceptImage(input: { prompt: string; reviewIds: string[] }): Promise<{ imageUrl: string; imageId: string; reviewIds: string[] }> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input.prompt, reviewIds: input.reviewIds }),
        signal: AbortSignal.timeout(130_000),
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error('concept image request timeout')
      }
      throw error
    }
    if (!response.ok) throw new Error(`concept image request failed: HTTP ${response.status}`)
    const parsed = z.object({
      imageId: z.string().regex(/^[a-f0-9]{16}$/),
      reviewIds: z.array(z.string().min(1)).min(1),
    }).parse(await response.json())
    return { ...parsed, imageUrl: `${this.baseUrl}/api/images/${parsed.imageId}` }
  }
}

export interface BailianProviderOptions {
  apiKey: string
  endpoint?: string
  model?: string
  fetcher?: typeof fetch
}

export class BailianProvider implements AnalysisProvider {
  readonly mode = 'bailian' as const
  private readonly endpoint: string
  private readonly model: string
  private readonly fetcher: typeof fetch

  constructor(private readonly options: BailianProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('Bailian API key is required')
    this.endpoint = options.endpoint ?? 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
    this.model = options.model ?? 'qwen3.7-plus'
    this.fetcher = options.fetcher ?? fetch.bind(globalThis)
  }

  async analyze(dataset: DatasetBundle): Promise<ProviderAnalysis> {
    if (typeof window !== 'undefined') {
      throw new Error('BailianProvider is server-only; never expose API keys in the browser')
    }
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return JSON only. Cite reviewIds and policyIds from the supplied dataset; never invent IDs.' },
          { role: 'user', content: JSON.stringify(dataset) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`Bailian request failed: HTTP ${response.status}`)
    const envelope: unknown = await response.json()
    const model = z.object({ model: z.string().max(200).optional() }).parse(envelope).model
    return { ...materializeModelOutput(modelContent(envelope), dataset), model, promptVersion: 'qling-direct-analysis/1' }
  }
}
