import { z } from 'zod'
import { validateAnalysisRun, type AnalysisRun } from './analysis-run'
import { canonicalJson, sha256Hex } from './integrity'

const id = z.string().trim().min(1).max(120)
const text = z.string().trim().min(1).max(2000)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const sourceSchema = z.object({
  title: text, authority: text.nullable(), url: z.string().max(2048).nullable(),
  identity: z.enum(['user-provided', 'unknown']), checkedAt: z.string().date().nullable(),
}).strict()
const assessmentSchema = z.object({
  topic: text, applicability: z.enum(['unknown', 'applicable', 'not-applicable']),
  conditions: text.nullable(), productFacts: text.nullable(),
  source: sourceSchema, status: z.enum(['pending', 'confirmed', 'rejected']),
  reason: text, reviewer: z.string().trim().min(1).max(120),
}).strict()
const recordSchema = assessmentSchema.extend({
  schemaVersion: z.literal('qling-compliance-review/1'), id, workspaceId: id,
  runId: id, runDigest: digest, productId: id, market: z.enum(['US', 'EU', 'JP', 'UK']),
  itemId: id, revision: z.number().int().positive(), createdAt: z.string().datetime(), recordDigest: digest,
}).strict()

export type ComplianceAssessment = z.infer<typeof assessmentSchema>
export type ComplianceReview = z.infer<typeof recordSchema>
export type ComplianceSummary = ReturnType<typeof buildComplianceSummary>

export function reassignComplianceReview(record: ComplianceReview, previous: AnalysisRun, next: AnalysisRun): ComplianceReview {
  const { recordDigest: _digest, ...content } = validateComplianceReview(record, previous)
  const checkedNext = validateAnalysisRun(next)
  if (canonicalJson(previous.input) !== canonicalJson(checkedNext.input) || canonicalJson(previous.report) !== canonicalJson(checkedNext.report)) throw new Error('合规恢复不能改换原分析输入或结论')
  const changed = { ...content, id: crypto.randomUUID(), workspaceId: next.workspaceId, runId: next.id, runDigest: next.archiveDigest }
  return validateComplianceReview({ ...changed, recordDigest: sha256Hex(canonicalJson(changed)) }, next)
}

export function validateComplianceSummary(value: ComplianceSummary, run: AnalysisRun): ComplianceSummary {
  const checked = buildComplianceSummary(run, value.records)
  if (canonicalJson(checked) !== canonicalJson(value)) throw new Error('合规汇总与原修订记录不匹配')
  return checked
}

function validateSourceUrl(value: string | null) {
  if (value === null) return
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|0\.|\[)/i.test(url.hostname)) {
    throw new Error('合规来源仅接受无凭证的 HTTPS 网页链接')
  }
}

export function validateComplianceReview(value: unknown, inputRun: AnalysisRun): ComplianceReview {
  const run = validateAnalysisRun(inputRun)
  return validateRecord(value, run)
}

function validateRecord(value: unknown, run: AnalysisRun): ComplianceReview {
  const record = recordSchema.parse(value)
  const { recordDigest, ...content } = record
  if (recordDigest !== sha256Hex(canonicalJson(content))) throw new Error('合规复核指纹不匹配')
  if (record.workspaceId !== run.workspaceId || record.runId !== run.id || record.runDigest !== run.archiveDigest) throw new Error('合规复核不属于当前分析快照')
  const product = run.input.dataset.products.find((item) => item.productId === record.productId)
  if (!product || product.market !== record.market) throw new Error('合规复核商品或市场不匹配')
  validateSourceUrl(record.source.url)
  if (record.source.checkedAt && record.source.checkedAt > record.createdAt.slice(0, 10)) throw new Error('来源核验日期不能晚于复核记录日期')
  if (record.source.identity === 'unknown' && record.source.checkedAt !== null) throw new Error('未知来源不能标记已核验日期')
  if (record.status === 'confirmed' && (record.applicability === 'unknown' || !record.conditions || !record.productFacts || !record.source.url || !record.source.checkedAt || record.source.identity !== 'user-provided')) {
    throw new Error('人工确认需要适用条件、商品事实、来源与核验日期')
  }
  return record
}

