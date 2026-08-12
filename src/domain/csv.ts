import { z } from 'zod'
import type { ReviewRow } from './types'

const personalDataColumns = new Set([
  'email',
  'phone',
  'phoneNumber',
  'mobile',
  'orderId',
  'address',
])

const requiredColumns = [
  'reviewId',
  'productId',
  'locale',
  'rating',
  'title',
  'body',
  'reviewedAt',
  'verifiedPurchase',
  'sourceUrl',
] as const

const reviewSchema = z.object({
  reviewId: z.string().min(1),
  productId: z.string().min(1),
  locale: z.string().min(2),
  rating: z.number().min(1).max(5),
  title: z.string(),
  body: z.string().min(1),
  reviewedAt: z.string().date(),
  verifiedPurchase: z.boolean(),
  sourceUrl: z.string().refine(
    (value) => value.startsWith('https://') || value.startsWith('fixture:'),
    '必须为 HTTPS 来源或明确的 fixture 标识',
  ),
})

export class CsvValidationError extends Error {
  constructor(
    readonly row: number,
    readonly field: string,
    message: string,
  ) {
    super(`第 ${row} 行 ${field}: ${message}`)
    this.name = 'CsvValidationError'
  }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  cells.push(current.trim())
  return cells
}

function parseBoolean(value: string, row: number): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new CsvValidationError(row, 'verifiedPurchase', '必须为 true 或 false')
}

export function parseReviewCsv(csv: string, allowedProductIds?: ReadonlySet<string>): ReviewRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据')

  const headers = parseCsvLine(lines[0] ?? '')
  const forbidden = headers.find((header) => personalDataColumns.has(header))
  if (forbidden) throw new Error(`不接受个人信息字段: ${forbidden}`)

  for (const column of requiredColumns) {
    if (!headers.includes(column)) throw new Error(`缺少必填字段: ${column}`)
  }

  const uniqueRows = new Map<string, ReviewRow>()
  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2
    const cells = parseCsvLine(line)
    const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? '']))
    const rating = Number(raw.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new CsvValidationError(rowNumber, 'rating', '评分必须在 1 到 5 之间')
    }

    const candidate = {
      reviewId: raw.reviewId,
      productId: raw.productId,
      locale: raw.locale,
      rating,
      title: raw.title,
      body: raw.body,
      reviewedAt: raw.reviewedAt,
      verifiedPurchase: parseBoolean(raw.verifiedPurchase ?? '', rowNumber),
      sourceUrl: raw.sourceUrl,
    }
    const result = reviewSchema.safeParse(candidate)
    if (!result.success) {
      const issue = result.error.issues[0]
      throw new CsvValidationError(rowNumber, String(issue?.path[0] ?? 'unknown'), issue?.message ?? '格式无效')
    }
    if (allowedProductIds && !allowedProductIds.has(result.data.productId)) {
      throw new CsvValidationError(rowNumber, 'productId', `未在当前商品数据中找到: ${result.data.productId}`)
    }
    if (!uniqueRows.has(result.data.reviewId)) uniqueRows.set(result.data.reviewId, result.data)
  })

  return [...uniqueRows.values()]
}
