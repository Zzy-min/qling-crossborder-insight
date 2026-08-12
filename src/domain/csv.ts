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

interface CsvRecord {
  cells: string[]
  startLine: number
}

function parseCsvRecords(csv: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let current = ''
  let quoted = false
  let line = 1
  let startLine = 1

  const finishRecord = () => {
    cells.push(current.trim())
    if (cells.some((cell) => cell.length > 0)) records.push({ cells, startLine })
    cells = []
    current = ''
  }

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      finishRecord()
      line += 1
      startLine = line
    } else {
      current += character
      if (character === '\n') line += 1
      else if (character === '\r') {
        if (csv[index + 1] === '\n') {
          current += '\n'
          index += 1
        }
        line += 1
      }
    }
  }

  if (quoted) throw new CsvValidationError(startLine, 'csv', '引号未闭合')
  finishRecord()
  return records
}

function parseBoolean(value: string, row: number): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new CsvValidationError(row, 'verifiedPurchase', '必须为 true 或 false')
}

export interface ParsedReviewCsv {
  reviews: ReviewRow[]
  deduplicatedCount: number
}

export function parseReviewCsvDetailed(csv: string, allowedProductIds?: ReadonlySet<string>): ParsedReviewCsv {
  if ([...csv].length > 1_000_000) throw new Error('CSV 文件不得超过 1,000,000 个字符')
  const records = parseCsvRecords(csv.replace(/^\uFEFF/, ''))
  if (records.length < 2) throw new Error('CSV 至少需要表头和一行数据')
  if (records.length - 1 > 1000) throw new Error('CSV 最多支持 1,000 行评论')

  const headers = records[0]?.cells ?? []
  const forbidden = headers.find((header) => personalDataColumns.has(header))
  if (forbidden) throw new Error(`不接受个人信息字段: ${forbidden}`)

  for (const column of requiredColumns) {
    if (!headers.includes(column)) throw new Error(`缺少必填字段: ${column}`)
  }

  const uniqueRows = new Map<string, ReviewRow>()
  const firstRowByReviewId = new Map<string, number>()
  records.slice(1).forEach((record) => {
    const rowNumber = record.startLine
    const cells = record.cells
    if (cells.length !== headers.length) {
      throw new CsvValidationError(rowNumber, 'csv', `列数应为 ${headers.length}，实际为 ${cells.length}`)
    }
    const oversizedCellIndex = cells.findIndex((cell) => [...cell].length > 5000)
    if (oversizedCellIndex >= 0) {
      throw new CsvValidationError(rowNumber, headers[oversizedCellIndex] ?? `column-${oversizedCellIndex + 1}`, '单元格不得超过 5,000 个字符')
    }
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
    const existing = uniqueRows.get(result.data.reviewId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(result.data)) {
      throw new CsvValidationError(rowNumber, 'reviewId', `与第 ${firstRowByReviewId.get(result.data.reviewId)} 行重复但内容不一致: ${result.data.reviewId}`)
    }
    if (!existing) {
      uniqueRows.set(result.data.reviewId, result.data)
      firstRowByReviewId.set(result.data.reviewId, rowNumber)
    }
  })

  return {
    reviews: [...uniqueRows.values()],
    deduplicatedCount: records.length - 1 - uniqueRows.size,
  }
}

export function parseReviewCsv(csv: string, allowedProductIds?: ReadonlySet<string>): ReviewRow[] {
  return parseReviewCsvDetailed(csv, allowedProductIds).reviews
}
