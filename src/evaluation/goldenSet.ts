import type { DatasetBundle } from '../domain/types'
import { sampleDataset } from '../fixtures/usbCChargers'
import type { GoldenExpectation } from './evaluate'

export interface GoldenCase {
  id: string
  dataset: DatasetBundle
  expected: GoldenExpectation
}

const variants = [
  ['us-hot', 'The case gets hot under a 65W laptop load.', ['thermal']],
  ['us-overheat', 'It can overheat when both ports are occupied.', ['thermal']],
  ['us-reset', 'The first port will reset after I connect a second device.', ['port-reset']],
  ['us-interrupt', 'Charging will interrupt when a second device is attached.', ['port-reset']],
  ['us-both', 'It gets hot and will reset after connecting a second device.', ['thermal', 'port-reset']],
  ['eu-heat', 'Noticeable heat under sustained laptop charging.', ['thermal']],
  ['eu-second', 'The second device makes the laptop charging interrupt.', ['port-reset']],
  ['eu-both', 'Very hot, and connecting a second device causes a reset.', ['thermal', 'port-reset']],
] as const

export const goldenCases: GoldenCase[] = variants.map(([id, body, themeIds], index) => {
  const reviewId = `golden-review-${index + 1}`
  return {
    id,
    dataset: {
      products: sampleDataset.products.map((row) => ({ ...row, productId: `golden-product-${index + 1}` })),
      reviews: [{
        ...sampleDataset.reviews[0],
        reviewId,
        productId: `golden-product-${index + 1}`,
        body,
        sourceUrl: `fixture:golden/${id}/${reviewId}`,
      }],
      policies: sampleDataset.policies.map((row) => ({ ...row })),
    },
    expected: { themeIds: [...themeIds], riskIds: ['us-fcc-label'] },
  }
})
