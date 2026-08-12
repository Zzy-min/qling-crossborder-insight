export interface ProductRow {
  productId: string
  title: string
  brand: string
  market: 'US' | 'EU'
  currency: 'USD' | 'EUR'
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
  market: 'US' | 'EU'
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

export interface ReviewTheme {
  id: string
  label: string
  sentiment: 'positive' | 'negative'
  mentions: number
  evidence: EvidenceRef[]
}

export interface ScoreBreakdown {
  painIntensity: number
  improvementSpace: number
  competitionAndMargin: number
  dataConfidence: number
  compliancePenalty: number
}

export interface ComplianceRisk {
  id: string
  market: 'US' | 'EU'
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
