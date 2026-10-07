import { z } from 'zod'
import { validateAnalysisRun, type AnalysisRun } from './analysis-run'
import { conceptImageResponseSchema, createConceptImageRequest, validateConceptImageResponse } from './concept-image'
import { canonicalJson, sha256Hex } from './integrity'
import { rasterDimensions } from './raster-dimensions'

export const conceptImageFileLimits = { bytes: 4_000_000, workspaceBytes: 20_000_000, totalBytes: 100_000_000, count: 50, dimension: 4096, pixels: 4_194_304 } as const
const id = z.string().min(1).max(120)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const originalMetadataSchema = z.object({
  schemaVersion: z.literal('qling-concept-image-file/1'), id, workspaceId: id, runId: id, runDigest: digest, themeId: id,
  createdAt: z.string().datetime(), response: conceptImageResponseSchema,
  identity: z.literal('unverified-concept-reference'), bytes: z.number().int().positive().max(conceptImageFileLimits.bytes),
  width: z.number().int().positive().max(conceptImageFileLimits.dimension), height: z.number().int().positive().max(conceptImageFileLimits.dimension),
  fileDigest: digest, recordDigest: digest,
}).strict()
const metadataSchema = z.union([originalMetadataSchema, originalMetadataSchema.extend({ schemaVersion: z.literal('qling-concept-image-file/2'),
  origin: z.object({ analysisRun: z.unknown(), image: originalMetadataSchema }).strict(),
}).strict()])
export type ConceptImageMetadata = z.infer<typeof metadataSchema>
export type ConceptImageFile = ConceptImageMetadata & { blob: Blob }

function metadataDigest(input: unknown) { return sha256Hex(canonicalJson(input)) }

export function validateConceptImageMetadata(value: unknown, run: AnalysisRun): ConceptImageMetadata {
  const metadata = metadataSchema.parse(value)
  const { recordDigest, ...content } = metadata
  if (recordDigest !== metadataDigest(content) || metadata.workspaceId !== run.workspaceId || metadata.runId !== run.id || metadata.runDigest !== run.archiveDigest) throw new Error('图片记录指纹或分析范围不匹配')
  if (metadata.width * metadata.height > conceptImageFileLimits.pixels) throw new Error('图片像素超过限制')
  let sourceRun = run
  if (metadata.schemaVersion === 'qling-concept-image-file/2') {
    sourceRun = validateAnalysisRun(metadata.origin.analysisRun)
    const source = validateConceptImageMetadata(metadata.origin.image, sourceRun)
    const runContent = (entry: AnalysisRun) => { const { id: _id, workspaceId: _workspace, archiveDigest: _digest, ...rest } = entry; return canonicalJson(rest) }
    if (runContent(run) !== runContent(sourceRun)) throw new Error('恢复图片的原分析内容不匹配')
    for (const key of ['themeId', 'createdAt', 'response', 'identity', 'bytes', 'width', 'height', 'fileDigest'] as const) {
      if (canonicalJson(metadata[key]) !== canonicalJson(source[key])) throw new Error('恢复图片不能改写原生成记录或字节')
    }
  }
  const input = createConceptImageRequest(sourceRun, metadata.themeId, metadata.response.binding.anchors, metadata.response.binding.hypothesis)
  validateConceptImageResponse(metadata.response, input)
  return metadata
}

function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

async function inspectBlob(blob: Blob, mediaType: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > conceptImageFileLimits.bytes || blob.type !== mediaType) throw new Error('图片类型或 4 MB 大小限制不满足')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  signal?.throwIfAborted()
  if (rasterType(bytes) !== mediaType) throw new Error('图片内容与类型不匹配')
  const dimensions = rasterDimensions(bytes, mediaType, conceptImageFileLimits)
  if (typeof createImageBitmap !== 'function') throw new Error('当前环境不能解码校验图片，未保存')
  const bitmap = await createImageBitmap(blob)
  try {
    signal?.throwIfAborted()
    if (!bitmap.width || !bitmap.height || bitmap.width > conceptImageFileLimits.dimension || bitmap.height > conceptImageFileLimits.dimension || bitmap.width * bitmap.height > conceptImageFileLimits.pixels) throw new Error('图片尺寸或像素超过限制')
    if (!(bitmap.width === dimensions.width && bitmap.height === dimensions.height) && !(mediaType === 'image/jpeg' && bitmap.width === dimensions.height && bitmap.height === dimensions.width)) throw new Error('图片解码尺寸与文件头不匹配')
    return { bytes: bytes.length, width: bitmap.width, height: bitmap.height, fileDigest: sha256Hex(bytes) }
  } finally { bitmap.close() }
}

