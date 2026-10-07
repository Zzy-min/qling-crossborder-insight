import { z } from 'zod'
import type { InsightReport } from './types'
import { productImportSchema, reviewImportSchema, importLimits } from './dataset-import'
import { canonicalJson, sha256Hex } from './integrity'
import { buildPricingScenario } from './market'
import { buildReportExport } from './report-export'
import { quoteAnchorSchema, validateQuoteAnchor } from './evidence-contract.mjs'
import { sampleStatistics } from './sample-statistics'
import { batchRunSchema, validateBatchRun, completedBatchDataset } from './analysis-batch'
import { costSetSchema, validateCostSet } from './cost-scenario'

const text = z.string().max(50_000)
const id = z.string().min(1).max(120)
const count = z.number().int().nonnegative()
const number = z.number().finite()
const market = z.enum(['US', 'EU', 'JP', 'UK'])
const currency = z.enum(['USD', 'EUR', 'JPY', 'GBP'])
const provenance = z.object({ products: z.literal('user-provided'), reviews: z.literal('user-provided'), policies: z.literal('unknown') }).strict()
const evidence = z.object({ recordId: id, evidenceType: z.enum(['product', 'review', 'policy']), sourceUrl: z.string().max(2048).nullable(), capturedAt: z.string().date(), excerpt: text, quoteAnchor: quoteAnchorSchema.optional() }).strict()
const sampleStats = z.object({ version: z.literal('qling-sample-statistics/1'), productId: id, market, basis: z.literal('unreviewed-predictions'),
  sampleCount: count, mentionCount: count, negativeCount: count, mixedCount: count, mentionRate: number.min(0).max(1), negativeRate: number.min(0).max(1),
  timeRange: z.object({ from: z.string().date(), to: z.string().date() }).strict().nullable(),
  thresholds: z.object({ mentionRate: number, negativeRate: number, minimumSamples: count, minimumMentions: count }).strict(),
  status: z.enum(['eligible', 'insufficient-sample']), quadrant: z.enum(['high-mention-high-negative', 'high-mention-low-negative', 'low-mention-high-negative', 'low-mention-low-negative']).nullable() }).strict()
const reportSchema: z.ZodType<InsightReport> = z.object({
  batchRun: batchRunSchema.optional(),
  evidenceProtocol: z.union([z.literal(1), z.literal(2)]).optional(),
  provenance: provenance.optional(), analysisVersion: z.object({ rules: text, prompt: text, model: text }).strict().optional(),
  themes: z.array(z.object({ id, label: text, sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']), mentions: count, evidence: z.array(evidence).max(10000),
    aspectId: id.optional(), productId: id.optional(), market: market.optional(), evidenceLevel: z.literal('quote-anchored/2').optional(), semanticStatus: z.literal('pending-review').optional(),
    sampleStats: z.array(sampleStats).max(100).optional(),
    quadrant: z.enum(['urgent_fix', 'emerging_risk', 'core_strength', 'opportunity']).optional(), severityScore: number.optional() }).strict()).max(6000),
  opportunityScore: number, scoreBreakdown: z.object({ painIntensity: number, improvementSpace: number, competitionAndMargin: number, dataConfidence: number, compliancePenalty: number }).strict(),
  complianceRisks: z.array(z.object({ id, market, label: text, severity: z.enum(['low', 'medium', 'high']), evidence: z.array(evidence), humanReviewRequired: z.literal(true) }).strict()).max(200),
  recommendation: text, generatedAt: z.string().datetime(), providerMode: z.enum(['fixture', 'mock', 'bailian']),
  dataQuality: z.object({ totalReviews: count, verifiedPurchaseRate: number, unknownPurchaseCount: count.optional(), timeRange: z.object({ from: z.string().date(), to: z.string().date() }).strict().nullable(),
    linkedProducts: count, deduplicatedCount: count, marketCoverage: z.array(market), privacyCheck: z.literal('passed') }).strict(),
  evidenceCoverage: z.object({ totalClaims: count, claimsWithEvidence: count, coverageRate: number, reviewEvidenceCount: count, productEvidenceCount: count, policyEvidenceCount: count, missingClaimIds: z.array(text) }).strict(),
  scoreContributions: z.array(z.object({ key: z.enum(['painIntensity', 'improvementSpace', 'competitionAndMargin', 'dataConfidence', 'compliancePenalty']), label: text, rawScore: number, weight: number, direction: z.enum(['add', 'subtract']), weightedContribution: number, detail: text }).strict()),
  actions: z.array(z.object({ id, category: z.enum(['product', 'market', 'compliance']), priority: z.enum(['high', 'medium', 'low']), title: text, rationale: text, evidenceRecordIds: z.array(id), humanReviewRequired: z.boolean() }).strict()).max(100),
  visualConcepts: z.array(z.object({ id, themeId: id, themeLabel: text, conceptTitle: text, problemSummary: text, designSolution: text, imagePrompt: text,
    feasibility: z.enum(['high', 'medium']), estimatedCost: text, citableReviewIds: z.array(id), svgPreview: text.optional() }).strict()).optional(),
}).strict()
const assumptions = z.object({ currency, price: number, landedCost: number.nullable(), platformRate: number.nullable(), adRate: number.nullable(), fixedLaunchCost: number.nullable() }).strict()
const pricing = z.object({ assumptions, target: z.object({ productId: id, market, currency }).strict(), status: z.enum(['ready', 'missing-costs', 'missing-launch-cost', 'invalid']),
  result: z.object({ price: number, landedCost: number, platformRate: number, adRate: number, fixedLaunchCost: number, variableFees: number, contributionPerUnit: number, contributionMarginRate: number, breakEvenUnits: number }).strict().nullable() }).strict()
