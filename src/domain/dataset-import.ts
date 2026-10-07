import { z } from 'zod'
import { parseCsvRecords, CsvValidationError } from './csv'
import { safeSourceUrl } from './export-safety'
import type { DatasetBundle, ProductRow, ReviewRow } from './types'

export const importLimits = { products: 100, reviews: 10_000, bytes: 20 * 1024 * 1024 }
export const productFields = ['productId', 'title', 'brand', 'market', 'currency', 'price', 'rating', 'reviewCount', 'capturedAt', 'sourceUrl'] as const
export const reviewFields = ['reviewId', 'productId', 'market', 'locale', 'rating', 'title', 'body', 'reviewedAt', 'verifiedPurchase', 'sourceUrl'] as const
export type FieldMapping = Record<string, string>
export interface ImportTable { headers: string[]; rows: Array<{ cells: string[]; startLine: number }> }
export interface ImportPreview { dataset: DatasetBundle; deduplicatedCount: number; warnings: string[] }
const date = z.string().date()
const source = z.string().max(2048).refine((value) => safeSourceUrl(value)?.startsWith('https:') === true, '来源链接必须为不含凭证的 HTTPS 地址').nullable()
export const productImportSchema = z.object({
  productId: z.string().min(1).max(120), title: z.string().min(1).max(500), brand: z.string().max(200),
  market: z.enum(['US', 'EU', 'JP', 'UK']), currency: z.enum(['USD', 'EUR', 'JPY', 'GBP']),
  price: z.number().finite().nonnegative(), rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(), capturedAt: date, sourceUrl: source,
}).strict()
export const reviewImportSchema = z.object({
  reviewId: z.string().min(1).max(120), productId: z.string().min(1).max(120), locale: z.string().min(2).max(35),
  rating: z.number().min(1).max(5), title: z.string().max(1000), body: z.string().min(1).max(5000),
  reviewedAt: date, verifiedPurchase: z.boolean().nullable(), sourceUrl: source,
}).strict()

const normalized = (value: string) => value.toLowerCase().replace(/[ _-]/g, '')
const privateColumns = new Set(['email', 'phone', 'phonenumber', 'mobile', 'orderid', 'address', '邮箱', '电话', '手机号', '地址', '订单号'])

export function validateImportHeaders(headers: string[]): void {
  if (new Set(headers.map(normalized)).size !== headers.length || headers.some(header => !header)) throw new Error('表头重复或为空')
  const forbidden = headers.find(header => privateColumns.has(normalized(header)))
  if (forbidden) throw new Error(`不接受个人信息列：${forbidden}；请先移除，不可通过映射绕过`)
}

export function readImportTable(text: string, kind: 'products' | 'reviews'): ImportTable {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0]
  const records = parseCsvRecords(clean, firstLine.includes('\t') ? '\t' : ',')
  if (records.length < 2) throw new Error('至少需要表头和一行记录')
  if (records.length - 1 > importLimits[kind]) throw new Error(`${kind === 'products' ? '商品' : '评论'}超出 ${importLimits[kind]} 行上限，未截断或提交`)
  const headers = records[0].cells
  validateImportHeaders(headers)
  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length) throw new CsvValidationError(record.startLine, 'csv', '列数与表头不一致')
    if (record.cells.some((cell) => cell.length > 5000)) throw new CsvValidationError(record.startLine, 'csv', '单元格不得超过 5,000 字符')
  }
  return { headers, rows: records.slice(1) }
}

export function suggestMapping(headers: string[], fields: readonly string[]): FieldMapping {
  return Object.fromEntries(fields.map((field) => [field, headers.find((header) => normalized(header) === normalized(field))
    ?? (field === 'productId' ? headers.find((header) => ['asin', 'sku'].includes(normalized(header))) : undefined) ?? '']))
}

function mapped(table: ImportTable, mapping: FieldMapping, cells: string[], field: string): string {
  return cells[table.headers.indexOf(mapping[field])] ?? ''
}

