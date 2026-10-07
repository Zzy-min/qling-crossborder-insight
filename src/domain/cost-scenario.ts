import { z } from 'zod'
import { canonicalJson, sha256Hex } from './integrity'

export const costFormulaVersion = 'qling-contribution/1'
const currencySchema = z.enum(['USD', 'EUR', 'JPY', 'GBP'])
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})
const itemSchema = z.object({
  value: z.number().finite().nonnegative().nullable(),
  status: z.enum(['unknown', 'included', 'not-included']),
  currency: currencySchema,
  identity: z.enum(['measured', 'user-assumption', 'example']),
  source: z.string().trim().min(1).max(1000).nullable(),
  updatedAt: dateSchema.nullable(),
}).strict().superRefine((item, context) => {
  if ((item.status === 'unknown' && item.value !== null) || (item.status === 'included' && item.value === null) || (item.status === 'not-included' && item.value !== 0)) context.addIssue({ code: z.ZodIssueCode.custom, message: '未知值必须为 null；计入值必须已知；明确不计入必须为零' })
})

export type CostItem = z.infer<typeof itemSchema>
export const costItemSchema = itemSchema
export const costKeys = ['landed', 'procurement', 'freightDuty', 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement', 'fixedLaunch'] as const
export type CostKey = typeof costKeys[number]
const costFields = Object.fromEntries(costKeys.map(key => [key, itemSchema])) as Record<CostKey, typeof itemSchema>
export const costScenarioSchema = z.object({
  schemaVersion: z.literal('qling-cost-scenario/1'),
  kind: z.enum(['baseline', 'improvement', 'stress']),
  target: z.object({ productId: z.string().min(1).max(120), market: z.enum(['US', 'EU', 'JP', 'UK']), currency: currencySchema }).strict(),
  price: itemSchema,
  landedMode: z.enum(['combined', 'split']),
  costs: z.object(costFields).strict(),
  omittedCosts: z.array(z.string().trim().min(1).max(200)).max(100),
}).strict().superRefine((scenario, context) => {
  for (const [key, item] of Object.entries({ price: scenario.price, ...scenario.costs })) {
    if (item.currency !== scenario.target.currency) context.addIssue({ code: z.ZodIssueCode.custom, message: `${key} 币种与商品不一致` })
    if (['platformRate', 'adRate', 'returnRate'].includes(key) && item.value !== null && item.value > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: `${key} 必须介于 0 与 1` })
  }
  const inactive = scenario.landedMode === 'combined' ? ['procurement', 'freightDuty'] as const : ['landed'] as const
  if (inactive.some(key => scenario.costs[key].status === 'included')) context.addIssue({ code: z.ZodIssueCode.custom, message: '综合到岸与采购/头程关税不可同时计入' })
  if (scenario.price.status === 'not-included' || scenario.price.value === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: '售价必须大于零或保持未知' })
})

export type CostScenario = z.infer<typeof costScenarioSchema>
const sensitivityRange = z.object({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }).strict().refine(range => range.min <= range.max, '范围下限不能超过上限')
export const sensitivitySpecSchema = z.object({ schemaVersion: z.literal('qling-cost-sensitivity/1'), ranges: z.object({
  price: sensitivityRange.refine(range => range.min > 0, '售价范围必须大于零'),
  adRate: sensitivityRange.refine(range => range.max <= 1, '广告比例不得超过 1'),
  returnRate: sensitivityRange.refine(range => range.max <= 1, '退货比例不得超过 1'),
  improvement: sensitivityRange,
}).strict() }).strict()
export type SensitivitySpec = z.infer<typeof sensitivitySpecSchema>
export const costSetSchema = z.object({ schemaVersion: z.literal('qling-cost-set/1'), scenarios: z.array(costScenarioSchema).length(3), sensitivity: sensitivitySpecSchema.optional() }).strict()
export type CostSet = z.infer<typeof costSetSchema>

