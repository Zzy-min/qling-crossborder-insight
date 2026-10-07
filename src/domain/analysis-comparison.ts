import { validateAnalysisRun, type AnalysisRun } from './analysis-run'
import { completedBatchDataset } from './analysis-batch'
import { compareCostScenarios, costSetRows, costKindLabels } from './cost-scenario'
import { canonicalJson, sha256Hex } from './integrity'
import { escapeHtml } from './export-safety'
import type { ReviewSentiment } from './types'

function histogram(values: Array<string | number | boolean | null>) {
  const counts = new Map<string, number>()
  for (const value of values) { const key = value === null ? 'unknown' : String(value); counts.set(key, (counts.get(key) ?? 0) + 1) }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)))
}

function finiteDifference(before: number | null | undefined, after: number | null | undefined) {
  if (before == null || after == null) return null
  const difference = after - before
  return Number.isFinite(difference) ? difference : null
}

function describeRun(run: AnalysisRun, productId: string) {
  const product = run.input.dataset.products.find(row => row.productId === productId)
  const dataset = run.outcome === 'online' && run.report.batchRun ? completedBatchDataset(run.input.dataset, run.report.batchRun) : run.input.dataset
  const reviews = dataset.reviews.filter(row => row.productId === productId).sort((left, right) => left.reviewId.localeCompare(right.reviewId))
  const scope = { target: product ? { productId, market: product.market, currency: product.currency } : null, provenance: run.input.dataset.provenance, reviews }
  const configuration = { outcome: run.outcome, analysisVersion: run.report.analysisVersion ?? null, evidenceProtocol: run.report.evidenceProtocol ?? 1,
    batchVersions: [...new Set((run.report.batchRun?.batches ?? []).filter(batch => batch.status === 'completed' && batch.productId === productId).map(batch => canonicalJson({ model: batch.model ?? null, prompt: batch.promptVersion ?? null })))].sort() }
  const dates = reviews.map(review => review.reviewedAt).sort()
  const known = new Set(reviews.map(review => review.reviewId))
  const relevant = run.report.themes.filter(theme => theme.evidence.some(reference => reference.evidenceType === 'review' && known.has(reference.recordId)))
  const aspects = new Map<string, Map<string, Set<ReviewSentiment>>>()
  for (const theme of relevant) {
    if (!theme.aspectId) continue
    const findings = aspects.get(theme.aspectId) ?? new Map<string, Set<ReviewSentiment>>()
    for (const reference of theme.evidence) {
      if (reference.evidenceType !== 'review' || !known.has(reference.recordId)) continue
      const sentiments = findings.get(reference.recordId) ?? new Set<ReviewSentiment>()
      sentiments.add(theme.sentiment); findings.set(reference.recordId, sentiments)
    }
    aspects.set(theme.aspectId, findings)
  }
  const findings = [...aspects].sort(([left], [right]) => left.localeCompare(right)).map(([aspectId, mentions]) => {
    const labels = [...mentions.values()].map(values => values.size === 1 ? [...values][0] : 'mixed')
    const negative = labels.filter(label => label === 'negative').length
    return { aspectId, sampleCount: reviews.length, mentionCount: mentions.size, negativeCount: negative, mixedCount: labels.filter(label => label === 'mixed').length,
      positiveCount: labels.filter(label => label === 'positive').length, neutralCount: labels.filter(label => label === 'neutral').length,
      mentionRate: reviews.length ? mentions.size / reviews.length : null, negativeRate: mentions.size ? negative / mentions.size : null,
      reviewIds: [...mentions.keys()].sort(), anchors: relevant.filter(theme => theme.aspectId === aspectId).flatMap(theme => theme.evidence.filter(reference => reference.quoteAnchor && known.has(reference.recordId)).map(reference => ({ sentiment: theme.sentiment, anchor: reference.quoteAnchor! }))).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))) }
  })
  const costs = run.input.costSet && canonicalJson(run.input.costSet.scenarios[0].target) === canonicalJson(scope.target) ? compareCostScenarios(run.input.costSet.scenarios) : []
  return { runId: run.id, archiveDigest: run.archiveDigest, evidenceDigest: run.evidenceDigest, createdAt: run.createdAt, generatedAt: run.report.generatedAt,
    sourceLabel: run.input.sourceLabel, scope: { target: scope.target, provenance: scope.provenance, sampleDigest: sha256Hex(canonicalJson(scope)), sampleCount: reviews.length,
      originalSampleCount: run.input.dataset.reviews.filter(review => review.productId === productId).length, timeRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      structure: { ratings: histogram(reviews.map(review => review.rating)), locales: histogram(reviews.map(review => review.locale)), purchaseDeclarations: histogram(reviews.map(review => review.verifiedPurchase)), dates: histogram(dates) } },
    configuration, configurationDigest: sha256Hex(canonicalJson(configuration)), complete: run.outcome !== 'online' || !run.report.batchRun || run.report.batchRun.status === 'completed',
    anchored: (run.report.evidenceProtocol ?? 1) === 2 && relevant.every(theme => theme.aspectId && theme.evidenceLevel === 'quote-anchored/2'), findings, costs,
    costInputs: costs.length ? costSetRows(run.input.costSet!) : [] }
}

