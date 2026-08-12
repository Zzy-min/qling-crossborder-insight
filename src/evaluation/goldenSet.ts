import type { DatasetBundle } from '../domain/types'
import { sampleDataset } from '../fixtures/usbCChargers'
import type { GoldenExpectation } from './evaluate'

export type ReviewStatus = 'machine-seeded' | 'human-reviewed'

export interface GoldenCase {
  id: string
  family: 'thermal' | 'port-reset' | 'combined' | 'neutral'
  seed: number
  reviewStatus: ReviewStatus
  dataset: DatasetBundle
  expected: GoldenExpectation
}

const templates = [
  { family: 'thermal', bodies: ['The case gets hot under laptop load.', 'It can overheat during sustained charging.', 'Noticeable heat appears at full power.'], themes: ['thermal'] },
  { family: 'port-reset', bodies: ['The first port will reset after I connect a second device.', 'Charging will interrupt when another cable is attached.', 'A second device briefly interrupts the laptop port.'], themes: ['port-reset'] },
  { family: 'combined', bodies: ['It gets hot and will reset after connecting a second device.', 'The charger can overheat, and another cable interrupts charging.', 'Noticeable heat plus a port reset when both outputs are used.'], themes: ['thermal', 'port-reset'] },
  { family: 'neutral', bodies: ['Compact charger with stable output.', 'Small enough for travel and charges quickly.', 'The finish looks clean and the plug folds neatly.'], themes: [] },
] as const

export function createGoldenCases(count = 200): GoldenCase[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Golden case count must be a positive integer')
  return Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length]
    const body = template.bodies[Math.floor(index / templates.length) % template.bodies.length]
    const sequence = index + 1
    const reviewId = `golden-review-${String(sequence).padStart(3, '0')}`
    const productId = `golden-product-${String(sequence).padStart(3, '0')}`
    return {
      id: `golden-${String(sequence).padStart(3, '0')}`,
      family: template.family,
      seed: sequence,
      reviewStatus: 'machine-seeded',
      dataset: {
        products: [{ ...sampleDataset.products[0], productId }],
        reviews: [{
          ...sampleDataset.reviews[0],
          reviewId,
          productId,
          rating: template.family === 'neutral' ? 5 : 2,
          title: `${template.family} case ${sequence}`,
          body,
          sourceUrl: `fixture:golden/${reviewId}`,
        }],
        policies: sampleDataset.policies.map((row) => ({ ...row })),
      },
      expected: { themeIds: [...template.themes], riskIds: ['us-fcc-label', 'eu-common-charger-scope'] },
    }
  })
}

export const goldenCases = createGoldenCases()