const inputSchema = z.object({ category: text, sourceLabel: text, marketScope: z.enum(['US', 'EU', 'JP', 'UK', 'ALL', 'BOTH']),
    dataset: z.object({ products: z.array(productImportSchema).min(1).max(importLimits.products), reviews: z.array(reviewImportSchema).min(1).max(importLimits.reviews), policies: z.array(z.never()), provenance }).strict(), pricingScenario: pricing, costSet: costSetSchema.optional() }).strict()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const runSchema = z.object({ schemaVersion: z.literal('qling-analysis-run/1'), id, workspaceId: id, createdAt: z.string().datetime(),
  outcome: z.enum(['local', 'online', 'offline-fallback']), report: reportSchema, input: inputSchema,
  dataDigest: digest, evidenceDigest: digest, scenarioDigest: digest, archiveDigest: digest }).strict()

export type AnalysisRun = z.infer<typeof runSchema>

export function createAnalysisRun(workspaceId: string, report: InsightReport, input: Parameters<typeof buildReportExport>[1], outcome: AnalysisRun['outcome']): AnalysisRun {
  const checkedInput = inputSchema.parse(input)
  const exported = buildReportExport(report, checkedInput)
  const content = { schemaVersion: 'qling-analysis-run/1' as const, id: crypto.randomUUID(), workspaceId, createdAt: new Date().toISOString(), outcome,
    report, input: checkedInput, dataDigest: sha256Hex(canonicalJson(checkedInput.dataset)), evidenceDigest: exported.evidenceDigest, scenarioDigest: exported.scenarioDigest }
  return validateAnalysisRun(JSON.parse(JSON.stringify({ ...content, archiveDigest: sha256Hex(canonicalJson(content)) })))
}

