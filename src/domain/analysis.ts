import type {
  ComplianceRisk,
  DatasetBundle,
  EvidenceRef,
  InsightReport,
  ReviewTheme,
  ScoreBreakdown,
  ProviderAnalysis,
  ProviderMode,
  DataQualitySummary,
  DecisionAction,
  EvidenceCoverageSummary,
  ScoreContribution,
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

const scoreDefinitions: Array<{
  key: keyof ScoreBreakdown
  label: string
  weight: number
  direction: 'add' | 'subtract'
}> = [
  { key: 'painIntensity', label: '痛点强度', weight: 0.3, direction: 'add' },
  { key: 'improvementSpace', label: '可改进空间', weight: 0.25, direction: 'add' },
  { key: 'competitionAndMargin', label: '竞争与利润空间', weight: 0.2, direction: 'add' },
  { key: 'dataConfidence', label: '数据可信度', weight: 0.1, direction: 'add' },
  { key: 'compliancePenalty', label: '合规风险扣分', weight: 0.15, direction: 'subtract' },
]

export function buildDataQuality(dataset: DatasetBundle, deduplicatedCount = 0): DataQualitySummary {
  const dates = dataset.reviews.map((review) => review.reviewedAt).sort()
  const coveredMarkets = new Set(dataset.products.map((product) => product.market))
  return {
    totalReviews: dataset.reviews.length,
    verifiedPurchaseRate: dataset.reviews.length === 0
      ? 0
      : Number((dataset.reviews.filter((review) => review.verifiedPurchase).length / dataset.reviews.length).toFixed(4)),
    timeRange: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    linkedProducts: new Set(dataset.reviews.map((review) => review.productId)).size,
    deduplicatedCount,
    marketCoverage: (['US', 'EU'] as const).filter((market) => coveredMarkets.has(market)),
    privacyCheck: 'passed',
  }
}

export function buildScoreContributions(breakdown: ScoreBreakdown): ScoreContribution[] {
  return scoreDefinitions.map((definition) => {
    const contribution = breakdown[definition.key] * definition.weight * (definition.direction === 'subtract' ? -1 : 1)
    return {
      ...definition,
      rawScore: breakdown[definition.key],
      weightedContribution: Number(contribution.toFixed(2)),
    }
  })
}

export function buildEvidenceCoverage(
  themes: ReviewTheme[],
  complianceRisks: ComplianceRisk[],
  dataset?: DatasetBundle,
): EvidenceCoverageSummary {
  const claims = [...themes, ...complianceRisks]
  const productClaimCount = dataset?.products.length ? 1 : 0
  const totalClaims = claims.length + productClaimCount
  const claimsWithEvidence = claims.filter((claim) => claim.evidence.length > 0).length + productClaimCount
  const evidence = claims.flatMap((claim) => claim.evidence)
  return {
    totalClaims,
    claimsWithEvidence,
    coverageRate: totalClaims === 0 ? 0 : Number((claimsWithEvidence / totalClaims).toFixed(4)),
    reviewEvidenceCount: new Set(evidence.filter((item) => item.evidenceType === 'review').map((item) => item.recordId)).size,
    productEvidenceCount: dataset
      ? new Set(dataset.products.map((item) => item.productId)).size
      : new Set(evidence.filter((item) => item.evidenceType === 'product').map((item) => item.recordId)).size,
    policyEvidenceCount: new Set(evidence.filter((item) => item.evidenceType === 'policy').map((item) => item.recordId)).size,
    missingClaimIds: claims.filter((claim) => claim.evidence.length === 0).map((claim) => claim.id),
  }
}

export function buildDecisionActions(
  dataset: DatasetBundle,
  themes: ReviewTheme[],
  complianceRisks: ComplianceRisk[],
): DecisionAction[] {
  const actions: DecisionAction[] = []
  const primaryTheme = [...themes].sort((a, b) => b.mentions - a.mentions || a.id.localeCompare(b.id))[0]
  if (primaryTheme?.evidence.length) {
    actions.push({
      id: `product-${primaryTheme.id}`,
      category: 'product',
      priority: 'high',
      title: `优先验证：${primaryTheme.label}`,
      rationale: `${primaryTheme.mentions} 条评论证据指向同一体验缺口，先用样机和访谈验证改进空间。`,
      evidenceRecordIds: primaryTheme.evidence.map((item) => item.recordId),
      humanReviewRequired: true,
    })
  }
  if (dataset.products.length && dataset.reviews.length) {
    actions.push({
      id: 'market-price-validation',
      category: 'market',
      priority: 'medium',
      title: '验证目标价格带与购买动机',
      rationale: '当前竞品快照与评论样本只能支持进入验证，需补充目标客户访谈和渠道价格样本。',
      evidenceRecordIds: dataset.products.map((item) => item.productId),
      humanReviewRequired: true,
    })
  }
  const primaryRisk = [...complianceRisks].sort((a, b) => a.id.localeCompare(b.id))[0]
  if (primaryRisk?.evidence.length) {
    actions.push({
      id: `compliance-${primaryRisk.id}`,
      category: 'compliance',
      priority: primaryRisk.severity === 'high' ? 'high' : 'medium',
      title: `人工复核：${primaryRisk.label}`,
      rationale: '正式发布宣传材料前，对照官方来源核验适用范围与措辞。',
      evidenceRecordIds: primaryRisk.evidence.map((item) => item.recordId),
      humanReviewRequired: true,
    })
  }
  return actions
}

export function buildInsightReportFromAnalysis(
  dataset: DatasetBundle,
  analysis: ProviderAnalysis,
  providerMode: ProviderMode,
  generatedAt = new Date().toISOString(),
  options: { deduplicatedCount?: number } = {},
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
  const evidenceCoverage = buildEvidenceCoverage(themes, complianceRisks, dataset)

  return {
    themes,
    opportunityScore,
    scoreBreakdown: breakdown,
    complianceRisks,
    recommendation: evidenceCoverage.totalClaims === 0
      ? '当前证据不足，建议补充评论、竞品与政策资料后再评估。'
      : opportunityScore >= 60
        ? '建议进入验证阶段，优先验证产品体验，并由合规人员复核宣传表述。'
        : opportunityScore >= 40
          ? '建议补充证据后再决策，优先验证关键痛点、价格带与合规边界。'
          : '建议暂缓进入，先补齐数据与合规证据，再重新评估。',
    generatedAt,
    providerMode,
    dataQuality: buildDataQuality(dataset, options.deduplicatedCount),
    evidenceCoverage,
    scoreContributions: buildScoreContributions(breakdown),
    actions: buildDecisionActions(dataset, themes, complianceRisks),
  }
}

export function buildInsightReport(
  dataset: DatasetBundle,
  generatedAt = new Date().toISOString(),
  options: { deduplicatedCount?: number } = {},
): InsightReport {
  return buildInsightReportFromAnalysis(dataset, {
    themes: extractThemes(dataset),
    complianceRisks: extractComplianceRisks(dataset),
  }, 'fixture', generatedAt, options)
}
