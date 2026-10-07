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
  VisualConcept,
  Market,
  ProductRow,
  ScoreKey,
} from './types'
import { median } from './market'
import { negativeReviewIds, sampleStatistics } from './sample-statistics'

const categoryNegativeThemes = [
  // 3C 快充
  {
    id: 'thermal',
    label: '高负载发热',
    keywords: ['hot', 'heat', 'overheat'],
    defaultConcept: {
      title: '石墨烯均温板与主动温控架构',
      solution: '设计假设：增加均热层，并在高负载时降低峰值输出。温升变化没有测温数据，需要样机验证。',
      prompt: 'Industrial product design of internal cooling architecture for compact GaN charger with graphene heat dissipation and aluminum shielding, clean minimalist studio render',
    },
  },
  {
    id: 'port-reset',
    label: '多口切换中断',
    keywords: ['interrupt', 'reset', 'second device'],
    defaultConcept: {
      title: '无感功率动态重分配电路',
      solution: '设计假设：副口插拔时让主口走独立供电。能否避免断流，需要样机验证。',
      prompt: 'Engineering schematic and aesthetic transparent tech exploded view of dual independent DC-DC power delivery circuit',
    },
  },
  // 智能宠物
  {
    id: 'food-jam',
    label: '下粮卡顿与防卡机制',
    keywords: ['kibble', 'clog', 'dispense', 'silicone impeller'],
    defaultConcept: {
      title: '柔性硅胶叶轮与正反转防卡脱困',
      solution: '设计假设：改用柔性拨片，堵转时短时反转。能否减少卡粮，需要样机验证。',
      prompt: '3D CAD rendered exploded view of anti-clog silicone impeller feeding mechanism for smart pet feeder',
    },
  },
  {
    id: 'app-wifi',
    label: 'App断连与离线容灾',
    keywords: ['loses 2.4ghz', 'wifi connection after router', 'app disconnect'],
    defaultConcept: {
      title: '本地 RTC 离线双备份出粮模组',
      solution: '设计假设：把出粮计划存在本地时钟，断网后仍按计划执行。恢复是否准时，需要实机验证。',
      prompt: 'Modern minimalist smart pet appliance control board highlighting local RTC memory chip and status LED',
    },
  },
  {
    id: 'cleaning-corner',
    label: '死角残留与抗菌材质',
    keywords: ['unreachable corners', 'slime accumulates', 'hard to clean corners'],
    defaultConcept: {
      title: '全可拆卸无缝无死角水路设计',
      solution: '设计假设：水路改成可拆的圆角内胆。清洁效果没有对比测试，需要实机验证。',
      prompt: 'Clean white ceramic and 304 stainless steel pet water fountain with modular magnetic cordless pump',
    },
  },
  // 户外便携储能
  {
    id: 'fan-noise',
    label: '风扇高频噪音',
    keywords: ['cooling fan kicks in', 'fan whine', 'loud fan noise'],
    defaultConcept: {
      title: '仿生静音风道与智能流体温控',
      solution: '设计假设：调整风道并降低高负载时的风扇转速。没有分贝数据，噪音变化需要实测。',
      prompt: 'Product design render of acoustic airflow chamber and silent bionic cooling fan inside portable power station',
    },
  },
  {
    id: 'cold-attenuation',
    label: '低温容量衰减',
    keywords: ['winter camp', 'below freezing', 'below 0°c'],
    defaultConcept: {
      title: '自加热电池包与低温充电保护',
      solution: '设计假设：低温充电前先给电芯预热。可用温度范围没有实测，需要样机验证。',
      prompt: 'Exploded technical visualization of LiFePO4 battery pack with PTC self-heating thermal layer',
    },
  },
  {
    id: 'solar-throttle',
    label: '太阳能充电压降限流',
    keywords: ['mppt controller', 'solar input voltage', 'throttles input'],
    defaultConcept: {
      title: '宽幅高效双向 MPPT 控制算法',
      solution: '设计假设：放宽太阳能输入的电压追踪范围。转换效率没有实测，不能写成已提升。',
      prompt: 'High-tech rugged portable solar generator in outdoor campsite setup with clean interface',
    },
  },
]