export function validateAnalysisRun(value: unknown): AnalysisRun {
  const run = runSchema.parse(value)
  const { archiveDigest, ...content } = run
  if (sha256Hex(canonicalJson(content)) !== archiveDigest) throw new Error('分析存档内容指纹不匹配')
  const { dataset, pricingScenario, marketScope } = run.input
  const products = new Map(dataset.products.map((product) => [product.productId, product]))
  const reviews = new Map(dataset.reviews.map((review) => [review.reviewId, review]))
  if (products.size !== dataset.products.length || reviews.size !== dataset.reviews.length || dataset.reviews.some((review) => !products.has(review.productId))) throw new Error('分析输入包含重复或孤立记录')
  if (marketScope !== 'ALL' && marketScope !== 'BOTH' && dataset.products.some((product) => product.market !== marketScope)) throw new Error('分析输入越过市场范围')
  const target = products.get(pricingScenario.target.productId)
  if (!target || target.market !== pricingScenario.target.market || target.currency !== pricingScenario.target.currency) throw new Error('分析定价对象不匹配')
  if (run.input.costSet && validateCostSet(run.input.costSet).scenarios.some(scenario => canonicalJson(scenario.target) !== canonicalJson(pricingScenario.target))) throw new Error('明细情景与存档定价对象不匹配')
  if (canonicalJson(buildPricingScenario(pricingScenario.assumptions, pricingScenario.target)) !== canonicalJson(pricingScenario)) throw new Error('情景结果或公式不匹配')
  if (canonicalJson(run.report.provenance) !== canonicalJson(dataset.provenance)) throw new Error('报告来源身份不匹配')
  if ((run.outcome === 'online') !== (run.report.providerMode === 'bailian')) throw new Error('分析模式与结果身份不匹配')
  const batch = run.report.batchRun ? validateBatchRun(run.report.batchRun, dataset) : undefined
  if (batch && run.outcome !== 'online' && (run.outcome !== 'offline-fallback' || batch.status !== 'failed')) throw new Error('批次与本地回退身份不匹配')
  if (batch && run.outcome === 'online' && !batch.batches.some((entry) => entry.status === 'completed')) throw new Error('在线存档没有成功批次')
  const analyticalDataset = batch && run.outcome === 'online' ? completedBatchDataset(dataset, batch) : dataset
  const analyzedIds = new Set(analyticalDataset.reviews.map((review) => review.reviewId))
  if (batch && run.report.dataQuality.totalReviews !== analyticalDataset.reviews.length) throw new Error('批次报告样本分母不匹配')
  for (const reference of [...run.report.themes, ...run.report.complianceRisks].flatMap((claim) => claim.evidence)) {
    const review = reviews.get(reference.recordId)
    const product = products.get(reference.recordId)
    const valid = reference.evidenceType === 'review' ? review && reference.excerpt === `${review.title}: ${review.body}` && reference.sourceUrl === review.sourceUrl && reference.capturedAt === review.reviewedAt
      : reference.evidenceType === 'product' ? product && reference.sourceUrl === product.sourceUrl && reference.capturedAt === product.capturedAt : false
    if (!valid || (reference.evidenceType === 'review' && !analyzedIds.has(reference.recordId))) throw new Error('存档引用与原文或作用域不匹配')
    if (reference.quoteAnchor) {
      if (reference.evidenceType !== 'review' || reference.quoteAnchor.reviewId !== reference.recordId) throw new Error('存档锚点记录不匹配')
      validateQuoteAnchor(reference.quoteAnchor, dataset)
    }
  }
  for (const theme of run.report.themes) {
    if (theme.sampleStats && canonicalJson(theme.sampleStats) !== canonicalJson(sampleStatistics(theme, run.report.themes, analyticalDataset))) throw new Error('存档样本统计不匹配')
    if (run.report.analysisVersion?.rules === 'qling-rules/3' && (!theme.sampleStats || theme.quadrant || theme.severityScore !== undefined)) throw new Error('新版样本统计不完整或混入严重度')
    if (theme.evidenceLevel !== 'quote-anchored/2') continue
    if (!theme.aspectId || theme.semanticStatus !== 'pending-review' || !theme.evidence.length || theme.evidence.some((reference) => !reference.quoteAnchor)) throw new Error('存档锚点证据不完整')
    if (run.outcome === 'online' && run.report.evidenceProtocol === 2) {
      if (!theme.productId || !theme.market) throw new Error('存档主题范围不完整')
      for (const reference of theme.evidence) validateQuoteAnchor(reference.quoteAnchor, dataset, { productId: theme.productId, market: theme.market })
    }
  }
  if (run.report.evidenceProtocol === 2 && run.report.themes.some((theme) => theme.evidenceLevel !== 'quote-anchored/2')) throw new Error('新版报告不接受仅 ID 引用')
  const recordIds = new Set([...products.keys(), ...reviews.keys()])
  if (run.report.actions.some((action) => action.evidenceRecordIds.some((recordId) => !recordIds.has(recordId)))) throw new Error('存档行动引用越过数据范围')
  const themes = new Set(run.report.themes.map((theme) => theme.id))
  if (run.report.visualConcepts?.some((concept) => !themes.has(concept.themeId) || concept.citableReviewIds.some((reviewId) => !reviews.has(reviewId)))) throw new Error('存档概念引用越过数据范围')
  const exported = buildReportExport(run.report, run.input)
  if (run.dataDigest !== sha256Hex(canonicalJson(dataset)) || run.evidenceDigest !== exported.evidenceDigest || run.scenarioDigest !== exported.scenarioDigest) throw new Error('分析数据或报告指纹不匹配')
  return run
}

export function analysisRunBackup(run: AnalysisRun): string {
  return JSON.stringify(validateAnalysisRun(run), null, 2)
}

export function reassignRun(run: AnalysisRun, workspaceId: string): AnalysisRun {
  const { archiveDigest: _archive, ...content } = validateAnalysisRun(run)
  const changed = { ...content, id: crypto.randomUUID(), workspaceId }
  return { ...changed, archiveDigest: sha256Hex(canonicalJson(changed)) }
}
