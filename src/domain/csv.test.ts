import { describe, expect, it } from 'vitest'
import { CsvValidationError, parseReviewCsv } from './csv'

const header = 'reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl'

describe('parseReviewCsv', () => {
  it('parses a valid review and normalizes booleans and numbers', () => {
    const rows = parseReviewCsv(`${header}\nr1,p1,en-US,2,Hot,The charger gets hot,2026-07-01,true,https://example.com/r1`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rating).toBe(2)
    expect(rows[0]?.verifiedPurchase).toBe(true)
  })

  it('reports the exact row and field for invalid data', () => {
    expect(() => parseReviewCsv(`${header}\nr1,p1,en-US,8,Hot,Text,2026-07-01,true,https://example.com/r1`))
      .toThrowError(new CsvValidationError(2, 'rating', '评分必须在 1 到 5 之间'))
  })

  it('rejects personal data columns', () => {
    expect(() => parseReviewCsv(`${header},email\nr1,p1,en-US,5,Good,Text,2026-07-01,true,https://example.com/r1,a@example.com`))
      .toThrowError(/不接受个人信息字段: email/)
  })

  it('deduplicates reviews by reviewId', () => {
    const row = 'r1,p1,en-US,5,Good,Text,2026-07-01,true,https://example.com/r1'
    expect(parseReviewCsv(`${header}\n${row}\n${row}`)).toHaveLength(1)
  })

  it('rejects reviews that reference products outside the allowed dataset', () => {
    expect(() => parseReviewCsv(`${header}\nr1,unknown-product,en-US,2,Hot,Text,2026-07-01,true,fixture:r1`, new Set(['p1'])))
      .toThrowError(new CsvValidationError(2, 'productId', '未在当前商品数据中找到: unknown-product'))
  })
})