export async function createConceptImageFile(run: AnalysisRun, themeId: string, response: unknown, blob: Blob, signal?: AbortSignal): Promise<ConceptImageFile> {
  const checked = conceptImageResponseSchema.parse(response)
  validateConceptImageResponse(checked, createConceptImageRequest(run, themeId, checked.binding.anchors, checked.binding.hypothesis))
  const image = await inspectBlob(blob, checked.mediaType, signal)
  const content = { schemaVersion: 'qling-concept-image-file/1' as const, id: crypto.randomUUID(), workspaceId: run.workspaceId, runId: run.id,
    runDigest: run.archiveDigest, themeId, createdAt: new Date().toISOString(), response: checked, identity: 'unverified-concept-reference' as const, ...image }
  return { ...validateConceptImageMetadata({ ...content, recordDigest: metadataDigest(content) }, run), blob }
}

export async function validateConceptImageFile(value: ConceptImageFile, run: AnalysisRun, signal?: AbortSignal): Promise<ConceptImageFile> {
  const { blob, ...input } = value
  const metadata = validateConceptImageMetadata(input, run)
  const inspected = await inspectBlob(blob, metadata.response.mediaType, signal)
  if (Object.entries(inspected).some(([key, field]) => metadata[key as keyof typeof inspected] !== field)) throw new Error('图片内容指纹或解码尺寸不匹配')
  return { ...metadata, blob }
}

export async function reassignConceptImageFile(file: ConceptImageFile, before: AnalysisRun, after: AnalysisRun): Promise<ConceptImageFile> {
  const checked = await validateConceptImageFile(file, before)
  const { blob, recordDigest: _digest, ...content } = checked
  const origin = checked.schemaVersion === 'qling-concept-image-file/2' ? checked.origin : { analysisRun: validateAnalysisRun(before), image: originalMetadataSchema.parse(contentWithDigest(checked)) }
  const changed = { ...content, schemaVersion: 'qling-concept-image-file/2' as const, id: crypto.randomUUID(), workspaceId: after.workspaceId, runId: after.id, runDigest: after.archiveDigest, origin }
  return validateConceptImageFile({ ...changed, recordDigest: metadataDigest(changed), blob }, after)
}

function contentWithDigest(file: ConceptImageFile) { const { blob: _blob, ...metadata } = file; return metadata }

export async function fetchConceptImageFile(fetcher: typeof fetch, url: string, run: AnalysisRun, themeId: string, response: unknown, signal: AbortSignal): Promise<ConceptImageFile> {
  signal.throwIfAborted()
  const checked = conceptImageResponseSchema.parse(response)
  validateConceptImageResponse(checked, createConceptImageRequest(run, themeId, checked.binding.anchors, checked.binding.hypothesis))
  const downloaded = await fetcher(url, { signal, redirect: 'error', headers: { Accept: checked.mediaType } })
  signal.throwIfAborted()
  if (!downloaded.ok || downloaded.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== checked.mediaType || Number(downloaded.headers.get('content-length')) > conceptImageFileLimits.bytes) {
    void downloaded.body?.cancel().catch(() => {})
    throw new Error('图片下载失败、类型不匹配或超过大小限制')
  }
  if (!downloaded.body) throw new Error('图片下载为空')
  const reader = downloaded.body.getReader()
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > conceptImageFileLimits.bytes) throw new Error('图片超过 4 MB，未截断或保存')
      chunks.push(new Uint8Array(value))
    }
    return await createConceptImageFile(run, themeId, checked, new Blob(chunks, { type: checked.mediaType }), signal)
  } catch (error) {
    cancel()
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

export async function conceptImageFileBackup(file: ConceptImageFile, run: AnalysisRun): Promise<string> {
  const checkedRun = validateAnalysisRun(run)
  const checked = await validateConceptImageFile(file, checkedRun)
  const { blob, ...metadata } = checked
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  const text = JSON.stringify({ schemaVersion: 'qling-concept-image-backup/1', analysisRun: checkedRun, image: metadata, data: btoa(binary) })
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('图片与完整分析备份超过 20 MB，未截断或导出')
  return text
}

export async function readConceptImageFileBackup(text: string): Promise<{ run: AnalysisRun; file: ConceptImageFile }> {
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('图片备份超过 20 MB')
  const envelope = z.object({ schemaVersion: z.literal('qling-concept-image-backup/1'), analysisRun: z.unknown(), image: z.unknown(), data: z.string().min(4).max(5_333_336).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().parse(JSON.parse(text))
  const run = validateAnalysisRun(envelope.analysisRun)
  const metadata = validateConceptImageMetadata(envelope.image, run)
  const binary = atob(envelope.data)
  if (btoa(binary) !== envelope.data || binary.length !== metadata.bytes) throw new Error('图片备份编码或大小不匹配')
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const file = await validateConceptImageFile({ ...metadata, blob: new Blob([bytes], { type: metadata.response.mediaType }) }, run)
  return { run, file }
}
