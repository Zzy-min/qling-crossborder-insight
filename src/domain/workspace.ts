import Dexie, { type Table } from 'dexie'
import { z } from 'zod'
import { productImportSchema, reviewImportSchema, importLimits } from './dataset-import'
import type { FieldMapping } from './dataset-import'
import type { DatasetBundle } from './types'
import type { PricingAssumptions } from './market'
import { initialProductPricing, productScenarioKey } from './product-pricing'
import { validateAnalysisRun, reassignRun } from './analysis-run'
import type { AnalysisRun } from './analysis-run'
import { validateHumanReview, validateReviewCollection, reassignHumanReview } from './human-review'
import type { HumanReview } from './human-review'
import { validateComplianceReview, validateComplianceCollection, reassignComplianceReview, type ComplianceReview } from './compliance-review'
import { validateTask, validateTaskBundle, reassignTaskCollection, type ValidationTask, type TaskAttachment } from './validation-task'
import { costSetSchema, validateCostSet, type CostSet } from './cost-scenario'
import { validateMappingTemplate, mappingTemplateLimits, type MappingTemplate } from './mapping-template'
import type { ConceptImageFile } from './concept-image-file'

export interface LegacyWorkspaceSnapshot {
  version: 1
  id: string
  name: string
  updatedAt: string
  dataset: DatasetBundle
  deduplicatedCount: number
  productMapping: FieldMapping
  reviewMapping: FieldMapping
  marketScope: 'US' | 'EU' | 'JP' | 'UK' | 'ALL' | 'BOTH'
  pricing: PricingAssumptions
  scenarios: Record<string, PricingAssumptions>
}

export interface WorkspaceSnapshot extends Omit<LegacyWorkspaceSnapshot, 'version'> {
  version: 2
  pricingProductId: string
  productScenarios: Record<string, PricingAssumptions>
  legacyDraft?: { pricing: PricingAssumptions; scenarios: Record<string, PricingAssumptions> }
  costSets?: Record<string, CostSet>
}

const amount = z.number().finite().nonnegative()
const assumptions = z.object({ currency: z.enum(['USD', 'EUR', 'JPY', 'GBP']), price: amount,
  landedCost: amount.nullable(), platformRate: amount.max(1).nullable(), adRate: amount.max(1).nullable(), fixedLaunchCost: amount.nullable() }).strict()
const legacySchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(120), name: z.string().min(1).max(300), updatedAt: z.string().datetime(),
  dataset: z.object({ products: z.array(productImportSchema).min(1).max(importLimits.products),
    reviews: z.array(reviewImportSchema).min(1).max(importLimits.reviews), policies: z.array(z.never()).max(0),
    provenance: z.object({ products: z.literal('user-provided'), reviews: z.literal('user-provided'), policies: z.literal('unknown') }).strict() }).strict(),
  deduplicatedCount: z.number().int().nonnegative(), productMapping: z.record(z.string()), reviewMapping: z.record(z.string()),
  marketScope: z.enum(['US', 'EU', 'JP', 'UK', 'ALL', 'BOTH']), pricing: assumptions, scenarios: z.record(assumptions),
}).strict()
const schema = legacySchema.extend({ version: z.literal(2), pricingProductId: z.string().min(1),
  productScenarios: z.record(assumptions), costSets: z.record(costSetSchema).optional(), legacyDraft: z.object({ pricing: assumptions, scenarios: z.record(assumptions) }).strict().optional() }).strict()

function validateDataset(snapshot: LegacyWorkspaceSnapshot | WorkspaceSnapshot) {
  const ids = new Set(snapshot.dataset.products.map((product) => product.productId))
  if (ids.size !== snapshot.dataset.products.length || new Set(snapshot.dataset.reviews.map((review) => review.reviewId)).size !== snapshot.dataset.reviews.length) throw new Error('备份包含重复 ID')
  if (snapshot.dataset.reviews.some((review) => !ids.has(review.productId))) throw new Error('备份包含无法关联的评论')
}

export function upgradeWorkspace(input: unknown): WorkspaceSnapshot {
  const legacy = legacySchema.parse(input)
  validateDataset(legacy)
  const product = legacy.dataset.products.find((candidate) => legacy.marketScope === 'ALL' || legacy.marketScope === 'BOTH' || candidate.market === legacy.marketScope)
  if (!product) throw new Error('旧工作区选定市场没有商品，保留旧数据并拒绝迁移')
  return { ...legacy, version: 2, pricingProductId: product.productId, pricing: initialProductPricing(product), productScenarios: {},
    legacyDraft: { pricing: legacy.pricing, scenarios: legacy.scenarios } }
}

