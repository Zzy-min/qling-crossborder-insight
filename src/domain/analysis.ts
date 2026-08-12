import type {
  ComplianceRisk,
  DatasetBundle,
  EvidenceRef,
  InsightReport,
  ReviewTheme,
  ScoreBreakdown,
  ProviderAnalysis,
  ProviderMode,
} from './types'

const negativeThemes = [
  { id: 'thermal', label: '高负载发热', keywords: ['hot', 'heat', 'overheat'] },
  { id: 'port-reset', label: '多口切换中断', keywords: ['interrupt', 'reset', 'second device'] },
]

function reviewEvidence(review: DatasetBundle['reviews'][number]): EvidenceRef {
  return {
    sourceUrl: review.sourceUrl,
    capturedAt: review.reviewedAt,
    excerpt: `${review.title}: ${review.body}`,
    recordId: review.reviewId,
    evidenceType: 'review',
  }
}

export function extractThemes(dataset: DatasetBundle): ReviewTheme[] {
  return negativeThemes.flatMap((definition) => {
    const matching = dataset.reviews.filter((review) => {
      const text = `${review.title} ${review.body}`.toLowerCase()
      return review.rating <= 3 && definition.keywords.some((keyword) => text.includes(keyword))
    })
    if (matching.length === 0) return []
    return [{
      id: definition.id,
      label: definition.label,
      sentiment: 'negative' as const,
      mentions: matching.length,
      evidence: matching.map(reviewEvidence),
    }]
  })
}

export function extractComplianceRisks(dataset: DatasetBundle): ComplianceRisk[] {
  return dataset.policies.map((policy) => ({
    id: policy.policyId,
    market: policy.market,
    label: `${policy.authority} · ${policy.topic}`,
    severity: 'medium',
    evidence: [{
      sourceUrl: policy.sourceUrl,
      capturedAt: policy.effectiveAt,
      excerpt: policy.summary,
      recordId: policy.policyId,
      evidenceType: 'policy',
    }],
    humanReviewRequired: true,
  }))
}

export function calculateOpportunityScore(breakdown: ScoreBreakdown): number {
  const raw = breakdown.painIntensity * 0.3
    + breakdown.improvementSpace * 0.25
    + breakdown.competitionAndMargin * 0.2
    + breakdown.dataConfidence * 0.1
    - breakdown.compliancePenalty * 0.15
  return Math.max(0, Math.min(100, Math.round(raw)))
}

export function buildInsightReportFromAnalysis(
  dataset: DatasetBundle,
  analysis: ProviderAnalysis,
  providerMode: ProviderMode,
  generatedAt = new Date().toISOString(),
): InsightReport {
  const { themes, complianceRisks } = analysis
  const verifiedReviews = dataset.reviews.filter((review) => review.verifiedPurchase).length
  const breakdown: ScoreBreakdown = {
    painIntensity: Math.min(100, themes.reduce((sum, theme) => sum + theme.mentions * 25, 0)),
    improvementSpace: themes.length > 0 ? 78 : 30,
    competitionAndMargin: 64,
    dataConfidence: dataset.reviews.length === 0 ? 0 : Math.round(verifiedReviews / dataset.reviews.length * 100),
    compliancePenalty: Math.min(100, complianceRisks.length * 20),
  }
  const opportunityScore = calculateOpportunityScore(breakdown)

  return {
    themes,
    opportunityScore,
    scoreBreakdown: breakdown,
    complianceRisks,
    recommendation: opportunityScore >= 60
      ? '建议进入验证阶段，优先解决高负载发热和多口切换体验，并由合规人员复核宣传表述。'
      : '当前证据不足以支持直接进入，建议补充评论和价格样本后重新评估。',
    generatedAt,
    providerMode,
  }
}

export function buildInsightReport(dataset: DatasetBundle, generatedAt = new Date().toISOString()): InsightReport {
  return buildInsightReportFromAnalysis(dataset, {
    themes: extractThemes(dataset),
    complianceRisks: extractComplianceRisks(dataset),
  }, 'fixture', generatedAt)
}
