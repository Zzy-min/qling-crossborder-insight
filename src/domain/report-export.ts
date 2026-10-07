import type { DatasetBundle, InsightReport } from './types'
import type { PricingScenario } from './market'
import { buildEvidenceIntegrity, buildEvidencePayloadV2, buildScenarioIntegrity } from './integrity'
import { compareCostScenarios, validateCostSet, type CostSet } from './cost-scenario'
import { buildCostSensitivity } from './cost-sensitivity'

export function reportSchemaVersion(base: string, capabilities: { humanReview?: boolean; validationTasks?: boolean; imageReport?: boolean; complianceReview?: boolean }): string {
  const versions = [base, ...(capabilities.humanReview ? ['1.3'] : []), ...(capabilities.validationTasks ? ['1.6'] : []), ...(capabilities.imageReport ? ['1.7'] : []), ...(capabilities.complianceReview ? ['1.8'] : [])]
  return versions.reduce((highest, version) => Number(version) > Number(highest) ? version : highest)
}

export function buildReportExport(report: InsightReport, input: {
  category: string
  marketScope: string
  sourceLabel: string
  dataset: DatasetBundle
  pricingScenario: PricingScenario
  costSet?: CostSet
}) {
  if (input.costSet) {
    const set = validateCostSet(input.costSet)
    const target = set.scenarios[0].target
    const product = input.dataset.products.find(candidate => candidate.productId === target.productId && candidate.market === target.market && candidate.currency === target.currency)
    const pricingTarget = input.pricingScenario.target
    if (!product || (pricingTarget && (target.productId !== pricingTarget.productId || target.market !== pricingTarget.market || target.currency !== pricingTarget.currency))) throw new Error('明细成本与报告商品范围不匹配')
  }
  const context = JSON.stringify({ category: input.category, marketScope: input.marketScope, sourceLabel: input.sourceLabel })
  const evidenceIntegrity = buildEvidenceIntegrity(report, context, { version: 2, dataset: input.dataset })
  const scenarioIntegrity = buildScenarioIntegrity(input.pricingScenario)
  return {
    schemaVersion: input.costSet?.sensitivity ? '1.5' : input.costSet ? '1.4' : report.batchRun ? '1.3' : '1.2',
    ...(input.costSet?.sensitivity ? { costSensitivity: buildCostSensitivity(input.costSet) } : {}),
    ...(input.costSet ? { costSet: validateCostSet(input.costSet), costComparison: compareCostScenarios(input.costSet.scenarios) } : {}),
    category: input.category,
    sourceLabel: input.sourceLabel,
    marketScope: input.marketScope,
    provenance: report.provenance,
    analysisVersion: report.analysisVersion,
    report,
    pricingScenario: input.pricingScenario.result ? { currency: input.pricingScenario.assumptions.currency, ...input.pricingScenario.result } : null,
    pricingAssumptions: input.pricingScenario.assumptions,
    pricingTarget: input.pricingScenario.target ?? null,
    pricingStatus: input.pricingScenario.status,
    evidenceIntegrity,
    scenarioIntegrity,
    evidenceDigest: evidenceIntegrity.digest,
    scenarioDigest: scenarioIntegrity.digest,
    evidencePayload: buildEvidencePayloadV2(report, context, input.dataset),
    disclaimer: '本报告为信息辅助，不构成法律、财务或销量预测。指纹仅用于内容一致性检查，不证明来源真实、结论正确或数字签名。',
  }
}