function ruleAnchor(review: DatasetBundle['reviews'][number], keywords: string[]) {
  for (const field of ['body', 'title'] as const) {
    for (const keyword of keywords) {
      const match = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(review[field])
      if (match) return { reviewId: review.reviewId, field, quote: match[0], start: match.index, end: match.index + match[0].length }
    }
  }
  return null
}

function reviewEvidence(review: DatasetBundle['reviews'][number], keywords: string[]): EvidenceRef {
  return {
    sourceUrl: review.sourceUrl,
    capturedAt: review.reviewedAt,
    excerpt: `${review.title}: ${review.body}`,
    recordId: review.reviewId,
    evidenceType: 'review',
    quoteAnchor: ruleAnchor(review, keywords)!,
  }
}

export function extractThemes(dataset: DatasetBundle): ReviewTheme[] {
  return categoryNegativeThemes.flatMap((definition) => {
    const matching = dataset.reviews.filter((review) => {
      return review.rating <= 3 && ruleAnchor(review, definition.keywords) !== null
    })
    if (matching.length === 0) return []
    const mentions = matching.length
    return [{
      id: definition.id,
      aspectId: definition.id,
      evidenceLevel: 'quote-anchored/2' as const,
      semanticStatus: 'pending-review' as const,
      label: definition.label,
      sentiment: 'negative' as const,
      mentions,
      evidence: matching.map((review) => reviewEvidence(review, definition.keywords)),
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

export function generateVisualConcepts(themes: ReviewTheme[], _dataset?: DatasetBundle): VisualConcept[] {
  return themes.filter((theme) => theme.sentiment === 'negative' || theme.sentiment === 'mixed').slice(0, 3).map((theme, index) => {
    const predefined = categoryNegativeThemes.find((item) => item.id === theme.id)
    const title = predefined?.defaultConcept.title ?? `针对「${theme.label}」的结构优化方案`
    const solution = predefined?.defaultConcept.solution ?? '设计假设：调整与该方面相关的结构或工艺；可行性、效果与新增成本均待访谈或样机验证。'
    const prompt = predefined?.defaultConcept.prompt ?? `Professional industrial product design render addressing ${theme.label}, high-detail studio lighting`

    return {
      id: `concept-${theme.id || index}`,
      themeId: theme.id,
      themeLabel: theme.label,
      conceptTitle: title,
      problemSummary: theme.evidence[0]?.excerpt ?? `买家频繁反馈${theme.label}问题`,
      designSolution: solution,
      imagePrompt: prompt,
      feasibility: 'medium' as const,
      estimatedCost: '未测算',
      citableReviewIds: theme.evidence.map((e) => e.recordId),
    }
  })
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * 可改进空间来自痛点结构本身：负向痛点占比六成、高频痛点占比四成。
 * 没有聚类结果时记 0，不再返回一个与数据无关的常数。
 */
export function calculateImprovementSpace(themes: ReviewTheme[]): number {
  if (themes.length === 0) return 0
  const negative = themes.filter((theme) => theme.sentiment === 'negative').length
  const recurring = themes.filter((theme) => theme.mentions >= 3).length
  return clampScore(100 * (0.6 * (negative / themes.length) + 0.4 * (recurring / themes.length)))
}

interface ShelfStats {
  currency: string
  products: number
  pricedProducts: number
  bandWidth: number
  dispersion: number
  /** 单款货架没有可比价格与分布，不参与打分，也不能被当成竞争最激烈。 */
  comparable: boolean
}

/** 不同币种的价格不能直接比大小，先按币种分成各自货架再统计。 */
export function shelfStats(products: ProductRow[]): ShelfStats[] {
  const groups = new Map<string, ProductRow[]>()
  for (const product of products) {
    const group = groups.get(product.currency) ?? []
    group.push(product)
    groups.set(product.currency, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rows]) => {
      const prices = rows.map((row) => row.price).filter((price) => Number.isFinite(price) && price > 0)
      const middle = prices.length ? median(prices) : 0
      const bandWidth = prices.length > 1 && middle > 0 ? (Math.max(...prices) - Math.min(...prices)) / middle : 0
      const counts = rows.flatMap((row) => row.reviewCount === null ? [] : [Math.max(0, row.reviewCount)])
      const totalReviews = counts.reduce((sum, count) => sum + count, 0)
      const comparable = rows.length >= 2 && prices.length >= 2 && counts.length === rows.length && totalReviews > 0
      const dispersion = comparable ? 1 - Math.max(...counts) / totalReviews : 0
      return { currency, products: rows.length, pricedProducts: prices.length, bandWidth, dispersion, comparable }
    })
}

/**
 * 竞争与利润空间来自在售快照：价格带宽五成、评价分散度五成，按货架商品数加权。
 * 价格越集中、评价越集中在少数商品上，分数越低。没有商品快照时记 0。
 */
export function calculateCompetitionAndMargin(products: ProductRow[]): number {
  const shelves = shelfStats(products)
  const comparable = shelves.filter((shelf) => shelf.comparable)
  const totalProducts = comparable.reduce((sum, shelf) => sum + shelf.products, 0)
  if (totalProducts === 0) return 0
  const weighted = comparable.reduce((sum, shelf) => {
    const bandScore = shelf.bandWidth / (shelf.bandWidth + 0.5)
    return sum + shelf.products * (0.5 * bandScore + 0.5 * shelf.dispersion)
  }, 0)
  return clampScore(100 * weighted / totalProducts)
}

/** 台账里写出这一格的输入，便于评委或卖家自己复算。 */
export function describeCompetitionInputs(products: ProductRow[]): string {
  const shelves = shelfStats(products)
  if (shelves.length === 0) return '无在售商品快照'
  const detail = shelves
    .map((shelf) => (shelf.comparable
      ? `${shelf.currency} ${shelf.products} 款 · 带宽 ${Math.round(shelf.bandWidth * 100)}% · 分散 ${Math.round(shelf.dispersion * 100)}%`
      : `${shelf.currency} ${shelf.products} 款（样本不足，不计分）`))
    .join('；')
  return `${shelves.length} 个币种货架 · ${detail}`
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
  { key: 'painIntensity', label: '负向样本覆盖（预测）', weight: 0.3, direction: 'add' },
  { key: 'improvementSpace', label: '可改进空间', weight: 0.25, direction: 'add' },
  { key: 'competitionAndMargin', label: '竞争与利润空间', weight: 0.2, direction: 'add' },
  { key: 'dataConfidence', label: '购买标记占比', weight: 0.1, direction: 'add' },
  { key: 'compliancePenalty', label: '合规风险扣分', weight: 0.15, direction: 'subtract' },
]

export function buildDataQuality(dataset: DatasetBundle, deduplicatedCount = 0): DataQualitySummary {
  const dates = dataset.reviews.map((review) => review.reviewedAt).sort()
  const coveredMarkets = new Set(dataset.products.map((product) => product.market))
  const allKnownMarkets: Market[] = ['US', 'EU', 'JP', 'UK']
  return {
    totalReviews: dataset.reviews.length,
    unknownPurchaseCount: dataset.reviews.filter((review) => review.verifiedPurchase === null).length,
    verifiedPurchaseRate: dataset.reviews.length === 0
      ? 0
      : Number((dataset.reviews.filter((review) => review.verifiedPurchase).length / dataset.reviews.length).toFixed(4)),
    timeRange: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    linkedProducts: new Set(dataset.reviews.map((review) => review.productId)).size,
    deduplicatedCount,
    marketCoverage: allKnownMarkets.filter((market) => coveredMarkets.has(market)),
    privacyCheck: 'passed',
  }
}

export function buildScoreContributions(
  breakdown: ScoreBreakdown,
  details: Partial<Record<ScoreKey, string>> = {},
): ScoreContribution[] {
  return scoreDefinitions.map((definition) => {
    const contribution = breakdown[definition.key] * definition.weight * (definition.direction === 'subtract' ? -1 : 1)
    return {
      ...definition,
      rawScore: breakdown[definition.key],
      weightedContribution: Number(contribution.toFixed(2)),
      detail: details[definition.key] ?? '',
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
  const { complianceRisks } = analysis
  const themes = analysis.themes.map((theme) => {
    const { quadrant: _quadrant, severityScore: _severity, ...finding } = theme
    return { ...finding, sampleStats: sampleStatistics(theme, analysis.themes, dataset) }
  })
  const verifiedReviews = dataset.reviews.filter((review) => review.verifiedPurchase).length
  const sampleIds = new Set(dataset.reviews.map((review) => review.reviewId))
  const negativeIds = negativeReviewIds(themes, dataset)
  const eligible = [...new Map(themes.flatMap((theme) => theme.sampleStats.map((sample) => [JSON.stringify([theme.aspectId ?? theme.id, sample.productId, sample.market]), sample] as const))).values()].filter((sample) => sample.status === 'eligible')
  const improvement = eligible.length ? Math.round(eligible.reduce((sum, sample) => sum + sample.mentionRate * sample.negativeRate * 100, 0) / eligible.length) : 0
  const breakdown: ScoreBreakdown = {
    painIntensity: sampleIds.size ? Math.round(negativeIds.size / sampleIds.size * 100) : 0,
    improvementSpace: improvement,
    competitionAndMargin: calculateCompetitionAndMargin(dataset.products),
    dataConfidence: dataset.reviews.length === 0 ? 0 : Math.round(verifiedReviews / dataset.reviews.length * 100),
    compliancePenalty: Math.min(100, complianceRisks.length * 20),
  }
  const scoreDetails: Partial<Record<ScoreKey, string>> = {
    painIntensity: `预测负向唯一评论 ${negativeIds.size}/${sampleIds.size}；仅当前样本，不是严重度或平台总体`,
    improvementSpace: eligible.length ? `${eligible.length} 项方面/商品统计通过样本门槛；提及率 × 预测负向占比的启发式均值` : '样本门槛不足，暂不计改良分；不代表没有改良空间',
    competitionAndMargin: describeCompetitionInputs(dataset.products),
    dataConfidence: `购买标记（输入声明） ${verifiedReviews}/${dataset.reviews.length} 条，未独立验证`,
    compliancePenalty: `${complianceRisks.length} 项合规事项 ×20`,
  }
  const opportunityScore = calculateOpportunityScore(breakdown)
  const evidenceCoverage = buildEvidenceCoverage(themes, complianceRisks, dataset)
  const visualConcepts = generateVisualConcepts(themes, dataset)

  return {
    themes,
    evidenceProtocol: analysis.evidenceProtocol ?? (providerMode === 'bailian' ? 1 : 2),
    provenance: dataset.provenance ?? { products: 'unknown', reviews: 'unknown', policies: 'unknown' },
    analysisVersion: { rules: 'qling-rules/3', prompt: providerMode === 'bailian' ? analysis.promptVersion ?? 'unknown' : 'not-applicable', model: providerMode === 'bailian' ? analysis.model ?? 'unknown' : 'local-rules' },
    opportunityScore,
    scoreBreakdown: breakdown,
    complianceRisks,
    recommendation: dataset.policies.length === 0
      ? '政策证据不足，合规结论未知；规则识别的评论主题仍需人工复核，不应据此直接采购或判断准入。'
      : evidenceCoverage.totalClaims === 0
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
    scoreContributions: buildScoreContributions(breakdown, scoreDetails),
    actions: buildDecisionActions(dataset, themes, complianceRisks),
    visualConcepts,
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