export function initialCostSet(target: CostScenario['target']): CostSet {
  return { schemaVersion: 'qling-cost-set/1', scenarios: (['baseline', 'improvement', 'stress'] as const).map(kind => initialCostScenario(target, kind)) }
}

export function validateCostSet(value: unknown): CostSet {
  const set = costSetSchema.parse(value)
  compareCostScenarios(set.scenarios)
  return set
}

export const costLabels: Record<CostKey | 'price', string> = { price: '售价', landed: '综合到岸成本', procurement: '采购', freightDuty: '头程及关税', platformRate: '平台佣金率', fulfillment: '履约', adRate: '广告费率', storage: '仓储分摊', returnRate: '退货率', returnIncrementalLoss: '每次退货增量净损失', improvement: '单件新增改良成本', fixedLaunch: '固定启动投入' }
export const costKindLabels = { baseline: '基线', improvement: '改良', stress: '压力' }

export function formatContributionRate(value: number | null): string {
  if (value === null) return '未计算'
  const percentage = value * 100
  return Number.isFinite(percentage) ? `${percentage.toFixed(2)}%` : '比例超出安全数值范围'
}

export function costSetRows(value: CostSet): Array<{ label: string; value: string }> {
  return compareCostScenarios(validateCostSet(value).scenarios).flatMap(({ scenario, result, scenarioDigest, contributionDelta }) => {
    const prefix = `${costKindLabels[scenario.kind]} · `
    const format = (amount: number | null) => amount === null ? '未计算' : `${scenario.target.currency} ${amount.toFixed(2)}`
    return [
      { label: prefix + '对象', value: `${scenario.target.productId}/${scenario.target.market}/${scenario.target.currency} · ${scenario.landedMode === 'combined' ? '综合到岸' : '采购＋头程关税'}` },
      ...Object.entries({ price: scenario.price, ...scenario.costs }).map(([key, item]) => ({ label: prefix + costLabels[key as CostKey | 'price'], value: `${item.status === 'unknown' ? '未知' : item.status === 'not-included' ? '用户明确不计入' : ['platformRate', 'adRate', 'returnRate'].includes(key) ? `${(item.value! * 100).toFixed(2)}%` : format(item.value)} · 身份 ${item.identity} · 来源 ${item.source ?? '未知'} · 更新 ${item.updatedAt ?? '未知'}` })),
      { label: prefix + '单件贡献', value: format(result.contributionPerUnit) },
      { label: prefix + '贡献率', value: formatContributionRate(result.contributionMarginRate) },
      { label: prefix + '相对基线贡献变化', value: format(contributionDelta) },
      { label: prefix + '保本销量', value: result.breakEvenUnits === null ? '未计算' : `${result.breakEvenUnits} 件` },
      { label: prefix + '待填写', value: result.missing.map(key => costLabels[key as CostKey | 'price']).join('、') || '无' },
      { label: prefix + '限制', value: result.limitations.join('；') },
      { label: prefix + '内容指纹', value: `${costFormulaVersion} / ${scenarioDigest}` },
    ]
  })
}
export interface ContributionResult {
  schemaVersion: 'qling-contribution-result/1'
  formulaVersion: typeof costFormulaVersion
  status: 'missing-variable-costs' | 'missing-fixed-cost' | 'non-positive-contribution' | 'ready'
  missing: string[]
  variableCostPerUnit: number | null
  contributionPerUnit: number | null
  contributionMarginRate: number | null
  breakEvenUnits: number | null
  limitations: string[]
}

export function initialCostScenario(target: CostScenario['target'], kind: CostScenario['kind']): CostScenario {
  const unknown = (): CostItem => ({ value: null, status: 'unknown', currency: target.currency, identity: 'user-assumption', source: null, updatedAt: null })
  return { schemaVersion: 'qling-cost-scenario/1', kind, target: { ...target }, price: unknown(), landedMode: 'combined', costs: Object.fromEntries(costKeys.map(key => [key, unknown()])) as CostScenario['costs'], omittedCosts: [] }
}