export function compareAnalysisRuns(beforeValue: AnalysisRun, afterValue: AnalysisRun, productId: string) {
  const beforeRun = validateAnalysisRun(beforeValue)
  const afterRun = validateAnalysisRun(afterValue)
  const before = describeRun(beforeRun, productId)
  const after = describeRun(afterRun, productId)
  const reasons: string[] = []
  if (beforeRun.id === afterRun.id) reasons.push('请选择两份不同的已保存运行')
  if (beforeRun.workspaceId !== afterRun.workspaceId) reasons.push('工作区不同，不自动关联商品身份')
  if (!before.scope.target || !after.scope.target || canonicalJson(before.scope.target) !== canonicalJson(after.scope.target)) reasons.push('商品、市场或币种不匹配')
  if (!before.scope.sampleCount || !after.scope.sampleCount) reasons.push('所选商品没有有效分析样本')
  if (!before.complete || !after.complete) reasons.push('存在未完成在线批次，不能直接比较完整范围')
  if (before.scope.sampleDigest !== after.scope.sampleDigest) reasons.push('评论范围、原文或样本结构变化，不能直接比较趋势；不会截取共同样本')
  if (before.configurationDigest !== after.configurationDigest) reasons.push('分析模式、规则、模型或提示词配置变化，输出差异不能归因为产品变化')
  if (!before.anchored || !after.anchored) reasons.push('旧版或非锚点分析不具备稳定方面证据，不补造新格式')
  const comparable = reasons.length === 0
  const aspectIds = [...new Set([...before.findings, ...after.findings].map(finding => finding.aspectId))].sort()
  const rows = aspectIds.map(aspectId => {
    const left = before.findings.find(finding => finding.aspectId === aspectId) ?? null
    const right = after.findings.find(finding => finding.aspectId === aspectId) ?? null
    const mentionRate = (finding: typeof left, count: number) => finding?.mentionRate ?? (count ? 0 : null)
    const leftRate = mentionRate(left, before.scope.sampleCount)
    const rightRate = mentionRate(right, after.scope.sampleCount)
    return { aspectId, before: left, after: right, delta: comparable ? {
      mentionCount: (right?.mentionCount ?? 0) - (left?.mentionCount ?? 0), mentionRatePoints: leftRate === null || rightRate === null ? null : (rightRate - leftRate) * 100,
      negativeRatePoints: left?.negativeRate == null || right?.negativeRate == null ? null : (right.negativeRate - left.negativeRate) * 100 } : null }
  })
  const costTargetMatches = beforeRun.workspaceId === afterRun.workspaceId && beforeRun.id !== afterRun.id && before.scope.target !== null && canonicalJson(before.scope.target) === canonicalJson(after.scope.target)
  const costRows = [...new Set([...before.costs, ...after.costs].map(cost => cost.scenario.kind))].map(kind => {
    const left = before.costs.find(cost => cost.scenario.kind === kind)
    const right = after.costs.find(cost => cost.scenario.kind === kind)
    const compatible = costTargetMatches && left && right && left.result.formulaVersion === right.result.formulaVersion
    const contributionDelta = compatible ? finiteDifference(left.result.contributionPerUnit, right.result.contributionPerUnit) : null
    const overflow = compatible && left.result.contributionPerUnit !== null && right.result.contributionPerUnit !== null && contributionDelta === null
    return { kind, before: left ?? null, after: right ?? null,
      contributionDelta, limitation: overflow ? '贡献差超出安全数值范围，未计算' : null,
      breakEvenDelta: compatible && left.result.breakEvenUnits !== null && right.result.breakEvenUnits !== null ? right.result.breakEvenUnits - left.result.breakEvenUnits : null }
  })
  const content = { schemaVersion: 'qling-analysis-comparison/1', workspaceId: beforeRun.workspaceId, productId, basis: 'unreviewed-predictions', comparable, reasons, before, after, rows, costRows,
    notice: '仅比较所选商品的已保存原预测，不采用当前草稿或后续人工决定。相同样本和配置只允许描述输出差异，不证明产品改良或统计显著性。无规则提及不代表无痛点；成本差异是条件测算，不是实际收益。购买状态是用户声明，不是平台验证。采集时间仅来自原字段，导入/运行时间不是数据更新时间。' }
  return { ...content, digest: sha256Hex(canonicalJson(content)) }
}
export type AnalysisComparison = ReturnType<typeof compareAnalysisRuns>