export function validateWorkspace(input: unknown): WorkspaceSnapshot {
  const snapshot = schema.parse(input)
  validateDataset(snapshot)
  const product = snapshot.dataset.products.find((candidate) => candidate.productId === snapshot.pricingProductId)
  if (!product || product.currency !== snapshot.pricing.currency) throw new Error('定价商品不存在或币种不匹配')
  if (snapshot.marketScope !== 'ALL' && snapshot.marketScope !== 'BOTH' && product.market !== snapshot.marketScope) throw new Error('定价商品不在选定市场中')
  const productsByKey = new Map(snapshot.dataset.products.map((candidate) => [productScenarioKey(candidate), candidate]))
  for (const [key, scenario] of Object.entries(snapshot.productScenarios)) {
    const target = productsByKey.get(key)
    if (!target || scenario.currency !== target.currency) throw new Error('成本草稿关联商品或币种无效')
  }
  for (const [key, value] of Object.entries(snapshot.costSets ?? {})) {
    const target = productsByKey.get(key)
    const set = validateCostSet(value)
    if (!target || set.scenarios.some(scenario => productScenarioKey(scenario.target) !== key)) throw new Error('明细成本草稿关联商品或范围无效')
  }
  return snapshot
}

export function workspaceBackup(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(validateWorkspace(snapshot), null, 2)
}

export function readWorkspaceBackup(text: string): WorkspaceSnapshot {
  if (new TextEncoder().encode(text).length > importLimits.bytes) throw new Error('备份超过 20 MB')
  const input = JSON.parse(text)
  return input?.version === 1 ? upgradeWorkspace(input) : validateWorkspace(input)
}

export function workspaceArchiveBackup(snapshot: WorkspaceSnapshot, runs: AnalysisRun[], reviews: HumanReview[] = [], tasks: ValidationTask[] = [], attachments: TaskAttachment[] = []): string {
  const workspace = validateWorkspace(snapshot)
  const analysisRuns = runs.map(validateAnalysisRun)
  if (analysisRuns.length > 1000) throw new Error('完整备份最多包含 1,000 份分析存档，请分别导出')
  if (analysisRuns.some((run) => run.workspaceId !== workspace.id)) throw new Error('历史记录不属于当前工作区')
  const humanReviews = validateReviewCollection(reviews, analysisRuns)
  const taskBundle = validateTaskBundle(tasks, attachments, analysisRuns)
  const text = JSON.stringify({ schemaVersion: tasks.length ? 'qling-workspace-backup/5' : 'qling-workspace-backup/4', workspace, analysisRuns, humanReviews, ...(tasks.length ? { validationTasks: taskBundle.tasks, taskAttachments: taskBundle.attachments } : {}) }, null, 2)
  if (new TextEncoder().encode(text).length > importLimits.bytes) throw new Error('工作区与历史合计超过 20 MB，请分别导出分析存档')
  return text
}

export function readWorkspaceArchive(text: string): { workspace: WorkspaceSnapshot; analysisRuns: AnalysisRun[]; humanReviews: HumanReview[]; validationTasks: ValidationTask[]; taskAttachments: TaskAttachment[] } {
  if (new TextEncoder().encode(text).length > importLimits.bytes) throw new Error('备份超过 20 MB')
  const parsed = JSON.parse(text)
  if (!['qling-workspace-backup/3', 'qling-workspace-backup/4', 'qling-workspace-backup/5'].includes(parsed?.schemaVersion)) return { workspace: readWorkspaceBackup(text), analysisRuns: [], humanReviews: [], validationTasks: [], taskAttachments: [] }
  const legacyEnvelope = z.object({ schemaVersion: z.literal('qling-workspace-backup/3'), workspace: z.unknown(), analysisRuns: z.array(z.unknown()).max(1000) }).strict()
  const reviewedEnvelope = legacyEnvelope.extend({ schemaVersion: z.literal('qling-workspace-backup/4'), humanReviews: z.array(z.unknown()).max(10000) }).strict()
  const envelope = z.union([legacyEnvelope, reviewedEnvelope, reviewedEnvelope.extend({ schemaVersion: z.literal('qling-workspace-backup/5'), validationTasks: z.array(z.unknown()).max(10000), taskAttachments: z.array(z.unknown()).max(2000) }).strict()]).parse(parsed)
  const workspace = validateWorkspace(envelope.workspace)
  const analysisRuns = envelope.analysisRuns.map(validateAnalysisRun)
  if (analysisRuns.some((run) => run.workspaceId !== workspace.id) || new Set(analysisRuns.map((run) => run.id)).size !== analysisRuns.length) throw new Error('存档包含跨工作区或重复历史记录')
  const humanReviews = validateReviewCollection('humanReviews' in envelope ? envelope.humanReviews : [], analysisRuns)
  const bundle = validateTaskBundle('validationTasks' in envelope ? envelope.validationTasks as ValidationTask[] : [], 'taskAttachments' in envelope ? envelope.taskAttachments : [], analysisRuns)
  return { workspace, analysisRuns, humanReviews, validationTasks: bundle.tasks, taskAttachments: bundle.attachments }
}