export function evaluateCostScenario(value: unknown): { scenario: CostScenario; result: ContributionResult; scenarioDigest: string } {
  const scenario = costScenarioSchema.parse(value)
  const variableKeys: CostKey[] = [...(scenario.landedMode === 'combined' ? ['landed'] as const : ['procurement', 'freightDuty'] as const), 'platformRate', 'fulfillment', 'adRate', 'storage', 'returnRate', 'returnIncrementalLoss', 'improvement']
  const missing = variableKeys.filter(key => scenario.costs[key].status === 'unknown') as string[]
  if (scenario.price.status === 'unknown') missing.unshift('price')
  const limitations = ['贡献测算不是财务净利润；仅覆盖列出的成本，不预测销量或总收益。', '未列出的税款、汇率损益及其他经营费用未纳入，请另外核对。', '退货损失是相对正常销售的每次增量净损失，不应再次重复扣除退款、货值和佣金。', '改良情景中的退货率为条件假设，不证明改良已经生效。', ...scenario.omittedCosts.map(item => `未覆盖：${item}`)]
  for (const key of variableKeys) if (scenario.costs[key].status === 'not-included') limitations.push(`用户明确不计入：${key}`)
  if (scenario.costs.fixedLaunch.status === 'not-included') limitations.push('用户明确不计入：fixedLaunch')
  const result: ContributionResult = { schemaVersion: 'qling-contribution-result/1', formulaVersion: costFormulaVersion, status: 'missing-variable-costs', missing, variableCostPerUnit: null, contributionPerUnit: null, contributionMarginRate: null, breakEvenUnits: null, limitations }
  if (!missing.length) {
    const price = scenario.price.value!
    const cost = (key: CostKey) => scenario.costs[key].value!
    const landed = scenario.landedMode === 'combined' ? cost('landed') : cost('procurement') + cost('freightDuty')
    const variableCost = landed + price * (cost('platformRate') + cost('adRate')) + cost('fulfillment') + cost('storage') + cost('returnRate') * cost('returnIncrementalLoss') + cost('improvement')
    const contribution = price - variableCost
    if (![variableCost, contribution, contribution / price].every(Number.isFinite)) throw new Error('成本计算超出有限数值范围')
    result.variableCostPerUnit = variableCost
    result.contributionPerUnit = contribution
    result.contributionMarginRate = contribution / price
    if (scenario.costs.fixedLaunch.status === 'unknown') result.missing.push('fixedLaunch')
    result.status = contribution <= 0 ? 'non-positive-contribution' : result.missing.length ? 'missing-fixed-cost' : 'ready'
    if (result.status === 'ready') {
      const units = Math.ceil(cost('fixedLaunch') / contribution)
      if (!Number.isSafeInteger(units)) throw new Error('保本销量超出安全整数范围')
      result.breakEvenUnits = units
    }
  } else if (scenario.costs.fixedLaunch.status === 'unknown') result.missing.push('fixedLaunch')
  return { scenario, result, scenarioDigest: sha256Hex(canonicalJson({ schemaVersion: 'qling-cost-scenario-digest/1', scenario, result })) }
}

export function compareCostScenarios(values: unknown[]) {
  if (values.length !== 3) throw new Error('需要基线、改良、压力三种情景')
  const evaluated = values.map(evaluateCostScenario)
  if (new Set(evaluated.map(item => item.scenario.kind)).size !== 3) throw new Error('三种情景不能重复')
  if (new Set(evaluated.map(item => canonicalJson(item.scenario.target))).size !== 1) throw new Error('不可比较不同商品、市场或币种')
  const baseline = evaluated.find(item => item.scenario.kind === 'baseline')!
  return evaluated.map(item => {
    const difference = item.result.contributionPerUnit === null || baseline.result.contributionPerUnit === null ? null : item.result.contributionPerUnit - baseline.result.contributionPerUnit
    return { ...item, contributionDelta: difference !== null && Number.isFinite(difference) ? difference : null }
  })
}