export function comparisonPercent(value: number | null | undefined) { return value == null ? '未计算' : `${(value * 100).toFixed(1)}%` }
export function comparisonDelta(value: number | null | undefined) { return value == null ? '不可直接比较' : `${value > 0 ? '+' : ''}${value.toFixed(2)}` }

export function comparisonHtml(value: AnalysisComparison) {
  const metric = (finding: AnalysisComparison['rows'][number]['before'], samples: number) => `${finding?.mentionCount ?? 0}/${samples} · 提及率 ${comparisonPercent(finding?.mentionRate ?? (samples ? 0 : null))} · 负向 ${comparisonPercent(finding?.negativeRate)} · 混合 ${finding?.mixedCount ?? 0}`
  const side = (label: string, data: AnalysisComparison['before']) => `<section><h2>${escapeHtml(label)}</h2>
    <p>${escapeHtml(data.sourceLabel)} · ${escapeHtml(data.scope.target?.market)} / ${escapeHtml(data.scope.target?.currency)} · ${data.scope.sampleCount}/${data.scope.originalSampleCount} 条分析/原始评论</p>
    <p>评论日期 ${escapeHtml(data.scope.timeRange?.from ?? '未知')} 至 ${escapeHtml(data.scope.timeRange?.to ?? '未知')}；运行 ${escapeHtml(data.generatedAt)}（不是数据更新时间）</p>
    <p>配置 ${escapeHtml(canonicalJson(data.configuration))}</p><p>样本结构 ${escapeHtml(canonicalJson(data.scope.structure))}</p>
    <p>样本指纹 ${data.scope.sampleDigest} · 存档 ${data.archiveDigest}</p><h3>完整历史成本假设及来源</h3>
    ${data.costInputs.map(row => `<p>${escapeHtml(row.label)}：${escapeHtml(row.value)}</p>`).join('') || '<p>未绑定所选商品的成本明细</p>'}</section>`
  const rows = value.rows.map(row => `<tr><td>${escapeHtml(row.aspectId)}</td><td>${escapeHtml(metric(row.before, value.before.scope.sampleCount))}</td><td>${escapeHtml(metric(row.after, value.after.scope.sampleCount))}</td><td>${comparisonDelta(row.delta?.mentionRatePoints)} / ${comparisonDelta(row.delta?.negativeRatePoints)}</td></tr>`).join('')
  const quotes = value.rows.map(row => `<h3>${escapeHtml(row.aspectId)} · 原文依据</h3>${([['A', row.before], ['B', row.after]] as const).map(([label, finding]) => `<p>${label}</p>${finding ? finding.anchors.map(reference => `<blockquote>${escapeHtml(reference.anchor.quote)} · ${escapeHtml(reference.anchor.reviewId)} / ${escapeHtml(reference.anchor.field)} [${reference.anchor.start},${reference.anchor.end}) · ${escapeHtml(reference.sentiment)}</blockquote>`).join('') : '<p>未识别该方面，不代表不存在</p>'}`).join('')}`).join('')
  const costs = value.costRows.map(row => `<p>${escapeHtml(costKindLabels[row.kind])} · A ${escapeHtml(row.before?.result.contributionPerUnit ?? '未计算')} · B ${escapeHtml(row.after?.result.contributionPerUnit ?? '未计算')} · 单件贡献差 ${comparisonDelta(row.contributionDelta)} · 保本销量差 ${comparisonDelta(row.breakEvenDelta)} ${escapeHtml(row.limitation)}</p>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'">
    <title>历史分析比较 · ${escapeHtml(value.productId)}</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;color:#17222c;font:15px/1.7 sans-serif;overflow-wrap:anywhere}section{padding:16px 0;border-bottom:1px solid #ccc}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;padding:10px;border:1px solid #ccc;vertical-align:top}h1{font-size:26px}h2{font-size:20px}.scroll{overflow:auto}@media print{body{margin:0;font-size:11px}tr{break-inside:avoid}}</style></head><body>
    <h1>历史分析比较 · ${escapeHtml(value.productId)}</h1><p>${value.comparable ? '相同样本/配置，可描述输出差异' : '不可直接比较趋势；仅并列查看'}</p><p>${escapeHtml(value.notice)}</p><ul>${value.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
    ${side('A：参照运行', value.before)}${side('B：对照运行', value.after)}<section><h2>方面预测对照</h2><div class="scroll"><table><thead><tr><th>方面</th><th>A</th><th>B</th><th>提及率差/负向差（百分点）</th></tr></thead><tbody>${rows}</tbody></table></div>${quotes || '<p>未识别可比较方面，不代表没有痛点。</p>'}</section>
    <section><h2>独立成本条件对照</h2><p>与评论趋势独立计算。未知不补零；缺明细、币种/商品或公式不匹配不输出差值。</p>${costs || '<p>两次运行未绑定所选商品成本明细</p>'}</section>
    <p>${value.schemaVersion} · 比较指纹 SHA-256 ${value.digest}，不是数字签名，不证明数据或结论真实。</p></body></html>`
}
