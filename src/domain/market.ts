import type { ProductRow } from './types'
import { currencySymbol } from './labels'

export interface CompetitorSnapshot {
  products: ProductRow[]
  currency: ProductRow['currency']
  medianPrice: number
  medianRating: number | null
  capturedAt: string
}

export interface PricingInput {
  price: number
  landedCost: number
  platformRate: number
  adRate: number
  fixedLaunchCost: number
}

export interface PricingResult extends PricingInput {
  variableFees: number
  contributionPerUnit: number
  contributionMarginRate: number
  breakEvenUnits: number
}

export interface PricingAssumptions {
  price: number
  landedCost: number | null
  platformRate: number | null
  adRate: number | null
  currency: ProductRow['currency']
  fixedLaunchCost: number | null
}

export interface PricingScenario {
  target?: { productId: string; market: ProductRow['market']; currency: ProductRow['currency'] }
  assumptions: PricingAssumptions
  status: 'ready' | 'missing-launch-cost' | 'missing-costs' | 'invalid'
  result: PricingResult | null
}

export const pricingScenarioNote = '定价参数为可修改的情景假设；证据链指纹不包含定价参数，情景指纹单独覆盖输入、公式与结果。贡献测算仅含到岸成本、平台和广告费率，不是财务净利润，其他费用需另行核算。'

export function buildPricingScenario(assumptions: PricingAssumptions, target?: PricingScenario['target']): PricingScenario {
  const context = target ? { target: { productId: target.productId, market: target.market, currency: target.currency } } : {}
  const { currency: _currency, ...input } = assumptions
  if (target && target.currency !== assumptions.currency) return { ...context, assumptions: { ...assumptions }, status: 'invalid', result: null }
  if (input.landedCost === null || input.platformRate === null || input.adRate === null) {
    return { ...context, assumptions: { ...assumptions }, status: 'missing-costs', result: null }
  }
  try {
    const result = simulatePricing({ ...input, landedCost: input.landedCost, platformRate: input.platformRate, adRate: input.adRate, fixedLaunchCost: input.fixedLaunchCost ?? 0 })
    return {
      ...context,
      assumptions: { ...assumptions },
      status: input.fixedLaunchCost === null ? 'missing-launch-cost' : 'ready',
      result: input.fixedLaunchCost === null ? null : result,
    }
  } catch {
    return { ...context, assumptions: { ...assumptions }, status: 'invalid', result: null }
  }
}

export function pricingScenarioMessage(scenario: PricingScenario): string {
  if (scenario.status === 'missing-costs') return '到岸成本或费率待填写，贡献和保本销量未计算。'
  if (scenario.status === 'missing-launch-cost') return '固定启动成本待填写，保本销量未计算。'
  if (scenario.status === 'invalid') return '当前参数无法形成有效的正贡献情景，保本销量未计算。'
  return '保本销量为固定启动成本除以单件边际贡献后向上取整，不是需求或销量预测。'
}

export function pricingScenarioRows(scenario: PricingScenario): Array<{ label: string; value: string }> {
  const { assumptions, result } = scenario
  const money = (value: number | null) => value === null ? '待填写' : Number.isFinite(value)
    ? `${assumptions.currency} ${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '无效参数'
  const rate = (value: number | null) => value === null ? '待填写' : Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '无效参数'
  const rows = [
    { label: '定价币种', value: `${assumptions.currency} (${currencySymbol(assumptions.currency)})` },
    { label: '售价', value: money(assumptions.price) },
    { label: '到岸成本', value: money(assumptions.landedCost) },
    { label: '固定启动成本', value: assumptions.fixedLaunchCost === null ? '待填写' : money(assumptions.fixedLaunchCost) },
    { label: '平台费率', value: rate(assumptions.platformRate) },
    { label: '广告费率', value: rate(assumptions.adRate) },
  ]
  if (scenario.target) rows.unshift({ label: '测算商品', value: scenario.target.productId }, { label: '商品市场', value: scenario.target.market })
  if (result) rows.push(
    { label: '单件边际贡献', value: money(result.contributionPerUnit) },
    { label: '贡献毛利率', value: rate(result.contributionMarginRate) },
    { label: '保本销量', value: `${result.breakEvenUnits} 件` },
  )
  return rows
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function buildCompetitorSnapshot(products: ProductRow[]): CompetitorSnapshot {
  if (products.length === 0) throw new Error('At least one product is required')
  const currencies = new Set(products.map((row) => row.currency))
  if (currencies.size !== 1) throw new Error('Competitor snapshot requires one currency')
  return {
    products: [...products].sort((a, b) => a.price - b.price),
    currency: products[0].currency,
    medianPrice: Number(median(products.map((row) => row.price)).toFixed(2)),
    medianRating: products.some((row) => row.rating !== null) ? Number(median(products.flatMap((row) => row.rating === null ? [] : [row.rating])).toFixed(2)) : null,
    capturedAt: products.map((row) => row.capturedAt).sort().at(-1)!,
  }
}

export function simulatePricing(input: PricingInput): PricingResult {
  const values = Object.values(input)
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Pricing inputs must be non-negative numbers')
  if (input.platformRate + input.adRate >= 1) throw new Error('Combined variable rates must be below 100%')
  const variableFees = input.price * (input.platformRate + input.adRate)
  const contributionPerUnit = input.price - input.landedCost - variableFees
  if (contributionPerUnit <= 0) throw new Error('Scenario must have positive contribution')
  return {
    ...input,
    variableFees: Number(variableFees.toFixed(2)),
    contributionPerUnit: Number(contributionPerUnit.toFixed(2)),
    contributionMarginRate: Number((contributionPerUnit / input.price).toFixed(4)),
    breakEvenUnits: Math.ceil(input.fixedLaunchCost / contributionPerUnit),
  }
}

/** 非美元情景的初值：售价用该币种竞品中位数，到岸成本按 45% 预填。 */
export function pricingSeed(products: ProductRow[], currency: ProductRow['currency']) {
  const matched = products.filter((row) => row.currency === currency)
  if (matched.length === 0) return null
  const price = buildCompetitorSnapshot(matched).medianPrice
  return { price, landedCost: Number((price * 0.45).toFixed(2)) }
}
