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
} from './types'

const categoryNegativeThemes = [
  // 3C 快充
  {
    id: 'thermal',
    label: '高负载发热',
    keywords: ['hot', 'heat', 'overheat'],
    defaultConcept: {
      title: '石墨烯均温板与主动温控架构',
      solution: '在内部堆叠中引入 0.4mm 石墨烯均热片，配合 NTC 动态调节峰值输出功率，降低表壳温升 6–8°C。',
      prompt: 'Industrial product design of internal cooling architecture for compact GaN charger with graphene heat dissipation and aluminum shielding, clean minimalist studio render',
    },
  },
  {
    id: 'port-reset',
    label: '多口切换中断',
    keywords: ['interrupt', 'reset', 'second device'],
    defaultConcept: {
      title: '无感功率动态重分配电路',
      solution: '采用独立通道降压控制 IC，副口插拔时主口保持 45W 恒流供电，消除断流黑屏体验。',
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
      solution: '采用高弹性食品级硅胶拨片搭配电机堵转电流自检，遇卡顿 0.2s 内自动反转 30° 排障。',
      prompt: '3D CAD rendered exploded view of anti-clog silicone impeller feeding mechanism for smart pet feeder',
    },
  },
  {
    id: 'app-wifi',
    label: 'App断连与离线容灾',
    keywords: ['loses 2.4ghz', 'wifi connection after router', 'app disconnect'],
    defaultConcept: {
      title: '本地 RTC 离线双备份出粮模组',
      solution: '内置硬件级 RTC 时钟芯片与本地 Flash 计划存储，Wi-Fi 意外断连时仍能按时精准出粮。',
      prompt: 'Modern minimalist smart pet appliance control board highlighting local RTC memory chip and status LED',
    },
  },
  {
    id: 'cleaning-corner',
    label: '死角残留与抗菌材质',
    keywords: ['unreachable corners', 'slime accumulates', 'hard to clean corners'],
    defaultConcept: {
      title: '全可拆卸无缝无死角水路设计',
      solution: '采用无线磁感应水泵与一体化圆角食品级 304 不锈钢内胆，清洗零死角。',
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
      solution: '定制鲨鱼鳍静音离心风扇搭配直通式对称散热风道，500W 输出时将噪音压至 42dB 以下。',
      prompt: 'Product design render of acoustic airflow chamber and silent bionic cooling fan inside portable power station',
    },
  },
  {
    id: 'cold-attenuation',
    label: '低温容量衰减',
    keywords: ['winter camp', 'below freezing', 'below 0°c'],
    defaultConcept: {
      title: '自加热电池包与低温充电保护',
      solution: '集成 PTC 自加热薄膜，零下 10°C 接入充电时先预热电芯至 5°C 再开启大电流快充。',
      prompt: 'Exploded technical visualization of LiFePO4 battery pack with PTC self-heating thermal layer',
    },
  },
  {
    id: 'solar-throttle',
    label: '太阳能充电压降限流',
    keywords: ['mppt controller', 'solar input voltage', 'throttles input'],
    defaultConcept: {
      title: '宽幅高效双向 MPPT 控制算法',
      solution: '拓宽 MPPT 追踪电压范围至 10–60V，提升高温强光环境下的光电转换利用率至 98.5%。',
      prompt: 'High-tech rugged portable solar generator in outdoor campsite setup with clean interface',
    },
  },
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
  return categoryNegativeThemes.flatMap((definition) => {
    const matching = dataset.reviews.filter((review) => {
      const text = `${review.title} ${review.body}`.toLowerCase()
      return review.rating <= 3 && definition.keywords.some((keyword) => text.includes(keyword))
    })
    if (matching.length === 0) return []
    const mentions = matching.length
    const quadrant = mentions >= 2 ? 'urgent_fix' : 'emerging_risk'
    return [{
      id: definition.id,
      label: definition.label,
      sentiment: 'negative' as const,
      mentions,
      evidence: matching.map(reviewEvidence),
      quadrant,
      severityScore: Math.min(10, mentions * 3 + 4),
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
  return themes.slice(0, 3).map((theme, index) => {
    const predefined = categoryNegativeThemes.find((item) => item.id === theme.id)
    const title = predefined?.defaultConcept.title ?? `针对「${theme.label}」的结构优化方案`
    const solution = predefined?.defaultConcept.solution ?? '优化元器件选型与工艺结构，增强出海产品在极端使用工况下的稳定性。'
    const prompt = predefined?.defaultConcept.prompt ?? `Professional industrial product design render addressing ${theme.label}, high-detail studio lighting`

    return {
      id: `concept-${theme.id || index}`,
      themeId: theme.id,
      themeLabel: theme.label,
      conceptTitle: title,
      problemSummary: theme.evidence[0]?.excerpt ?? `买家频繁反馈${theme.label}问题`,
      designSolution: solution,
      imagePrompt: prompt,
      feasibility: 'high' as const,
      estimatedCost: '+1.5% ~ +3.2%',
      citableReviewIds: theme.evidence.map((e) => e.recordId),
    }
  })
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
  const allKnownMarkets: Market[] = ['US', 'EU', 'JP', 'UK']
  return {
    totalReviews: dataset.reviews.length,
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
  const visualConcepts = generateVisualConcepts(themes, dataset)

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
