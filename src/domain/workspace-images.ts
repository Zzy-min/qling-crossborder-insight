import { z } from 'zod'
import { workspaceArchiveBackup, readWorkspaceArchive, type WorkspaceSnapshot } from './workspace'
import type { AnalysisRun } from './analysis-run'
import type { HumanReview } from './human-review'
import { validateComplianceCollection, type ComplianceReview } from './compliance-review'
import type { ValidationTask, TaskAttachment } from './validation-task'
import { conceptImageFileBackup, readConceptImageFileBackup, validateConceptImageFile, conceptImageFileLimits, type ConceptImageFile } from './concept-image-file'

const limit = 20 * 1024 * 1024

export async function validateWorkspaceImages(files: ConceptImageFile[], runs: AnalysisRun[], workspaceId: string): Promise<ConceptImageFile[]> {
  if (files.length > conceptImageFileLimits.count || new Set(files.map(file => file.id)).size !== files.length || files.reduce((sum, file) => sum + file.bytes, 0) > conceptImageFileLimits.workspaceBytes) throw new Error('图片重复或超过工作区图片额度')
  const checked: ConceptImageFile[] = []
  for (const file of files) {
    const run = runs.find(entry => entry.id === file.runId && entry.workspaceId === workspaceId)
    if (!run || file.workspaceId !== workspaceId) throw new Error('图片缺少原分析或跨工作区')
    checked.push(await validateConceptImageFile(file, run))
  }
  return checked
}

export async function workspaceArchiveBackupWithImages(snapshot: WorkspaceSnapshot, runs: AnalysisRun[], reviews: HumanReview[] = [], tasks: ValidationTask[] = [], attachments: TaskAttachment[] = [], images: ConceptImageFile[] = [], compliance: ComplianceReview[] = []): Promise<string> {
  const base = workspaceArchiveBackup(snapshot, runs, reviews, tasks, attachments)
  const complianceReviews = validateComplianceCollection(compliance, runs)
  if (!images.length && !complianceReviews.length) return base
  const files = await validateWorkspaceImages(images, runs, snapshot.id)
  const serialized: string[] = []
  for (const file of files) serialized.push(await conceptImageFileBackup(file, runs.find(run => run.id === file.runId)!))
  const content = JSON.parse(base)
  const text = JSON.stringify({ ...content, schemaVersion: complianceReviews.length ? 'qling-workspace-backup/7' : 'qling-workspace-backup/6', validationTasks: content.validationTasks ?? [], taskAttachments: content.taskAttachments ?? [], conceptImages: serialized, ...(complianceReviews.length ? { complianceReviews } : {}) })
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('包含图片的完整备份超过 20 MB，请分别导出分析与单张图片；未截断或遗漏图片')
  return text
}

export async function readWorkspaceArchiveWithImages(text: string) {
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('备份超过 20 MB')
  const parsed = JSON.parse(text)
  if (!['qling-workspace-backup/6', 'qling-workspace-backup/7'].includes(parsed?.schemaVersion)) return { ...readWorkspaceArchive(text), conceptImages: [] as ConceptImageFile[], complianceReviews: [] as ComplianceReview[] }
  const envelope = z.object({ schemaVersion: z.literal('qling-workspace-backup/6'), workspace: z.unknown(), analysisRuns: z.array(z.unknown()).max(1000),
    humanReviews: z.array(z.unknown()).max(10000), validationTasks: z.array(z.unknown()).max(10000), taskAttachments: z.array(z.unknown()).max(2000),
    conceptImages: z.array(z.string().min(1).max(limit)).min(1).max(conceptImageFileLimits.count),
  }).strict()
  const newEnvelope = envelope.extend({ schemaVersion: z.literal('qling-workspace-backup/7'), conceptImages: z.array(z.string().min(1).max(limit)).max(conceptImageFileLimits.count), complianceReviews: z.array(z.unknown()).min(1).max(10000) }).strict()
  const checked = z.union([envelope, newEnvelope]).parse(parsed)
  const { conceptImages, ...base } = checked
  const { complianceReviews: _reviews, ...legacyBase } = { ...base, complianceReviews: 'complianceReviews' in checked ? checked.complianceReviews : [] }
  const archive = readWorkspaceArchive(JSON.stringify({ ...legacyBase, schemaVersion: 'qling-workspace-backup/5' }))
  const complianceReviews = validateComplianceCollection(_reviews, archive.analysisRuns)
  const images: ConceptImageFile[] = []
  for (const text of conceptImages) {
    const decoded = await readConceptImageFileBackup(text)
    const run = archive.analysisRuns.find(entry => entry.id === decoded.run.id)
    if (!run || run.archiveDigest !== decoded.run.archiveDigest) throw new Error('图片备份的原分析与工作区存档不匹配')
    images.push(decoded.file)
  }
  return { ...archive, conceptImages: await validateWorkspaceImages(images, archive.analysisRuns, archive.workspace.id), complianceReviews }
}
