import type { ProductRow } from './types'

export interface CompetitorSnapshot {
  products: ProductRow[]
  currency: ProductRow['currency']
  medianPrice: number
  medianRating: number
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

function median(values: number[]): number {
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
    medianRating: Number(median(products.map((row) => row.rating)).toFixed(2)),
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
