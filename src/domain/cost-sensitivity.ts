import { costFormulaVersion, evaluateCostScenario, validateCostSet, type CostSet, type CostScenario, type SensitivitySpec } from './cost-scenario'
import { canonicalJson, sha256Hex } from './integrity'

export const sensitivityAxes = ['price', 'adRate', 'returnRate', 'improvement'] as const
export type SensitivityAxis = typeof sensitivityAxes[number]
export interface SensitivityPoint {
  value: number
  contribution: number | null
  breakEvenUnits: number | null
  status: ReturnType<typeof evaluateCostScenario>['result']['status'] | 'calculation-error'
  missing: string[]
}
export interface SensitivityCurve { kind: CostScenario['kind']; points: SensitivityPoint[] }
export interface CostSensitivity {
  schemaVersion: 'qling-cost-sensitivity-result/1'
  formulaVersion: typeof costFormulaVersion
  target: CostScenario['target']
  spec: SensitivitySpec
  axes: Array<{ axis: SensitivityAxis; curves: SensitivityCurve[] }>
  digest: string
  note: string
}

export function initialSensitivitySpec(value: CostSet): SensitivitySpec | null {
  const set = validateCostSet(value)
  const baseline = set.scenarios.find(scenario => scenario.kind === 'baseline')!
  const price = baseline.price.value
  const ad = baseline.costs.adRate.value
  const returns = baseline.costs.returnRate.value
  const improvement = baseline.costs.improvement.value
  if (price === null || ad === null || returns === null || improvement === null) return null
  const spec = { schemaVersion: 'qling-cost-sensitivity/1' as const, ranges: {
    price: { min: price * 0.8, max: price * 1.2 },
    adRate: { min: Math.max(0, ad - 0.05), max: Math.min(1, ad + 0.05) },
    returnRate: { min: Math.max(0, returns - 0.05), max: Math.min(1, returns + 0.05) },
    improvement: { min: Math.max(0, improvement * 0.8), max: improvement + 5 },
  } }
  return Object.values(spec.ranges).every(range => Number.isFinite(range.min) && Number.isFinite(range.max)) ? spec : null
}

export function buildCostSensitivity(value: CostSet): CostSensitivity | null {
  const set = validateCostSet(value)
  if (!set.sensitivity) return null
  const spec = set.sensitivity
  const axes = sensitivityAxes.map(axis => ({ axis, curves: set.scenarios.map(scenario => {
    const range = spec.ranges[axis]
    const points: SensitivityPoint[] = Array.from({ length: 11 }, (_, index) => {
      const amount = range.min === range.max || index === 0 ? range.min : index === 10 ? range.max : range.min * (1 - index / 10) + range.max * (index / 10)
      const original = axis === 'price' ? scenario.price : scenario.costs[axis]
      const assumed = { ...original, value: amount, status: 'included' as const, identity: 'user-assumption' as const, source: '单变量敏感性条件假设；非实测结果', updatedAt: null }
      const changed = axis === 'price' ? { ...scenario, price: assumed } : { ...scenario, costs: { ...scenario.costs, [axis]: assumed } }
      try {
        const result = evaluateCostScenario(changed).result
        return { value: amount, contribution: result.contributionPerUnit, breakEvenUnits: result.breakEvenUnits, status: result.status, missing: result.missing }
      } catch {
        return { value: amount, contribution: null, breakEvenUnits: null, status: 'calculation-error', missing: [] }
      }
    })
    return { kind: scenario.kind, points }
  }) }))
  const content: Omit<CostSensitivity, 'digest'> = { schemaVersion: 'qling-cost-sensitivity-result/1', formulaVersion: costFormulaVersion, target: set.scenarios[0].target, spec, axes,
    note: '每条曲线只改变一个参数，其他参数保持所选情景原值；11 个等距条件点不是市场预测。未知成本不补零；未计算点不连线。负贡献或未知固定投入不计算保本销量。范围默认值为产品启发式，可修改，不是行业标准。' }
  return { ...content, digest: sha256Hex(canonicalJson({ input: set, result: content })) }
}
