export type Market = 'US' | 'EU' | 'JP' | 'UK'
export type Currency = 'USD' | 'EUR' | 'JPY' | 'GBP'

export interface ProductRow {
  productId: string
  title: string
  brand: string
  market: Market
  currency: Currency
  price: number
  rating: number | null
  reviewCount: number | null
  capturedAt: string
  sourceUrl: string | null
}

export interface ReviewRow {
  reviewId: string
  productId: string
  locale: string
  rating: number
  title: string
  body: string
  reviewedAt: string
  verifiedPurchase: boolean | null
  sourceUrl: string | null
}

export interface PolicyRow {
  policyId: string
  market: Market
  authority: string
  topic: string
  effectiveAt: string
  summary: string
  sourceUrl: string
}

export interface QuoteAnchor {
  reviewId: string
  field: 'title' | 'body'
  quote: string
  start: number
  end: number
}

export type ReviewSentiment = 'positive' | 'negative' | 'neutral' | 'mixed'

export interface EvidenceRef {
  quoteAnchor?: QuoteAnchor
  sourceUrl: string | null
  capturedAt: string
  excerpt: string
  recordId: string
  evidenceType: 'product' | 'review' | 'policy'
}

export type PainQuadrant = 'urgent_fix' | 'emerging_risk' | 'core_strength' | 'opportunity'

export interface ThemeSampleStats {
  version: 'qling-sample-statistics/1'
  productId: string
  market: Market
  basis: 'unreviewed-predictions'
  sampleCount: number
  mentionCount: number
  negativeCount: number
  mixedCount: number
  mentionRate: number
  negativeRate: number
  timeRange: { from: string; to: string } | null
  thresholds: { mentionRate: number; negativeRate: number; minimumSamples: number; minimumMentions: number }
  status: 'eligible' | 'insufficient-sample'
  quadrant: 'high-mention-high-negative' | 'high-mention-low-negative' | 'low-mention-high-negative' | 'low-mention-low-negative' | null
}

export interface ReviewTheme {
  sampleStats?: ThemeSampleStats[]
  aspectId?: string
  productId?: string
  market?: Market
  evidenceLevel?: 'quote-anchored/2'
  semanticStatus?: 'pending-review'
  id: string
  label: string
  sentiment: ReviewSentiment
  mentions: number
  evidence: EvidenceRef[]
  quadrant?: PainQuadrant
  severityScore?: number
}

export interface VisualConcept {
  id: string
  themeId: string
  themeLabel: string
  conceptTitle: string
  problemSummary: string
  designSolution: string
  imagePrompt: string
  feasibility: 'high' | 'medium'
  estimatedCost: string
  citableReviewIds: string[]
  svgPreview?: string
}

export interface ScoreBreakdown {
  painIntensity: number
  improvementSpace: number
  competitionAndMargin: number
  dataConfidence: number
  compliancePenalty: number
}

export interface DataQualitySummary {
  totalReviews: number
  verifiedPurchaseRate: number
  unknownPurchaseCount?: number
  timeRange: { from: string; to: string } | null
  linkedProducts: number
  deduplicatedCount: number
  marketCoverage: Market[]
  privacyCheck: 'passed'
}

export interface EvidenceCoverageSummary {
  totalClaims: number
  claimsWithEvidence: number
  coverageRate: number
  reviewEvidenceCount: number
  productEvidenceCount: number
  policyEvidenceCount: number
  missingClaimIds: string[]
}

export type ScoreKey = keyof ScoreBreakdown

export interface ScoreContribution {
  key: ScoreKey
  label: string
  rawScore: number
  weight: number
  direction: 'add' | 'subtract'
  weightedContribution: number
  detail: string
}

export interface DecisionAction {
  id: string
  category: 'product' | 'market' | 'compliance'
  priority: 'high' | 'medium' | 'low'
  title: string
  rationale: string
  evidenceRecordIds: string[]
  humanReviewRequired: boolean
}

export type AnalysisStage = 'validation' | 'themes' | 'binding' | 'scoring' | 'compliance' | 'report'

export interface ComplianceRisk {
  id: string
  market: Market
  label: string
  severity: 'low' | 'medium' | 'high'
  evidence: EvidenceRef[]
  humanReviewRequired: true
}

export interface InsightReport {
  batchRun?: BatchRun
  evidenceProtocol?: 1 | 2
  provenance?: DatasetProvenance
  analysisVersion?: { rules: string; prompt: string; model: string }
  themes: ReviewTheme[]
  opportunityScore: number
  scoreBreakdown: ScoreBreakdown
  complianceRisks: ComplianceRisk[]
  recommendation: string
  generatedAt: string
  providerMode: ProviderMode
  dataQuality: DataQualitySummary
  evidenceCoverage: EvidenceCoverageSummary
  scoreContributions: ScoreContribution[]
  actions: DecisionAction[]
  visualConcepts?: VisualConcept[]
}

export type ProviderMode = 'fixture' | 'mock' | 'bailian'

export interface ProviderAnalysis {
  evidenceProtocol?: 1 | 2
  model?: string
  promptVersion?: string
  themes: ReviewTheme[]
  complianceRisks: ComplianceRisk[]
}

export interface BatchEntry {
  id: string
  productId: string
  market: Market
  reviewIds: string[]
  dataDigest: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  attempts: number
  cached: boolean
  error?: 'network-or-timeout' | 'temporary-provider-error' | 'evidence-contract' | 'non-retryable-provider-error'
  model?: string
  promptVersion?: string
}

export interface BatchRun {
  schemaVersion: 'qling-online-batches/1'
  runId: string
  dataDigest: string
  status: 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled'
  batches: BatchEntry[]
}

export interface DatasetBundle {
  provenance?: DatasetProvenance
  products: ProductRow[]
  reviews: ReviewRow[]
  policies: PolicyRow[]
}

export type SourceKind = 'demo' | 'user-provided' | 'official' | 'unknown'

export interface DatasetProvenance {
  products: SourceKind
  reviews: SourceKind
  policies: SourceKind
}
