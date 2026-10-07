import { z } from 'zod'
import { validateAnalysisRun, type AnalysisRun } from './analysis-run'
import { ASPECT_IDS, quoteAnchorSchema, validateQuoteAnchor } from './evidence-contract.mjs'
import type { QuoteAnchor } from './types'
import { canonicalJson, sha256Hex } from './integrity'

export const imagePromptVersion = 'qling-image-evidence/2'
const id = z.string().trim().min(1).max(120)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const source = z.enum(['demo', 'user-provided', 'official', 'unknown'])
const bindingSchema = z.object({
  protocolVersion: z.literal(2), promptVersion: z.literal(imagePromptVersion), workspaceId: id, runId: id, dataDigest: digest,
  target: z.object({ productId: id, market: z.enum(['US', 'EU', 'JP', 'UK']), currency: z.enum(['USD', 'EUR', 'JPY', 'GBP']) }).strict(),
  aspectId: z.enum(ASPECT_IDS as [string, ...string[]]), anchors: z.array(quoteAnchorSchema).min(1).max(10), hypothesis: z.string().trim().min(1).max(1000),
  sourceIdentity: z.object({ products: source, reviews: source, policies: source }).strict(), bindingDigest: digest,
}).strict()
export const conceptImageResponseSchema = z.object({
  imageId: z.string().regex(/^[a-f0-9]{16}$/), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  model: z.string().trim().min(1).max(200), reviewIds: z.array(id).min(1).max(10), binding: bindingSchema, cached: z.boolean(),
}).strict()

export type ConceptImageBinding = z.infer<typeof bindingSchema>
export type ConceptImageResponse = z.infer<typeof conceptImageResponseSchema>
export interface ConceptImageRequest {
  protocolVersion: 2
  workspaceId: string
  runId: string
  dataDigest: string
  target: ConceptImageBinding['target']
  aspectId: ConceptImageBinding['aspectId']
  hypothesis: string
  anchors: QuoteAnchor[]
  dataset: AnalysisRun['input']['dataset']
}

export function conceptImageBinding(input: ConceptImageRequest): ConceptImageBinding {
  if (sha256Hex(canonicalJson(input.dataset)) !== input.dataDigest) throw new Error('生图输入数据指纹不匹配')
  const content = { protocolVersion: input.protocolVersion, promptVersion: imagePromptVersion, workspaceId: input.workspaceId, runId: input.runId,
    dataDigest: input.dataDigest, target: input.target, aspectId: input.aspectId, anchors: input.anchors, hypothesis: input.hypothesis, sourceIdentity: input.dataset.provenance }
  return bindingSchema.parse({ ...content, bindingDigest: sha256Hex(canonicalJson(content)) })
}

export function createConceptImageRequest(value: AnalysisRun, themeId: string, anchors: QuoteAnchor[], hypothesis: string): ConceptImageRequest {
  const run = validateAnalysisRun(value)
  const theme = run.report.themes.find(item => item.id === themeId)
  if (!theme || !ASPECT_IDS.includes(theme.aspectId as ConceptImageBinding['aspectId'])) throw new Error('请选择有原文锚点的方面结论')
  const selected = z.array(quoteAnchorSchema).min(1).max(10).parse(anchors)
  const firstReview = run.input.dataset.reviews.find(item => item.reviewId === selected[0].reviewId)
  const product = run.input.dataset.products.find(item => item.productId === firstReview?.productId)
  if (!product) throw new Error('生图对象不在分析范围内')
  if ((theme.productId && theme.productId !== product.productId) || (theme.market && theme.market !== product.market)) throw new Error('生图对象与方面范围不匹配')
  const target = { productId: product.productId, market: product.market, currency: product.currency }
  const supported = new Set(theme.evidence.filter(item => item.evidenceType === 'review' && item.quoteAnchor).map(item => canonicalJson(item.quoteAnchor)))
  if (new Set(selected.map(canonicalJson)).size !== selected.length) throw new Error('生图锚点重复')
  for (const anchor of selected) {
    validateQuoteAnchor(anchor, run.input.dataset, target)
    if (anchor.quote.length > 1000 || !supported.has(canonicalJson(anchor))) throw new Error('生图必须绑定该结论已保存的原文锚点')
  }
  const input: ConceptImageRequest = { protocolVersion: 2, workspaceId: run.workspaceId, runId: run.id, dataDigest: run.dataDigest, target,
    aspectId: theme.aspectId as ConceptImageBinding['aspectId'], hypothesis: z.string().trim().min(1).max(1000).parse(hypothesis), anchors: selected, dataset: run.input.dataset }
  conceptImageBinding(input)
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 20 * 1024 * 1024) throw new Error('生图请求超过 20 MB，未截断或发送')
  return input
}

export function validateConceptImageResponse(value: unknown, input: ConceptImageRequest): ConceptImageResponse {
  const response = conceptImageResponseSchema.parse(value)
  const expected = conceptImageBinding(input)
  if (canonicalJson(response.binding) !== canonicalJson(expected)) throw new Error('生图绑定与本次请求不匹配')
  const expectedIds = [...new Set(input.anchors.map(anchor => anchor.reviewId))]
  if (canonicalJson(response.reviewIds) !== canonicalJson(expectedIds)) throw new Error('生图引用列表不匹配')
  return response
}
