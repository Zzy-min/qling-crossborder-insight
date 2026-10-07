import { describe, expect, it } from 'vitest'
import { readImportTable, suggestMapping, previewDataset, productFields, reviewFields } from './dataset-import'
import { buildInsightReport } from './analysis'
import { buildCompetitorSnapshot, buildPricingScenario } from './market'

const products = 'ASIN,title,market,currency,price,capturedAt,rating,reviewCount,sourceUrl\nMY-ASIN,Charger,US,USD,30,2026-10-01,,,'
const reviews = 'reviewId,ASIN,locale,rating,body,reviewedAt,verifiedPurchase,sourceUrl\nR1,MY-ASIN,en-US,2,charger gets hot,2026-10-02,,'
function preview(productCsv = products, reviewCsv = reviews) {
  const productTable = readImportTable(productCsv, 'products')
  const reviewTable = readImportTable(reviewCsv, 'reviews')
  return previewDataset(productTable, reviewTable, suggestMapping(productTable.headers, productFields), suggestMapping(reviewTable.headers, reviewFields))
}

describe('seller dataset import', () => {
  it('accepts non-preset ASIN, retains unknown values and does not import demo policies', () => {
    const result = preview()
    expect(result.dataset.products[0]).toMatchObject({ productId: 'MY-ASIN', rating: null, reviewCount: null, sourceUrl: null })
    expect(result.dataset.reviews[0]).toMatchObject({ productId: 'MY-ASIN', verifiedPurchase: null, sourceUrl: null })
    expect(result.dataset.policies).toEqual([])
    expect(result.dataset.provenance?.reviews).toBe('user-provided')
    expect(buildInsightReport(result.dataset).dataQuality.totalReviews).toBe(1)
    expect(buildCompetitorSnapshot(result.dataset.products).medianRating).toBeNull()
  })
  it('handles BOM, tab separators, Chinese and quoted multiline content', () => {
    const result = preview('\uFEFF' + products.replaceAll(',', '\t'), reviews.replace('charger gets hot', '"充电器发热,\n多行"'))
    expect(result.dataset.reviews[0].body).toBe('充电器发热,\n多行')
  })
  it('deduplicates identical records but rejects conflicting IDs', () => {
    expect(preview(products, reviews + '\n' + reviews.split('\n')[1]).deduplicatedCount).toBe(1)
    expect(() => preview(products, reviews + '\n' + reviews.split('\n')[1].replace('gets hot', 'is fine'))).toThrow('冲突')
  })
  it.each([
    ['orphan', reviews.replace('R1,MY-ASIN', 'R1,OTHER'), '商品不存在'],
    ['date', reviews.replace('2026-10-02', '2026-02-30'), 'reviewedAt'],
    ['rating', reviews.replace('en-US,2', 'en-US,NaN'), 'rating'],
    ['verified flag', reviews.replace('2026-10-02,,', '2026-10-02,yes,'), 'true、false'],
    ['unsafe URL', reviews.replace('2026-10-02,,', '2026-10-02,,javascript:alert(1)'), 'HTTPS'],
  ])('rejects %s without producing a dataset', (_label, csv, message) => {
    expect(() => preview(products, csv)).toThrow(message)
  })
  it('rejects cross-market references when review market is explicitly supplied', () => {
    expect(() => preview(products, reviews.replace('reviewId,ASIN', 'market,reviewId,ASIN').replace('R1,MY-ASIN', 'EU,R1,MY-ASIN'))).toThrow('市场')
  })
  it.each(['EMAIL', 'phone_number', 'Order ID', '地址'])('blocks privacy column %s before mapping', (column) => {
    expect(() => readImportTable(`${column},id\nsecret,1`, 'products')).toThrow('个人信息列')
  })
  it('rejects missing market and invalid numbers instead of guessing or filling zero', () => {
    expect(() => preview(products.replace('US,USD', ',USD'))).toThrow('market')
    expect(() => preview(products.replace('USD,30', 'USD,'))).toThrow('price')
  })
  it('enforces raw row limits before deduplication', () => {
    expect(() => readImportTable('id\n' + Array.from({ length: 101 }, () => '1').join('\n'), 'products')).toThrow('100 行')
    expect(() => readImportTable('id\n' + Array.from({ length: 10001 }, () => '1').join('\n'), 'reviews')).toThrow('10000 行')
  })
  it('warns about suspected personal data in text, without claiming redaction', () => {
    expect(preview(products, reviews.replace('charger gets hot', 'Contact test@example.com')).warnings.join('')).toContain('没有自动脱敏')
  })
  it('keeps unknown costs distinct from explicit zero', () => {
    const scenario = { currency: 'USD' as const, price: 30, landedCost: null, platformRate: null, adRate: null, fixedLaunchCost: 0 }
    expect(buildPricingScenario(scenario).status).toBe('missing-costs')
    expect(buildPricingScenario({ ...scenario, landedCost: 0, platformRate: 0, adRate: 0 }).result?.breakEvenUnits).toBe(0)
  })
})
