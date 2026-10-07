import { z } from 'zod'
import { productFields, reviewFields, validateImportHeaders, type FieldMapping } from './dataset-import'
import { canonicalJson, sha256Hex } from './integrity'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const headers = z.array(z.string().min(1).max(200)).min(1).max(100)
const schema = z.object({ schemaVersion: z.literal('qling-mapping-template/1'), id: z.string().min(1).max(120), name: z.string().trim().min(1).max(120), createdAt: z.string().datetime(),
  headers: z.object({ products: headers, reviews: headers }).strict(),
  productMapping: z.record(z.string().max(200)), reviewMapping: z.record(z.string().max(200)), originDigest: digest.optional(), contentDigest: digest }).strict()
export type MappingTemplate = z.infer<typeof schema>
export const mappingTemplateLimits = { count: 50, bytes: 100_000 }

export function validateMappingTemplate(value: unknown): MappingTemplate {
  const template = schema.parse(value)
  const { contentDigest, ...content } = template
  if (sha256Hex(canonicalJson(content)) !== contentDigest) throw new Error('映射模板指纹不匹配')
  for (const kind of ['products', 'reviews'] as const) {
    validateImportHeaders(template.headers[kind])
    const mapping = kind === 'products' ? template.productMapping : template.reviewMapping
    const fields: readonly string[] = kind === 'products' ? productFields : reviewFields
    const required = kind === 'products' ? ['productId', 'title', 'market', 'currency', 'price', 'capturedAt'] : ['reviewId', 'productId', 'locale', 'rating', 'body', 'reviewedAt']
    if (Object.keys(mapping).some(field => !fields.includes(field))) throw new Error('映射模板包含未知字段，不接受额外凭证或数据')
    const columns = Object.values(mapping).filter(Boolean)
    if (columns.some(column => !template.headers[kind].includes(column)) || new Set(columns).size !== columns.length || required.some(field => !mapping[field])) throw new Error('映射模板字段缺失、重复或不在原表头中')
  }
  return template
}

export function createMappingTemplate(name: string, tableHeaders: MappingTemplate['headers'], productMapping: FieldMapping, reviewMapping: FieldMapping): MappingTemplate {
  const content = { schemaVersion: 'qling-mapping-template/1' as const, id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), headers: tableHeaders, productMapping, reviewMapping }
  return validateMappingTemplate({ ...content, contentDigest: sha256Hex(canonicalJson(content)) })
}

export function applyMappingTemplate(value: MappingTemplate, tableHeaders: MappingTemplate['headers']) {
  const template = validateMappingTemplate(value)
  for (const kind of ['products', 'reviews'] as const) {
    validateImportHeaders(tableHeaders[kind])
    if (canonicalJson([...tableHeaders[kind]].sort()) !== canonicalJson([...template.headers[kind]].sort())) throw new Error(`${kind === 'products' ? '商品' : '评论'}表头集合不匹配，请重新映射；未应用模板或提交数据`)
  }
  return { productMapping: { ...template.productMapping }, reviewMapping: { ...template.reviewMapping } }
}

export function mappingTemplateBackup(value: MappingTemplate): string {
  return JSON.stringify(validateMappingTemplate(value), null, 2)
}

export function readMappingTemplateBackup(text: string): MappingTemplate {
  if (new TextEncoder().encode(text).length > mappingTemplateLimits.bytes) throw new Error('模板文件超过 100 KB，未读取或截断')
  const previous = validateMappingTemplate(JSON.parse(text))
  const { contentDigest, ...content } = previous
  const restored = { ...content, id: crypto.randomUUID(), createdAt: new Date().toISOString(), originDigest: contentDigest }
  return validateMappingTemplate({ ...restored, contentDigest: sha256Hex(canonicalJson(restored)) })
}
