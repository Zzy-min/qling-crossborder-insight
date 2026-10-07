import { z } from 'zod'
import type { AnalysisRun } from './analysis-run'
import type { QuoteAnchor, ReviewSentiment, ReviewTheme, ThemeSampleStats } from './types'
import { quoteAnchorSchema } from './evidence-contract.mjs'
import { canonicalJson, sha256Hex } from './integrity'
import { sampleStatistics } from './sample-statistics'
import { completedBatchDataset } from './analysis-batch'

const sentiment = z.enum(['positive', 'negative', 'neutral', 'mixed'])
const id = z.string().min(1).max(120)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const schema = z.object({
  schemaVersion: z.literal('qling-human-review/1'), id, workspaceId: id, runId: id, runDigest: digest,
  revision: z.number().int().positive(), themeId: id, anchor: quoteAnchorSchema,
  originalSentiment: sentiment, decision: z.enum(['accepted', 'rejected']), acceptedSentiment: sentiment.nullable(),
  reason: z.string().trim().min(1).max(2000), createdAt: z.string().datetime(), recordDigest: digest,
}).strict()

export type HumanReview = z.infer<typeof schema>
export interface ReviewSummary {
  schemaVersion: 'qling-human-review-summary/1'
  runId: string
  records: HumanReview[]
  digest: string
  accepted: number
  rejected: number
  pending: number
  statistics: Array<{ aspectId: string; sample: Omit<ThemeSampleStats, 'basis'> & { basis: 'human-reviewed' } }>
}

export function reviewTargetKey(themeId: string, anchor: QuoteAnchor): string {
  return canonicalJson({ themeId, anchor })
}

export function reviewTargets(run: AnalysisRun) {
  return run.report.themes.flatMap((theme) => [...new Map(theme.evidence.filter((item) => item.quoteAnchor).map((item) => [reviewTargetKey(theme.id, item.quoteAnchor!), { theme, anchor: item.quoteAnchor!, excerpt: item.excerpt }])).values()])
}

export function validateHumanReview(value: unknown, run: AnalysisRun): HumanReview {
  const record = schema.parse(value)
  const { recordDigest, ...content } = record
  if (sha256Hex(canonicalJson(content)) !== recordDigest) throw new Error('复核内容指纹不匹配')
  if (record.workspaceId !== run.workspaceId || record.runId !== run.id || record.runDigest !== run.archiveDigest) throw new Error('复核不属于当前分析快照')
  const theme = run.report.themes.find((finding) => finding.id === record.themeId)
  if (!theme || theme.sentiment !== record.originalSentiment || !theme.evidence.some((item) => item.quoteAnchor && canonicalJson(item.quoteAnchor) === canonicalJson(record.anchor))) throw new Error('复核锚点或原预测不匹配')
  if ((record.decision === 'accepted') !== (record.acceptedSentiment !== null)) throw new Error('复核决定与确认情绪不匹配')
  return record
}

export function createHumanReview(run: AnalysisRun, themeId: string, anchor: QuoteAnchor, decision: HumanReview['decision'], acceptedSentiment: ReviewSentiment | null, reason: string, revision: number): HumanReview {
  const theme = run.report.themes.find((finding) => finding.id === themeId)
  if (!theme) throw new Error('找不到原预测')
  const content = { schemaVersion: 'qling-human-review/1' as const, id: crypto.randomUUID(), workspaceId: run.workspaceId, runId: run.id,
    runDigest: run.archiveDigest, revision, themeId, anchor, originalSentiment: theme.sentiment, decision, acceptedSentiment,
    reason: reason.trim(), createdAt: new Date().toISOString() }
  return validateHumanReview({ ...content, recordDigest: sha256Hex(canonicalJson(content)) }, run)
}

export function validateReviewCollection(records: unknown[], runs: AnalysisRun[]): HumanReview[] {
  if (records.length > 10000) throw new Error('复核记录超过 10,000 条，请分开备份')
  const byRun = new Map(runs.map((run) => [run.id, run]))
  const checked = records.map((value) => {
    const record = schema.parse(value)
    const run = byRun.get(record.runId)
    if (!run) throw new Error('复核缺少对应的分析快照')
    return validateHumanReview(record, run)
  })
  if (new Set(checked.map((record) => record.id)).size !== checked.length || new Set(checked.map((record) => canonicalJson([record.runId, record.revision]))).size !== checked.length) throw new Error('复核记录 ID 或修订号重复')
  for (const run of runs) {
    const revisions = checked.filter((record) => record.runId === run.id).map((record) => record.revision).sort((left, right) => left - right)
    if (revisions.some((revision, index) => revision !== index + 1)) throw new Error('复核修订链不完整')
  }
  return checked.sort((left, right) => left.revision - right.revision)
}

export function buildReviewSummary(run: AnalysisRun, records: HumanReview[]): ReviewSummary {
  const checked = validateReviewCollection(records, [run])
  const latest = new Map(checked.map((record) => [reviewTargetKey(record.themeId, record.anchor), record]))
  const accepted = [...latest.values()].filter((record) => record.decision === 'accepted')
  const themes: ReviewTheme[] = accepted.map((record) => {
    const theme = run.report.themes.find((finding) => finding.id === record.themeId)!
    return { ...theme, sentiment: record.acceptedSentiment!, evidence: theme.evidence.filter((item) => item.quoteAnchor && canonicalJson(item.quoteAnchor) === canonicalJson(record.anchor)) }
  })
  const dataset = run.report.batchRun && run.outcome === 'online' ? completedBatchDataset(run.input.dataset, run.report.batchRun) : run.input.dataset
  const statistics = [...new Map(themes.flatMap((theme) => sampleStatistics(theme, themes, dataset).map((sample) => [canonicalJson([theme.aspectId ?? theme.id, sample.productId, sample.market]), { aspectId: theme.aspectId ?? theme.id, sample: { ...sample, basis: 'human-reviewed' as const } }] as const))).values()]
  const content = { schemaVersion: 'qling-human-review-summary/1' as const, runId: run.id, records: checked, accepted: accepted.length,
    rejected: latest.size - accepted.length, pending: reviewTargets(run).length - latest.size, statistics }
  return { ...content, digest: sha256Hex(canonicalJson(content)) }
}

export function reassignHumanReview(record: HumanReview, previous: AnalysisRun, next: AnalysisRun): HumanReview {
  const { recordDigest: _digest, ...content } = validateHumanReview(record, previous)
  const changed = { ...content, id: crypto.randomUUID(), workspaceId: next.workspaceId, runId: next.id, runDigest: next.archiveDigest }
  return validateHumanReview({ ...changed, recordDigest: sha256Hex(canonicalJson(changed)) }, next)
}