export function createComplianceReview(run: AnalysisRun, productId: string, itemId: string, assessment: ComplianceAssessment, revision: number): ComplianceReview {
  const product = run.input.dataset.products.find((item) => item.productId === productId)
  if (!product) throw new Error('合规复核缺少对应商品')
  const content = { ...assessmentSchema.parse(assessment), schemaVersion: 'qling-compliance-review/1' as const,
    id: crypto.randomUUID(), workspaceId: run.workspaceId, runId: run.id, runDigest: run.archiveDigest,
    productId, market: product.market, itemId, revision, createdAt: new Date().toISOString() }
  return validateComplianceReview({ ...content, recordDigest: sha256Hex(canonicalJson(content)) }, run)
}

export function validateComplianceCollection(values: unknown[], runs: AnalysisRun[]): ComplianceReview[] {
  if (values.length > 10000) throw new Error('合规复核记录超过 10,000 条')
  const checkedRuns = runs.map(validateAnalysisRun)
  const byRun = new Map(checkedRuns.map((run) => [run.id, run]))
  if (byRun.size !== runs.length) throw new Error('合规复核分析运行 ID 重复')
  const records = values.map((value) => {
    const parsed = recordSchema.parse(value)
    const run = byRun.get(parsed.runId)
    if (!run) throw new Error('合规复核缺少原分析存档')
    return validateRecord(parsed, run)
  })
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('合规复核记录 ID 重复')
  for (const run of checkedRuns) {
    const history = records.filter((record) => record.runId === run.id).sort((left, right) => left.revision - right.revision)
    if (history.some((record, index) => record.revision !== index + 1)) throw new Error('合规复核修订链不完整或重复')
    const targets = new Map<string, ComplianceReview>()
    for (const record of history) {
      const preceding = history[record.revision - 2]
      if (preceding && Date.parse(record.createdAt) < Date.parse(preceding.createdAt)) throw new Error('合规复核修订时间倒退')
      const previous = targets.get(record.itemId)
      if (previous && (previous.productId !== record.productId || previous.market !== record.market || previous.topic !== record.topic)) throw new Error('同一合规事项不能改换商品、市场或主题')
      targets.set(record.itemId, record)
    }
  }
  return records.sort((left, right) => left.revision - right.revision)
}

export function buildComplianceSummary(run: AnalysisRun, values: unknown[]) {
  const records = validateComplianceCollection(values, [run])
  const latest = [...new Map(records.map((record) => [record.itemId, record])).values()]
  const content = { schemaVersion: 'qling-compliance-summary/1' as const, runId: run.id, runDigest: run.archiveDigest,
    records, latest, pending: latest.filter((record) => record.status === 'pending').length,
    confirmed: latest.filter((record) => record.status === 'confirmed').length,
    rejected: latest.filter((record) => record.status === 'rejected').length,
    limitation: '人工复核记录不代表官方认证、法律意见或准入通过；链接与指纹不证明来源真实性。' }
  return { ...content, digest: sha256Hex(canonicalJson(content)) }
}

export function complianceReviewBackup(inputRun: AnalysisRun, values: unknown[]): string {
  const run = validateAnalysisRun(inputRun)
  const summary = buildComplianceSummary(run, values)
  const content = { schemaVersion: 'qling-compliance-backup/1' as const, run, records: summary.records }
  const text = JSON.stringify({ ...content, digest: sha256Hex(canonicalJson(content)) }, null, 2)
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('合规备份超过 20 MiB，未截断')
  return text
}

export function readComplianceReviewBackup(text: string) {
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('合规备份超过 20 MiB')
  const parsed = z.object({ schemaVersion: z.literal('qling-compliance-backup/1'), run: z.unknown(), records: z.array(z.unknown()).max(10000), digest }).strict().parse(JSON.parse(text))
  const { digest: checksum, ...content } = parsed
  if (sha256Hex(canonicalJson(content)) !== checksum) throw new Error('合规备份指纹不匹配')
  const run = validateAnalysisRun(parsed.run)
  return { run, records: validateComplianceCollection(parsed.records, [run]) }
}
