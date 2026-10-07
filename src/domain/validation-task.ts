import { z } from 'zod'
import type { AnalysisRun } from './analysis-run'
import { quoteAnchorSchema } from './evidence-contract.mjs'
import { canonicalJson, sha256Hex } from './integrity'
import { costItemSchema, compareCostScenarios } from './cost-scenario'

const identifier = z.string().min(1).max(120)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string().trim().min(1).max(5000)
export const taskStatusLabels = { pending: '待验证', running: '验证中', verified: '已验证', rejected: '已否定', deferred: '暂缓' }
export const taskMethodLabels = { interview: '用户访谈', prototype: '样机测试', supplier: '供应商核对', other: '其他人工验证' }
export const taskPlanSchema = z.object({ title: text.max(200), hypothesis: text, metric: text, method: z.enum(['interview', 'prototype', 'supplier', 'other']), methodDetail: text, expectedCost: costItemSchema }).strict()
export type ValidationPlan = z.infer<typeof taskPlanSchema>
const attachmentMeta = z.object({ id: identifier, name: z.string().min(1).max(300), type: z.enum(['text/plain', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf']), bytes: z.number().int().min(1).max(5_000_000), digest }).strict()
export const taskEventSchema = z.object({
  schemaVersion: z.literal('qling-validation-task/1'), id: identifier, taskId: identifier, revision: z.number().int().min(1),
  workspaceId: identifier, runId: identifier, runDigest: digest, createdAt: z.string().datetime(),
  themeId: identifier, aspectId: identifier, anchor: quoteAnchorSchema,
  target: z.object({ productId: identifier, market: z.enum(['US', 'EU', 'JP', 'UK']), currency: z.enum(['USD', 'EUR', 'JPY', 'GBP']) }).strict(),
  costDigests: z.array(digest).max(3), plan: taskPlanSchema,
  status: z.enum(['pending', 'running', 'verified', 'rejected', 'deferred']),
  decision: z.enum(['undecided', 'adopted', 'not-adopted']),
  reason: text, result: z.string().trim().max(10000), attachments: z.array(attachmentMeta).max(20),
  previousDigest: digest.nullable(), recordDigest: digest,
}).strict()
export type ValidationTask = z.infer<typeof taskEventSchema>
export const taskAttachmentSchema = attachmentMeta.extend({ schemaVersion: z.literal('qling-task-attachment/1'), workspaceId: identifier, taskId: identifier, data: z.string().min(4).max(6_666_668) }).strict()
export type TaskAttachment = z.infer<typeof taskAttachmentSchema>

function hashed(content: Omit<ValidationTask, 'recordDigest'>): ValidationTask { return { ...content, recordDigest: sha256Hex(canonicalJson(content)) } }

export function validateTask(value: unknown, run: AnalysisRun): ValidationTask {
  const task = taskEventSchema.parse(value)
  const { recordDigest, ...content } = task
  if (recordDigest !== sha256Hex(canonicalJson(content))) throw new Error('任务内容指纹不匹配')
  if (task.workspaceId !== run.workspaceId || task.runId !== run.id || task.runDigest !== run.archiveDigest) throw new Error('任务与分析快照不匹配')
  const theme = run.report.themes.find(candidate => candidate.id === task.themeId)
  const review = run.input.dataset.reviews.find(candidate => candidate.reviewId === task.anchor.reviewId)
  const product = run.input.dataset.products.find(candidate => candidate.productId === review?.productId)
  if (!theme || theme.aspectId !== task.aspectId || !theme.evidence.some(reference => reference.quoteAnchor && canonicalJson(reference.quoteAnchor) === canonicalJson(task.anchor)) || !product || canonicalJson(task.target) !== canonicalJson({ productId: product.productId, market: product.market, currency: product.currency })) throw new Error('任务原文/方面/商品范围不匹配')
  if (task.plan.expectedCost.currency !== product.currency) throw new Error('预计新增成本币种不匹配')
  const costs = run.input.costSet?.scenarios[0].target.productId === product.productId ? compareCostScenarios(run.input.costSet.scenarios).map(item => item.scenarioDigest) : []
  if (canonicalJson(costs) !== canonicalJson(task.costDigests)) throw new Error('任务成本快照不匹配')
  if (task.status === 'verified' && (!task.result || task.decision === 'undecided')) throw new Error('已验证必须记录结果及采用决定')
  if (task.status === 'rejected' && (!task.result || task.decision !== 'not-adopted')) throw new Error('已否定必须记录结果且不采用')
  if (['pending', 'running'].includes(task.status) && task.decision !== 'undecided') throw new Error('未验证不可标为采用')
  if (task.status === 'deferred' && task.decision === 'adopted') throw new Error('暂缓不可标为采用')
  if (new Set(task.attachments.map(item => item.id)).size !== task.attachments.length) throw new Error('任务附件重复')
  return task
}

export function createValidationTask(run: AnalysisRun, themeId: string, anchor: ValidationTask['anchor'], plan: ValidationPlan): ValidationTask {
  const theme = run.report.themes.find(candidate => candidate.id === themeId)
  const review = run.input.dataset.reviews.find(candidate => candidate.reviewId === anchor.reviewId)
  const product = run.input.dataset.products.find(candidate => candidate.productId === review?.productId)
  if (!theme?.aspectId || !product) throw new Error('需选择带方面和原文锚点的分析快照')
  const costs = run.input.costSet?.scenarios[0].target.productId === product.productId ? compareCostScenarios(run.input.costSet.scenarios).map(item => item.scenarioDigest) : []
  return validateTask(hashed({ schemaVersion: 'qling-validation-task/1', id: crypto.randomUUID(), taskId: crypto.randomUUID(), revision: 1, workspaceId: run.workspaceId, runId: run.id, runDigest: run.archiveDigest, createdAt: new Date().toISOString(), themeId, aspectId: theme.aspectId, anchor,
    target: { productId: product.productId, market: product.market, currency: product.currency }, costDigests: costs, plan: taskPlanSchema.parse(plan), status: 'pending', decision: 'undecided', reason: '创建待验证假设，不代表原文语义或改良效果已确认', result: '', attachments: [], previousDigest: null }), run)
}

const transitions: Record<ValidationTask['status'], ValidationTask['status'][]> = { pending: ['pending', 'running', 'deferred'], running: ['running', 'verified', 'rejected', 'deferred'], verified: ['verified'], rejected: ['rejected'], deferred: ['deferred', 'pending'] }
export function reviseValidationTask(previous: ValidationTask, run: AnalysisRun, change: Pick<ValidationTask, 'status' | 'decision' | 'reason' | 'result' | 'attachments'>): ValidationTask {
  validateTask(previous, run)
  const { recordDigest, ...content } = previous
  const next = validateTask(hashed({ ...content, ...change, id: crypto.randomUUID(), revision: previous.revision + 1, createdAt: new Date().toISOString(), previousDigest: recordDigest }), run)
  validateTaskCollection([previous, next], [run], true)
  return next
}

export function validateTaskCollection(values: unknown[], runs: AnalysisRun[], tailOnly = false): ValidationTask[] {
  if (values.length > 10000) throw new Error('任务修订超过 10,000 条上限')
  const byRun = new Map(runs.map(run => [run.id, run]))
  const tasks = values.map(value => { const task = taskEventSchema.parse(value); const run = byRun.get(task.runId); if (!run) throw new Error('任务缺少分析快照'); return validateTask(task, run) })
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('任务修订 ID 重复')
  for (const taskId of new Set(tasks.map(task => task.taskId))) {
    const chain = tasks.filter(task => task.taskId === taskId).sort((left, right) => left.revision - right.revision)
    if (!tailOnly && (chain[0].revision !== 1 || chain[0].previousDigest !== null || chain[0].status !== 'pending')) throw new Error('任务缺少待验证起始记录')
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1]
      const current = chain[index]
      if (current.revision !== previous.revision + 1 || current.previousDigest !== previous.recordDigest || current.createdAt < previous.createdAt || !transitions[previous.status].includes(current.status)) throw new Error('任务修订链或状态转换无效')
      if (canonicalJson([current.workspaceId, current.runId, current.runDigest, current.themeId, current.aspectId, current.anchor, current.target, current.costDigests, current.plan]) !== canonicalJson([previous.workspaceId, previous.runId, previous.runDigest, previous.themeId, previous.aspectId, previous.anchor, previous.target, previous.costDigests, previous.plan])) throw new Error('任务不能改写原假设或证据，需创建新任务')
      if (previous.attachments.some(meta => !current.attachments.some(item => canonicalJson(item) === canonicalJson(meta)))) throw new Error('任务不能丢弃原结果附件')
    }
  }
  return tasks.sort((left, right) => left.taskId.localeCompare(right.taskId) || left.revision - right.revision)
}

export function attachmentBytes(value: TaskAttachment): Uint8Array {
  if (value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new Error('附件编码无效')
  const binary = atob(value.data)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
export function validateTaskAttachment(value: unknown): TaskAttachment {
  const attachment = taskAttachmentSchema.parse(value)
  const bytes = attachmentBytes(attachment)
  const extensions = { 'text/plain': /\.(txt|md|log)$/i, 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i, 'application/pdf': /\.pdf$/i }
  if (!extensions[attachment.type].test(attachment.name)) throw new Error('附件扩展名与允许的类型不匹配')
  if (bytes.length !== attachment.bytes || sha256Hex(bytes) !== attachment.digest) throw new Error('附件字节或指纹不匹配')
  const start = Array.from(bytes.slice(0, 12))
  const signatures = { 'image/png': start.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10', 'image/jpeg': start[0] === 255 && start[1] === 216 && start[2] === 255, 'image/webp': String.fromCharCode(...start.slice(0, 4)) === 'RIFF' && String.fromCharCode(...start.slice(8, 12)) === 'WEBP', 'application/pdf': String.fromCharCode(...start.slice(0, 5)) === '%PDF-', 'text/plain': true }
  if (!signatures[attachment.type]) throw new Error('附件类型与文件签名不匹配')
  return attachment
}
export async function createTaskAttachment(file: File, task: ValidationTask): Promise<TaskAttachment> {
  if (file.size < 1 || file.size > 5_000_000) throw new Error('结果附件须为 1 字节至 5 MB，不截断')
  const extension = file.name.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = { txt: 'text/plain', md: 'text/plain', log: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' }
  const type = !file.type || file.type === 'text/markdown' ? types[extension ?? ''] : file.type
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return validateTaskAttachment({ schemaVersion: 'qling-task-attachment/1', id: crypto.randomUUID(), workspaceId: task.workspaceId, taskId: task.taskId, name: file.name, type, bytes: bytes.length, digest: sha256Hex(bytes), data: btoa(binary) })
}
export function attachmentMetadata(attachment: TaskAttachment): ValidationTask['attachments'][number] {
  const { schemaVersion: _schema, workspaceId: _workspace, taskId: _task, data: _data, ...meta } = attachment
  return meta
}
export function validateTaskBundle(tasks: ValidationTask[], attachments: unknown[], runs: AnalysisRun[]) {
  const records = validateTaskCollection(tasks, runs)
  const files = attachments.map(validateTaskAttachment)
  if (new Set(files.map(file => file.id)).size !== files.length || files.reduce((sum, file) => sum + file.bytes, 0) > 10_000_000) throw new Error('结果附件重复或超过工作区 10 MB 上限')
  for (const task of records) for (const meta of task.attachments) {
    const file = files.find(candidate => candidate.id === meta.id)
    if (!file || file.workspaceId !== task.workspaceId || file.taskId !== task.taskId || canonicalJson(attachmentMetadata(file)) !== canonicalJson(meta)) throw new Error('任务结果附件缺失或跨范围')
  }
  if (files.some(file => !records.some(task => task.taskId === file.taskId && task.workspaceId === file.workspaceId && task.attachments.some(meta => meta.id === file.id)))) throw new Error('结果附件没有任务关联')
  return { tasks: records, attachments: files }
}
export function reassignTaskCollection(tasks: ValidationTask[], pairs: Map<string, { before: AnalysisRun; after: AnalysisRun }>, attachments: TaskAttachment[]) {
  const taskIds = new Map(tasks.map(task => [task.taskId, crypto.randomUUID()]))
  const fileIds = new Map(attachments.map(file => [file.id, crypto.randomUUID()]))
  const restored: ValidationTask[] = []
  for (const task of [...tasks].sort((left, right) => left.revision - right.revision)) {
    const run = pairs.get(task.runId)!.after
    const previous = restored.find(record => record.taskId === taskIds.get(task.taskId) && record.revision === task.revision - 1)
    const { recordDigest: _digest, ...content } = task
    restored.push(hashed({ ...content, id: crypto.randomUUID(), taskId: taskIds.get(task.taskId)!, workspaceId: run.workspaceId, runId: run.id, runDigest: run.archiveDigest, previousDigest: previous?.recordDigest ?? null, attachments: task.attachments.map(meta => ({ ...meta, id: fileIds.get(meta.id)! })) }))
  }
  const files = attachments.map(file => ({ ...file, id: fileIds.get(file.id)!, taskId: taskIds.get(file.taskId)!, workspaceId: pairs.get(tasks.find(task => task.taskId === file.taskId)!.runId)!.after.workspaceId }))
  return validateTaskBundle(restored, files, [...pairs.values()].map(pair => pair.after))
}

export function buildValidationTaskSummary(run: AnalysisRun, records: ValidationTask[]) {
  const tasks = validateTaskCollection(records, [run])
  const latest = [...new Map([...tasks].sort((left, right) => left.revision - right.revision).map(task => [task.taskId, task])).values()]
  const content = { schemaVersion: 'qling-validation-summary/1', runId: run.id, runDigest: run.archiveDigest, records: tasks, latest,
    notice: '验证状态与采用决定为用户本机记录，未经独立核验；原评论、分析预测和成本假设不因此变为已验证事实。结果附件只列元数据，完整文件在工作区备份中。' }
  return { ...content, digest: sha256Hex(canonicalJson(content)) }
}
export type ValidationSummary = ReturnType<typeof buildValidationTaskSummary>
