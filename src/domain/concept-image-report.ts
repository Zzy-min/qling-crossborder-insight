import { z } from 'zod'
import { validateAnalysisRun, type AnalysisRun } from './analysis-run'
import { validateConceptImageFile, validateConceptImageMetadata, conceptImageFileLimits, type ConceptImageFile, type ConceptImageMetadata } from './concept-image-file'
import { safeRasterDataUrl } from './export-safety'
import { canonicalJson, sha256Hex } from './integrity'

export interface ConceptImageReport {
  schemaVersion: 'qling-concept-image-report/1'
  runId: string
  runDigest: string
  images: Array<{ metadata: ConceptImageMetadata; dataUrl: string }>
  digest: string
}
export const imageReportByteLimit = 20 * 1024 * 1024
const schema = z.object({ schemaVersion: z.literal('qling-concept-image-report/1'), runId: z.string().min(1).max(120), runDigest: z.string().regex(/^[a-f0-9]{64}$/),
  images: z.array(z.object({ metadata: z.unknown(), dataUrl: z.string().max(5_400_000) }).strict()).max(conceptImageFileLimits.count), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()

export function validateConceptImageReport(value: unknown, inputRun: AnalysisRun): ConceptImageReport {
  const run = validateAnalysisRun(inputRun)
  const checked = schema.parse(value)
  const { digest, ...content } = checked
  if (checked.runId !== run.id || checked.runDigest !== run.archiveDigest || digest !== sha256Hex(canonicalJson(content))) throw new Error('报告图片指纹或运行范围不匹配')
  if (new TextEncoder().encode(JSON.stringify(checked)).byteLength > imageReportByteLimit) throw new Error('图片报告超过 20 MiB，不截断或遗漏图片')
  const ids = new Set<string>()
  const images = checked.images.map(image => {
    const metadata = validateConceptImageMetadata(image.metadata, run)
    if (ids.has(metadata.id)) throw new Error('报告图片重复')
    ids.add(metadata.id)
    if (!safeRasterDataUrl(image.dataUrl) || !image.dataUrl.startsWith(`data:${metadata.response.mediaType};base64,`)) throw new Error('报告图片不是安全内嵌栅格')
    const encoded = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
    const binary = atob(encoded)
    if (btoa(binary) !== encoded || binary.length !== metadata.bytes || sha256Hex(Uint8Array.from(binary, character => character.charCodeAt(0))) !== metadata.fileDigest) throw new Error('报告图片字节不匹配')
    return { metadata, dataUrl: image.dataUrl }
  })
  return { ...checked, images }
}

export async function buildConceptImageReport(value: AnalysisRun, files: ConceptImageFile[], signal?: AbortSignal): Promise<ConceptImageReport> {
  const run = validateAnalysisRun(value)
  if (files.length > conceptImageFileLimits.count) throw new Error('报告图片超过张数上限')
  const images: ConceptImageReport['images'] = []
  for (const file of files) {
    signal?.throwIfAborted()
    const checked = await validateConceptImageFile(file, run, signal)
    const { blob, ...metadata } = checked
    const bytes = new Uint8Array(await blob.arrayBuffer())
    signal?.throwIfAborted()
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    images.push({ metadata, dataUrl: `data:${metadata.response.mediaType};base64,${btoa(binary)}` })
    if (new TextEncoder().encode(JSON.stringify(images)).byteLength > imageReportByteLimit) throw new Error('图片报告超过 20 MiB，不截断或遗漏图片')
  }
  const content = { schemaVersion: 'qling-concept-image-report/1' as const, runId: run.id, runDigest: run.archiveDigest, images }
  signal?.throwIfAborted()
  return validateConceptImageReport({ ...content, digest: sha256Hex(canonicalJson(content)) }, run)
}

export async function loadConceptImageReport(run: AnalysisRun, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { workspaceDatabase } = await import('./workspace')
  const files = await workspaceDatabase.listConceptImages(run.workspaceId)
  signal?.throwIfAborted()
  return buildConceptImageReport(run, files.filter(file => file.runId === run.id), signal)
}