export class WorkspaceDatabase extends Dexie {
  workspaces!: Table<WorkspaceSnapshot, string>
  settings!: Table<{ key: string; value: string }, string>
  analysisRuns!: Table<AnalysisRun, string>
  humanReviews!: Table<HumanReview, string>
  validationTasks!: Table<ValidationTask, string>
  taskAttachments!: Table<TaskAttachment, string>
  mappingTemplates!: Table<MappingTemplate, string>
  conceptImages!: Table<ConceptImageFile, string>
  complianceReviews!: Table<ComplianceReview, string>
  constructor(name = 'qling-seller-workspaces') {
    super(name)
    this.version(1).stores({ workspaces: 'id,updatedAt', settings: 'key' })
    this.version(2).stores({ workspaces: 'id,updatedAt', settings: 'key' }).upgrade(async (transaction) => {
      const table = transaction.table('workspaces')
      const rows = await table.toArray()
      for (const row of rows) await table.put(upgradeWorkspace(row))
    })
    this.version(3).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]' })
    this.version(4).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]' })
    this.version(5).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]', validationTasks: 'id,workspaceId,runId,taskId,&[taskId+revision]', taskAttachments: 'id,workspaceId,taskId' })
    this.version(6).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]', validationTasks: 'id,workspaceId,runId,taskId,&[taskId+revision]', taskAttachments: 'id,workspaceId,taskId', mappingTemplates: 'id,createdAt' })
    this.version(7).stores({ conceptImages: 'id,workspaceId,runId,[workspaceId+createdAt]' })
    this.version(8).stores({ complianceReviews: 'id,workspaceId,runId,itemId,&[runId+revision]' })
  }

  async saveConceptImage(input: ConceptImageFile, options: { signal?: AbortSignal; stillCurrent?: () => boolean } = {}): Promise<void> {
    const checkCurrent = () => {
      options.signal?.throwIfAborted()
      if (options.stillCurrent && !options.stillCurrent()) throw new Error('图片保存操作已失效')
    }
    checkCurrent()
    const { conceptImageFileLimits, validateConceptImageFile } = await import('./concept-image-file')
    checkCurrent()
    const run = await this.analysisRuns.get(input.runId)
    if (!run) throw new Error('图片需要已保存的分析快照')
    const record = await validateConceptImageFile(input, run, options.signal)
    checkCurrent()
    await this.transaction('rw', this.analysisRuns, this.conceptImages, async () => {
      checkCurrent()
      const current = await this.analysisRuns.get(record.runId)
      if (!current || current.archiveDigest !== record.runDigest) throw new Error('图片分析快照已失效')
      const existing = await this.conceptImages.toArray()
      if (existing.some(image => !(image.blob instanceof Blob) || image.blob.size !== image.bytes || image.bytes <= 0 || image.bytes > conceptImageFileLimits.bytes)) throw new Error('已存图片大小记录异常，未继续保存或删除')
      const scoped = existing.filter(image => image.workspaceId === record.workspaceId)
      if (scoped.length >= conceptImageFileLimits.count || scoped.reduce((sum, image) => sum + image.bytes, 0) + record.bytes > conceptImageFileLimits.workspaceBytes || existing.reduce((sum, image) => sum + image.bytes, 0) + record.bytes > conceptImageFileLimits.totalBytes) throw new Error('图片保存额度不足，未保存；请先备份，不会自动删除用户内容')
      await this.conceptImages.add(record)
      checkCurrent()
    })
  }

  async listConceptImages(workspaceId: string): Promise<ConceptImageFile[]> {
    const { images, runs } = await this.transaction('r', this.conceptImages, this.analysisRuns, async () => ({
      images: await this.conceptImages.where('workspaceId').equals(workspaceId).toArray(),
      runs: await this.analysisRuns.where('workspaceId').equals(workspaceId).toArray(),
    }))
    if (!images.length) return []
    const { validateConceptImageFile } = await import('./concept-image-file')
    const checked: ConceptImageFile[] = []
    for (const image of images.sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      const run = runs.find(candidate => candidate.id === image.runId)
      if (!run) throw new Error('已存图片缺失分析快照')
      checked.push(await validateConceptImageFile(image, run))
    }
    return checked
  }

  async saveMappingTemplate(input: MappingTemplate): Promise<void> {
    const template = validateMappingTemplate(input)
    await this.transaction('rw', this.mappingTemplates, async () => {
      if (await this.mappingTemplates.count() >= mappingTemplateLimits.count) throw new Error('最多保存 50 份映射模板，请先备份；不会覆盖或删除原模板')
      await this.mappingTemplates.add(template)
    })
  }

  async listMappingTemplates(): Promise<MappingTemplate[]> {
    return (await this.mappingTemplates.orderBy('createdAt').reverse().toArray()).map(validateMappingTemplate)
  }

  async save(input: WorkspaceSnapshot): Promise<void> {
    const snapshot = validateWorkspace(input)
    await this.transaction('rw', this.workspaces, this.settings, async () => {
      await this.workspaces.put(snapshot)
      await this.settings.put({ key: 'activeWorkspace', value: snapshot.id })
    })
  }

  async restore(): Promise<WorkspaceSnapshot | null> {
    return this.transaction('r', this.workspaces, this.settings, async () => {
      const active = await this.settings.get('activeWorkspace')
      const snapshot = active ? await this.workspaces.get(active.value) : undefined
      return snapshot ? validateWorkspace(snapshot) : null
    })
  }

  async useDemo(): Promise<void> {
    await this.settings.put({ key: 'activeWorkspace', value: '' })
  }

  async saveAnalysisRun(input: AnalysisRun): Promise<void> {
    await this.analysisRuns.add(validateAnalysisRun(input))
  }

  async listAnalysisRuns(workspaceId: string): Promise<AnalysisRun[]> {
    const rows = await this.analysisRuns.where('workspaceId').equals(workspaceId).toArray()
    return rows.map(validateAnalysisRun).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async saveHumanReview(input: HumanReview): Promise<void> {
    await this.transaction('rw', this.analysisRuns, this.humanReviews, async () => {
      const run = await this.analysisRuns.get(input.runId)
      if (!run) throw new Error('请先成功保存分析快照')
      const record = validateHumanReview(input, validateAnalysisRun(run))
      const existing = await this.humanReviews.where('runId').equals(run.id).toArray()
      if (record.revision !== Math.max(0, ...existing.map((entry) => entry.revision)) + 1) throw new Error('复核修订冲突，请刷新后重试')
      validateReviewCollection([...existing, record], [run])
      if (await this.humanReviews.where('workspaceId').equals(record.workspaceId).count() >= 10000) throw new Error('工作区复核达到 10,000 条上限，请备份并创建独立工作区')
      await this.humanReviews.add(record)
    })
  }

  async listHumanReviews(workspaceId: string, runs: AnalysisRun[]): Promise<HumanReview[]> {
    return validateReviewCollection(await this.humanReviews.where('workspaceId').equals(workspaceId).toArray(), runs)
  }

  async saveComplianceReview(input: ComplianceReview): Promise<void> {
    await this.transaction('rw', this.analysisRuns, this.complianceReviews, async () => {
      const run = await this.analysisRuns.get(input.runId)
      if (!run) throw new Error('请先成功保存分析快照')
      const record = validateComplianceReview(input, run)
      const existing = await this.complianceReviews.where('runId').equals(run.id).toArray()
      if (record.revision !== Math.max(0, ...existing.map(entry => entry.revision)) + 1) throw new Error('合规复核修订冲突，请刷新后核对')
      validateComplianceCollection([...existing, record], [run])
      if (await this.complianceReviews.where('workspaceId').equals(record.workspaceId).count() >= 10000) throw new Error('工作区合规复核达到 10,000 条上限')
      await this.complianceReviews.add(record)
    })
  }

  async listComplianceReviews(workspaceId: string, runs: AnalysisRun[]): Promise<ComplianceReview[]> {
    const records = await this.complianceReviews.where('workspaceId').equals(workspaceId).toArray()
    if (records.some(record => record.workspaceId !== workspaceId) || runs.some(run => run.workspaceId !== workspaceId)) throw new Error('合规复核读取作用域不匹配')
    return validateComplianceCollection(records, runs)
  }

  async saveValidationTask(input: ValidationTask, newFiles: TaskAttachment[] = []): Promise<void> {
    await this.transaction('rw', this.analysisRuns, this.validationTasks, this.taskAttachments, async () => {
      const run = await this.analysisRuns.get(input.runId)
      if (!run) throw new Error('任务需要已保存的分析快照')
      const record = validateTask(input, validateAnalysisRun(run))
      const existing = await this.validationTasks.where('taskId').equals(record.taskId).toArray()
      if (record.revision !== Math.max(0, ...existing.map(task => task.revision)) + 1) throw new Error('任务修订冲突，请刷新后检查')
      const files = await this.taskAttachments.where('taskId').equals(record.taskId).toArray()
      const bundle = validateTaskBundle([...existing, record], [...files, ...newFiles], [run])
      if (await this.validationTasks.where('workspaceId').equals(record.workspaceId).count() >= 10000) throw new Error('任务修订达到 10,000 条上限')
      const allFiles = await this.taskAttachments.where('workspaceId').equals(record.workspaceId).toArray()
      if ([...allFiles, ...newFiles].reduce((sum, file) => sum + file.bytes, 0) > 10_000_000) throw new Error('工作区结果附件达到 10 MB 上限，请先备份；不会删除原内容')
      await this.validationTasks.add(record)
      for (const file of bundle.attachments.filter(candidate => !files.some(saved => saved.id === candidate.id))) await this.taskAttachments.add(file)
    })
  }

  async listValidationTasks(workspaceId: string, runs: AnalysisRun[]) {
    return this.transaction('r', this.validationTasks, this.taskAttachments, async () => validateTaskBundle(await this.validationTasks.where('workspaceId').equals(workspaceId).toArray(), await this.taskAttachments.where('workspaceId').equals(workspaceId).toArray(), runs))
  }

  async restoreArchive(snapshot: WorkspaceSnapshot, runs: AnalysisRun[], stillCurrent = () => true, reviews: HumanReview[] = [], tasks: ValidationTask[] = [], attachments: TaskAttachment[] = [], images: ConceptImageFile[] = [], compliance: ComplianceReview[] = []): Promise<AnalysisRun[]> {
    const workspace = validateWorkspace(snapshot)
    const restored = runs.map((run) => reassignRun(run, workspace.id))
    const checkedReviews = validateReviewCollection(reviews, runs)
    const previous = new Map(runs.map((run, index) => [run.id, { before: run, after: restored[index] }]))
    const restoredCompliance = validateComplianceCollection(compliance, runs).map(record => { const pair = previous.get(record.runId)!; return reassignComplianceReview(record, pair.before, pair.after) })
    validateComplianceCollection(restoredCompliance, restored)
    const restoredReviews = checkedReviews.map((record) => { const pair = previous.get(record.runId)!; return reassignHumanReview(record, pair.before, pair.after) })
    const checkedTasks = validateTaskBundle(tasks, attachments, runs)
    const restoredTasks = reassignTaskCollection(checkedTasks.tasks, previous, checkedTasks.attachments)
    const restoredImages: ConceptImageFile[] = []
    if (images.length) {
      const { validateWorkspaceImages } = await import('./workspace-images')
      const { reassignConceptImageFile } = await import('./concept-image-file')
      for (const image of await validateWorkspaceImages(images, runs, images[0].workspaceId)) {
        const pair = previous.get(image.runId)
        if (!pair) throw new Error('图片恢复缺少原分析')
        restoredImages.push(await reassignConceptImageFile(image, pair.before, pair.after))
      }
    }
    await this.transaction('rw', [this.workspaces, this.settings, this.analysisRuns, this.humanReviews, this.validationTasks, this.taskAttachments, this.conceptImages, this.complianceReviews], async () => {
      if (!stillCurrent()) throw new Error('恢复操作已失效')
      if (restoredImages.length) {
        const existing = await this.conceptImages.toArray()
        if (existing.some(image => !(image.blob instanceof Blob) || image.blob.size !== image.bytes) || [...existing, ...restoredImages].reduce((sum, image) => sum + image.bytes, 0) > 100_000_000) throw new Error('图片全库额度不足或记录异常，工作区恢复未提交')
      }
      await this.workspaces.add(workspace)
      for (const run of restored) await this.analysisRuns.add(run)
      for (const record of restoredReviews) await this.humanReviews.add(record)
      for (const record of restoredTasks.tasks) await this.validationTasks.add(record)
      for (const file of restoredTasks.attachments) await this.taskAttachments.add(file)
      for (const image of restoredImages) await this.conceptImages.add(image)
      for (const record of restoredCompliance) await this.complianceReviews.add(record)
      if (!stillCurrent()) throw new Error('恢复操作已失效')
      await this.settings.put({ key: 'activeWorkspace', value: workspace.id })
    })
    return restored
  }
}

export const workspaceDatabase = new WorkspaceDatabase()
