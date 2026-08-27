export type Market = 'US' | 'EU' | 'JP' | 'UK'
export type Currency = 'USD' | 'EUR' | 'JPY' | 'GBP'

export interface ProductRow {
  productId: string
  title: string
  brand: string
  market: Market
  currency: Currency
  price: number
  rating: number
  reviewCount: number
  capturedAt: string
  sourceUrl: string
}

export interface ReviewRow {
  reviewId: string
  productId: string
  locale: string
  rating: number
  title: string
  body: string
  reviewedAt: string
  verifiedPurchase: boolean
  sourceUrl: string
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

export interface EvidenceRef {
  sourceUrl: string
  capturedAt: string
  excerpt: string
  recordId: string
  evidenceType: 'product' | 'review' | 'policy'
}

export type PainQuadrant = 'urgent_fix' | 'emerging_risk' | 'core_strength' | 'opportunity'

export interface ReviewTheme {
  id: string
  label: string
  sentiment: 'positive' | 'negative'
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
  themes: ReviewTheme[]
  complianceRisks: ComplianceRisk[]
}

export interface DatasetBundle {
  products: ProductRow[]
  reviews: ReviewRow[]
  policies: PolicyRow[]
}
