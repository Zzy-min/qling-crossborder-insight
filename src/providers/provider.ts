import { z } from 'zod'
import { extractComplianceRisks, extractThemes } from '../domain/analysis'
import type { DatasetBundle, EvidenceRef, ProviderAnalysis, ProviderMode } from '../domain/types'

export interface AnalysisProvider {
  readonly mode: ProviderMode
  analyze(dataset: DatasetBundle): Promise<ProviderAnalysis>
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

function materializeModelOutput(content: string, dataset: DatasetBundle): ProviderAnalysis {
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
        quadrant: uniqueReviewIds.length >= 2 ? ('urgent_fix' as const) : ('emerging_risk' as const),
        severityScore: Math.min(10, uniqueReviewIds.length * 3 + 4),
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

export class ProxyProvider implements AnalysisProvider {
  readonly mode = 'bailian' as const
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: ProxyProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 70_000
  }

  async isConfigured(): Promise<boolean> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/health`, { headers: { Accept: 'application/json' } })
      if (!response.ok) return false
      return z.object({ providerConfigured: z.boolean() }).parse(await response.json()).providerConfigured
    } catch {
      return false
    }
  }

  async analyze(dataset: DatasetBundle): Promise<ProviderAnalysis> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataset),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error(`AI proxy request timeout after ${Math.round(this.timeoutMs / 1000)}s`)
      }
      throw error
    }
    if (!response.ok) throw new Error(`AI proxy request failed: HTTP ${response.status}`)
    return materializeModelOutput(modelContent(await response.json()), dataset)
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
    this.fetcher = options.fetcher ?? fetch
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
    return materializeModelOutput(modelContent(await response.json()), dataset)
  }
}