function numberValue(value: string, optional = false): number | null {
  if (value === '' && optional) return null
  if (value === '' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number.NaN
  return Number(value)
}

function parseRow<T>(schema: z.ZodType<T>, candidate: unknown, line: number): T {
  const result = schema.safeParse(candidate)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new CsvValidationError(line, String(issue.path[0]), issue.message)
  }
  return result.data
}

export function previewDataset(products: ImportTable, reviews: ImportTable, productMapping: FieldMapping, reviewMapping: FieldMapping): ImportPreview {
  const requireMappings = (table: ImportTable, mapping: FieldMapping, required: string[]) => {
    for (const field of required) if (!table.headers.includes(mapping[field])) throw new Error(`请映射必填字段：${field}`)
    const columns = Object.values(mapping).filter(Boolean)
    if (new Set(columns).size !== columns.length) throw new Error('同一列不可映射到多个字段')
  }
  requireMappings(products, productMapping, ['productId', 'title', 'market', 'currency', 'price', 'capturedAt'])
  requireMappings(reviews, reviewMapping, ['reviewId', 'productId', 'locale', 'rating', 'body', 'reviewedAt'])
  const productRows = new Map<string, ProductRow>()
  const reviewRows = new Map<string, ReviewRow>()
  let deduplicatedCount = 0
  const insert = <T>(rows: Map<string, T>, id: string, row: T, line: number) => {
    if (rows.has(id)) {
      if (JSON.stringify(rows.get(id)) !== JSON.stringify(row)) throw new CsvValidationError(line, 'id', `${id} 重复但内容冲突`)
      deduplicatedCount += 1
    } else rows.set(id, row)
  }
  for (const record of products.rows) {
    const value = (field: string) => mapped(products, productMapping, record.cells, field)
    const product = parseRow(productImportSchema, {
      productId: value('productId'), title: value('title'), brand: value('brand'), market: value('market'), currency: value('currency'),
      price: numberValue(value('price')), rating: numberValue(value('rating'), true), reviewCount: numberValue(value('reviewCount'), true),
      capturedAt: value('capturedAt'), sourceUrl: value('sourceUrl') || null,
    }, record.startLine)
    insert(productRows, product.productId, product, record.startLine)
  }
  let personalText = false
  for (const record of reviews.rows) {
    const value = (field: string) => mapped(reviews, reviewMapping, record.cells, field)
    const flag = value('verifiedPurchase').toLowerCase()
    if (flag && flag !== 'true' && flag !== 'false') throw new CsvValidationError(record.startLine, 'verifiedPurchase', '仅接受 true、false 或空值')
    const review = parseRow(reviewImportSchema, {
      reviewId: value('reviewId'), productId: value('productId'), locale: value('locale'), rating: numberValue(value('rating')),
      title: value('title'), body: value('body'), reviewedAt: value('reviewedAt'), verifiedPurchase: flag ? flag === 'true' : null,
      sourceUrl: value('sourceUrl') || null,
    }, record.startLine)
    const product = productRows.get(review.productId)
    if (!product) throw new CsvValidationError(record.startLine, 'productId', `商品不存在：${review.productId}`)
    if (value('market') && value('market') !== product.market) throw new CsvValidationError(record.startLine, 'market', '评论市场与关联商品冲突')
    personalText ||= /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b1[3-9]\d{9}\b/i.test(`${review.title} ${review.body}`)
    insert(reviewRows, review.reviewId, review, record.startLine)
  }
  return {
    dataset: { products: [...productRows.values()], reviews: [...reviewRows.values()], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } },
    deduplicatedCount,
    warnings: ['购买验证状态仅为输入声明；空白汇总与链接保存为未知。未导入政策，不代表已完成合规检查。', ...(personalText ? ['正文疑似含个人信息，请人工检查。系统没有自动脱敏。'] : [])],
  }
}
