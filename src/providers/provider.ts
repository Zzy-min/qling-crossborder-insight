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
    id: z.string().min(1),
    label: z.string().min(1),
    sentiment: z.enum(['positive', 'negative']),
    reviewIds: z.array(z.string().min(1)).min(1),
  })),
  complianceRisks: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high']),
    policyIds: z.array(z.string().min(1)).min(1),
  })),
})

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
    this.endpoint = options.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    this.model = options.model ?? 'qwen-plus'
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
    const envelope = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = envelope.choices?.[0]?.message?.content
    if (!content) throw new Error('Bailian response did not contain model output')

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
      themes: parsed.themes.map(({ reviewIds, ...theme }) => ({ ...theme, mentions: reviewIds.length, evidence: reviewIds.map(reviewEvidence) })),
      complianceRisks: parsed.complianceRisks.map(({ policyIds, ...risk }) => ({ ...risk, evidence: policyIds.map(policyEvidence), humanReviewRequired: true as const })),
    }
  }
}
