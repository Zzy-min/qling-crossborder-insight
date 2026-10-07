import type { InsightReport, ReviewTheme, ScoreContribution } from './types'
import { sampleStatisticsLabel } from './sample-statistics'
import { marketLabel, severityLabel } from './labels'
import { buildScenarioIntegrity, canonicalJson, sha256Hex, type EvidenceIntegrity, type ScenarioIntegrity } from './integrity'
import { escapeHtml, safeRasterDataUrl } from './export-safety'
import { evidenceBindingNote, provenanceSummary } from './provenance'
import { pricingScenarioMessage, pricingScenarioNote, pricingScenarioRows, type PricingScenario } from './market'
import type { ReviewSummary } from './human-review'
import { batchRunLabel } from './analysis-batch'
import { costSetRows, costKindLabels, costLabels, type CostSet } from './cost-scenario'
import { buildCostSensitivity } from './cost-sensitivity'
import { taskStatusLabels, taskMethodLabels, type ValidationSummary } from './validation-task'
import type { ConceptImageReport } from './concept-image-report'

import { validateComplianceSummary, type ComplianceSummary } from './compliance-review'
import type { AnalysisRun } from './analysis-run'

export interface MemoOptions {
  categoryName?: string
  marketScope?: string
  productTitle?: string
  author?: string
  conceptImages?: Record<string, string>
  integrity?: EvidenceIntegrity
  scenarioIntegrity?: ScenarioIntegrity
  pricingScenario?: PricingScenario
  costSet?: CostSet
  archive?: { id: string; digest: string; savedAt: string }
  humanReview?: ReviewSummary
  validationTasks?: ValidationSummary
  imageReport?: ConceptImageReport
  complianceReview?: ComplianceSummary
  analysisRun?: AnalysisRun
}

export function generateExecutiveMemoHtml(report: InsightReport, options: MemoOptions = {}): string {
  if (options.complianceReview) {
    if (!options.analysisRun || options.archive?.id !== options.analysisRun.id || options.archive?.digest !== options.analysisRun.archiveDigest) throw new Error('合规报告缺少原分析快照绑定')
    validateComplianceSummary(options.complianceReview, options.analysisRun)
  }
  const compliance = options.complianceReview
  const complianceSection = compliance ? `<section class="memo-section"><h2>人工合规复核 · 与系统风险提示分开</h2><p>${escapeHtml(compliance.limitation)}</p><p>待复核 ${escapeHtml(compliance.pending)} · 人工确认记录 ${escapeHtml(compliance.confirmed)} · 驳回 ${escapeHtml(compliance.rejected)}</p><p>运行 ${escapeHtml(compliance.runId)} · 存档指纹 ${escapeHtml(compliance.runDigest)}</p>${compliance.latest.map(latest => `<h3>${escapeHtml(latest.topic)} · 最新修订 #${escapeHtml(latest.revision)} · ${escapeHtml(latest.status)}</h3><p>${escapeHtml(latest.productId)} / ${escapeHtml(latest.market)}</p>${compliance.records.filter(record => record.itemId === latest.itemId).map(record => `<article><p>修订 #${escapeHtml(record.revision)} · ${escapeHtml(record.status)} · 适用性 ${escapeHtml(record.applicability)}</p><p>适用条件：${escapeHtml(record.conditions ?? '未知')}<br>商品事实：${escapeHtml(record.productFacts ?? '未知')}</p><p>来源：${escapeHtml(record.source.title)} · authority：${escapeHtml(record.source.authority ?? '未知')} · 身份：${escapeHtml(record.source.identity)}（未独立核验）<br>URL：${escapeHtml(record.source.url ?? '未知')}<br>核验日期（用户声明）：${escapeHtml(record.source.checkedAt ?? '未记录')}</p><p>复核人：${escapeHtml(record.reviewer)} · 时间：${escapeHtml(record.createdAt)}<br>理由：${escapeHtml(record.reason)}<br>记录指纹：${escapeHtml(record.recordDigest)}</p></article>`).join('')}`).join('')}<p>合规汇总指纹 ${escapeHtml(compliance.digest)} · ${escapeHtml(compliance.schemaVersion)}</p></section>` : ''
  if (options.imageReport) {
    const { digest, ...content } = options.imageReport
    if (options.imageReport.schemaVersion !== 'qling-concept-image-report/1' || !options.archive || options.archive.id !== content.runId || options.archive.digest !== content.runDigest || digest !== sha256Hex(canonicalJson(content))) throw new Error('备忘录图片与历史存档不匹配')
  }
  const imageSection = options.imageReport ? `<section class="memo-section saved-image-report"><h2>历史快照概念参考图</h2><p>未验证概念参考，不证明性能、尺寸、认证、量产或改良效果。原文存在与绑定不证明语义支持。原图片/证据/成本来自本机资料，不代表公开分享授权。</p><p>图片报告版本 ${escapeHtml(options.imageReport.schemaVersion)} · 图片指纹 ${escapeHtml(options.imageReport.digest)} · 运行 ${escapeHtml(options.imageReport.runId)} / ${escapeHtml(options.imageReport.runDigest)}</p>${options.imageReport.images.map(({ metadata, dataUrl }) => {
    const image = safeRasterDataUrl(dataUrl)
    if (!image) throw new Error('报告图片不安全，未导出')
    const binary = atob(image.slice(image.indexOf(',') + 1))
    if (!image.startsWith(`data:${metadata.response.mediaType};base64,`) || binary.length !== metadata.bytes || sha256Hex(Uint8Array.from(binary, character => character.charCodeAt(0))) !== metadata.fileDigest) throw new Error('备忘录图片字节不匹配')
    const binding = metadata.response.binding
    const scope = `<p>范围 ${escapeHtml(binding.target.productId)} / ${escapeHtml(binding.target.market)} / ${escapeHtml(binding.target.currency)} · 方面 ${escapeHtml(binding.aspectId)}</p><p>提示词 ${escapeHtml(binding.promptVersion)} · 原生成运行 ${escapeHtml(binding.runId)} · 数据指纹 ${escapeHtml(binding.dataDigest)} · 绑定指纹 ${escapeHtml(binding.bindingDigest)}</p>`
    return `<article class="concept-card"><h3>${escapeHtml(report.themes.find(theme => theme.id === metadata.themeId)?.label ?? metadata.themeId)} · 未验证概念</h3><img src="${escapeHtml(image)}" alt="未验证概念参考图" /><p>假设：${escapeHtml(metadata.response.binding.hypothesis)}</p>${metadata.response.binding.anchors.map(anchor => `<blockquote>${escapeHtml(anchor.quote)} · ${escapeHtml(anchor.reviewId)} · 语义待复核</blockquote>`).join('')}<p>模型 ${escapeHtml(metadata.response.model)} · ${escapeHtml(metadata.createdAt)} · ${escapeHtml(metadata.width)}×${escapeHtml(metadata.height)} · ${escapeHtml(metadata.bytes)} 字节</p><p>${metadata.schemaVersion === 'qling-concept-image-file/2' ? '从备份恢复，保留原生成绑定' : '原本机保存记录'} · ${escapeHtml(metadata.schemaVersion)}</p><p>字节指纹 ${escapeHtml(metadata.fileDigest)} · 记录指纹 ${escapeHtml(metadata.recordDigest)} · 原生成工作区 ${escapeHtml(metadata.response.binding.workspaceId)}</p>${scope}</article>`
  }).join('')}${options.imageReport.images.length ? '' : '<p>该运行没有已保存概念图，不代用其他运行或演示图片。</p>'}</section>` : ''
  const taskSummary = options.validationTasks
  const taskSection = taskSummary?.records.length ? `<section class="memo-section"><h2>采用与未采用的验证方案</h2><p>${escapeHtml(taskSummary.notice)}</p>${taskSummary.latest.map(task => `<h3>${escapeHtml(task.plan.title)} · ${escapeHtml(taskStatusLabels[task.status])} · ${escapeHtml(task.decision)}</h3><p>假设：${escapeHtml(task.plan.hypothesis)}</p><p>指标：${escapeHtml(task.plan.metric)} · 方法：${escapeHtml(taskMethodLabels[task.plan.method])}</p><p>预计单件新增成本：${escapeHtml(task.plan.expectedCost.value === null ? '未知' : `${task.target.currency} ${task.plan.expectedCost.value}`)} · 用户假设</p><blockquote>${escapeHtml(task.anchor.quote)} · ${escapeHtml(task.anchor.reviewId)}/${escapeHtml(task.target.productId)}/${escapeHtml(task.target.market)}</blockquote>${taskSummary.records.filter(record => record.taskId === task.taskId).map(record => `<p>修订 #${record.revision} · ${escapeHtml(taskStatusLabels[record.status])} · ${escapeHtml(record.createdAt)}<br>理由：${escapeHtml(record.reason)}<br>结果：${escapeHtml(record.result || '尚无')}<br>采用决定：${escapeHtml(record.decision)}<br>附件：${escapeHtml(record.attachments.map(file => `${file.name} (${file.bytes} 字节；SHA-256 ${file.digest})`).join('；') || '无')}</p>`).join('')}<p>分析快照 ${escapeHtml(task.runDigest)} · 成本快照 ${escapeHtml(task.costDigests.join(' / ') || '无')} · 最新任务指纹 ${escapeHtml(task.recordDigest)}</p>`).join('')}<p>任务汇总指纹 ${escapeHtml(taskSummary.digest)} · ${escapeHtml(taskSummary.schemaVersion)}；不证明结果真实。</p></section>` : ''
  const sensitivity = options.costSet?.sensitivity ? buildCostSensitivity(options.costSet) : null
  const sensitivitySection = sensitivity ? `<section class="memo-section"><h2>成本敏感性条件点</h2><p>${escapeHtml(sensitivity.note)}</p><p>敏感性指纹 ${escapeHtml(sensitivity.digest)} · ${escapeHtml(sensitivity.schemaVersion)}</p>${sensitivity.axes.map(entry => `<h3>${escapeHtml(costLabels[entry.axis])} · ${escapeHtml(sensitivity.target.currency)}</h3><table class="evidence-table"><thead><tr><th>情景</th><th>条件值</th><th>单件贡献</th><th>保本销量</th><th>未计算原因</th></tr></thead><tbody>${entry.curves.flatMap(curve => curve.points.map(point => `<tr><td>${escapeHtml(costKindLabels[curve.kind])}</td><td>${escapeHtml(['adRate', 'returnRate'].includes(entry.axis) ? (point.value * 100).toFixed(2) + '%' : point.value.toFixed(2))}</td><td>${escapeHtml(point.contribution === null ? '未计算' : point.contribution.toFixed(2))}</td><td>${escapeHtml(point.breakEvenUnits ?? '未计算')}</td><td>${escapeHtml(point.status === 'ready' ? '无' : point.status === 'non-positive-contribution' ? '非正贡献' : point.status === 'calculation-error' ? '数值超出安全范围' : point.missing.map(key => costLabels[key as keyof typeof costLabels]).join('、'))}</td></tr>`)).join('')}</tbody></table>`).join('')}</section>` : ''
  const detailedCosts = options.costSet ? `<section class="memo-section"><h2>三情景成本假设与贡献</h2><p>与旧版简化测算分别列示，不是财务净利润或改良效果证明。</p>${costSetRows(options.costSet).map(row => `<p><strong>${escapeHtml(row.label)}</strong>：${escapeHtml(row.value)}</p>`).join('')}</section>` : ''
  const categoryName = options.categoryName ?? '出海产品选品'
  const marketScope = options.marketScope ?? '全球多市场'
  const dateStr = new Date(report.generatedAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  
  const highRisks = report.complianceRisks.filter((r) => r.severity === 'high')
  const topThemes = [...report.themes].sort((a, b) => b.mentions - a.mentions).slice(0, 4)
  const concepts = report.visualConcepts ?? []
  const review = options.humanReview
  const reviewSection = review ? `<div class="memo-section"><div class="section-title">人工确认统计 · 与原预测分开</div>
    <p>人工接受 ${escapeHtml(review.accepted)} · 人工驳回 ${escapeHtml(review.rejected)} · 待复核 ${escapeHtml(review.pending)}（唯一锚点计数）</p>
    <p>仅接受的方面/情绪参与确认统计，分母为当前分析商品的全部采样评论；待复核与驳回不代表没有痛点。本机用户复核不是独立评测或平台验证；原预测、评分和建议未改写。</p>
    ${review.statistics.map(({ aspectId, sample }) => `<p>人工确认方面 ${escapeHtml(aspectId)} · ${escapeHtml(sampleStatisticsLabel(sample).replace('预测负向占比', '确认负向占比'))}</p>`).join('')}
    ${review.statistics.length ? '' : '<p>尚无人工接受证据，不计算确认提及率。</p>'}
    <ol>${review.records.map((record) => `<li>修订 ${escapeHtml(record.revision)} · ${escapeHtml(record.createdAt)} · ${escapeHtml(record.themeId)} / ${escapeHtml(record.anchor.reviewId)} · 原预测 ${escapeHtml(record.originalSentiment)} → ${escapeHtml(record.decision === 'accepted' ? `接受/${record.acceptedSentiment}` : '驳回')}<br />“${escapeHtml(record.anchor.quote)}” · 理由：${escapeHtml(record.reason)}</li>`).join('')}</ol>
    <p class="concept-prompt">复核指纹 SHA-256 ${escapeHtml(review.digest)} · ${escapeHtml(review.schemaVersion)} · 不改变原证据或情景指纹，不是数字签名。</p></div>` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <title>${escapeHtml(categoryName)} · 出海投资决策备忘录 (Executive Memo)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; line-height: 1.6; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px; }
    .memo-container { max-width: 860px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header h1 { font-size: 24px; margin: 0; color: #0f172a; letter-spacing: -0.5px; }
    .header .meta { font-size: 13px; color: #64748b; text-align: right; }
    .verdict-box { background: #f1f5f9; border-left: 4px solid #0284c7; padding: 16px 20px; border-radius: 0 6px 6px 0; margin-bottom: 24px; }
    .verdict-title { font-size: 14px; text-transform: uppercase; font-weight: 700; color: #0284c7; letter-spacing: 0.5px; margin-bottom: 4px; }
    .verdict-score { font-size: 28px; font-weight: 800; color: #0f172a; display: inline-block; margin-right: 12px; }
    .verdict-text { font-size: 15px; font-weight: 600; color: #334155; }
    .section-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 24px 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 20px; }
    .pricing-scenario .grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); }
    .pricing-scenario .card { break-inside: avoid; overflow-wrap: anywhere; }
    .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; background: #ffffff; }
    .card-label { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
    .card-value { font-size: 14px; color: #1e293b; font-weight: 600; }
    .card-detail { font-size: 12px; color: #64748b; margin-top: 4px; }
    .evidence-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; table-layout: fixed; }
    .memo-container { overflow-wrap: anywhere; }
    .evidence-table th { background: #f8fafc; text-align: left; padding: 8px 10px; border-bottom: 1px solid #cbd5e1; color: #475569; }
    .evidence-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .badge { display: inline-block; padding: 2px 6px; font-size: 11px; border-radius: 4px; font-weight: 600; }
    .badge-urgent { background: #fee2e2; color: #991b1b; }
    .badge-high { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
    .badge-medium { background: #fef3c7; color: #92400e; }
    .concept-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin-bottom: 12px; background: #fafafa; }
    .saved-image-report img { display: block; max-width: 100%; max-height: 400px; object-fit: contain; }
    .saved-image-report .concept-card { break-inside: avoid; overflow-wrap: anywhere; }
    .concept-title { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 6px; }
    .concept-solution { font-size: 13px; color: #334155; margin-bottom: 4px; }
    .concept-prompt { font-size: 12px; color: #64748b; font-family: monospace; background: #f1f5f9; padding: 6px 8px; border-radius: 4px; margin-top: 6px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px dashed #cbd5e1; font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; }
    .fingerprint { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #64748b; }
    .fingerprint strong { color: #0f172a; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .memo-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="memo-container">
    ${options.archive ? `<p>历史快照 · 存档 ${escapeHtml(options.archive.id)} · 保存于 ${escapeHtml(options.archive.savedAt)}<br />完整存档指纹 ${escapeHtml(options.archive.digest)}。使用当时原文、版本与成本，不代表当前分析。</p>` : ''}
    <div class="header">
      <div>
        <div style="font-size: 12px; color: #0284c7; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;">QLING CROSS-BORDER INSIGHT · 证据约束型决策体系</div>
        <h1>${escapeHtml(categoryName)} · 出海投资决策备忘录</h1>
      </div>
      <div class="meta">
        <div><strong>评估日期：</strong>${escapeHtml(dateStr)}</div>
        <div><strong>目标市场：</strong>${escapeHtml(marketLabel(marketScope))}</div>
        <div><strong>引擎模式：</strong>${report.providerMode === 'bailian' ? '阿里云百炼 AI 增强' : '本地确定性引擎'}</div>
      </div>
    </div>

    <div class="verdict-box">
      <div class="verdict-title">Executive Verdict / 核心结论</div>
      <div>
        <span class="verdict-score">${escapeHtml(report.opportunityScore)}分</span>
        <span class="verdict-text">${escapeHtml(report.recommendation)}</span>
      </div>
      <div style="margin-top: 8px; font-size: 13px; color: #475569;">
        输入包含 ${escapeHtml(report.dataQuality.totalReviews)} 条评论记录、${escapeHtml(report.dataQuality.linkedProducts)} 款关联商品与 ${escapeHtml(report.complianceRisks.length)} 项合规提示（引用绑定覆盖率 ${Math.round(report.evidenceCoverage.coverageRate * 100)}%）。
        <p>${escapeHtml(provenanceSummary(report.provenance))}</p>
        <p>${escapeHtml(evidenceBindingNote)}</p>
      </div>
    </div>

    <div class="section-title"><span>01 / 核心指标与评分贡献 (Ledger Breakdown)</span></div>
    <div class="grid">
      ${report.scoreContributions.map((item) => `
      <div class="card">
        <div class="card-label">${escapeHtml(item.label)} (Weight: ${item.direction === 'subtract' ? '-' : ''}${Math.round(item.weight * 100)}%)</div>
        <div class="card-value">${escapeHtml(ledgerScore(item))} · ${escapeHtml(ledgerReading(item, report.themes, highRisks.length))}</div>
        <div class="card-detail">输入：${escapeHtml(item.detail)}</div>
      </div>`).join('')}
    </div>

    <div class="section-title"><span>02 / 关键买家痛点与证据支撑 (Evidence-Grounded Signals)</span></div>
    <table class="evidence-table">
      <thead>
        <tr>
          <th style="width: 20%;">方面维度</th>
          <th style="width: 15%;">情绪/复核状态</th>
          <th style="width: 30%;">样本提及与负向占比</th>
          <th style="width: 35%;">评论原文摘要</th>
        </tr>
      </thead>
      <tbody>
        ${topThemes.map((theme) => `
          <tr>
            <td><strong>${escapeHtml(theme.label)}</strong>${theme.aspectId ? `<div>方面 ${escapeHtml(theme.aspectId)}</div>` : ''}</td>
            <td><span class="badge ${theme.quadrant === 'urgent_fix' ? 'badge-urgent' : 'badge-medium'}">${theme.evidenceLevel === 'quote-anchored/2' ? `${escapeHtml(theme.sentiment)} · 语义待复核` : theme.quadrant === 'urgent_fix' ? '致命短板' : '隐性痛点'}</span></td>
            <td>${theme.sampleStats ? theme.sampleStats.map((sample) => `<div>${escapeHtml(sampleStatisticsLabel(sample))}</div>`).join('') : `${escapeHtml(theme.mentions)} 次提及（旧版统计）`}</td>
            <td>“${escapeHtml(theme.evidence[0]?.excerpt ?? '暂无直接摘要')}”${theme.evidence.filter((reference) => reference.quoteAnchor).map((reference) => `<div>原文锚点 ${escapeHtml(reference.recordId)} · ${escapeHtml(reference.quoteAnchor!.field)} · UTF-16 [${escapeHtml(reference.quoteAnchor!.start)}, ${escapeHtml(reference.quoteAnchor!.end)})：${escapeHtml(reference.quoteAnchor!.quote)}</div>`).join('')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${concepts.length ? `
    <div class="section-title"><span>03 / 差异化改良方案与视觉概念 (Product Improvement Concepts)</span></div>
    ${concepts.map((concept) => `
      <div class="concept-card">
        <div class="concept-title">${escapeHtml(concept.conceptTitle)} <span class="badge" style="background:#e0f2fe;color:#0369a1;">针对：${escapeHtml(concept.themeLabel)}</span></div>
        <div class="concept-solution"><strong>改良方案：</strong>${escapeHtml(concept.designSolution)}（成本${escapeHtml(concept.estimatedCost)}，效果待验证）</div>
          ${safeRasterDataUrl(options.conceptImages?.[concept.id])
            ? `<img alt="${escapeHtml(concept.conceptTitle)}的参考图" src="${escapeHtml(safeRasterDataUrl(options.conceptImages?.[concept.id]))}" style="display:block;width:360px;max-width:100%;height:auto;margin-top:8px;" /><div class="concept-prompt"><strong>参考图已嵌入，仍须人工判断，不是实拍商品。</strong>${escapeHtml(concept.imagePrompt)}</div>`
            : `<div class="concept-prompt"><strong>概念提示词，尚未生成图片：</strong>${escapeHtml(concept.imagePrompt)}</div>`}
      </div>
    `).join('')}
    ` : ''}

    <div class="section-title"><span>04 / 跨国市场准入合规矩阵 (Regulatory Compliance)</span></div>
    <table class="evidence-table">
      <thead>
        <tr>
          <th style="width: 20%;">市场/区域</th>
          <th style="width: 15%;">等级</th>
          <th style="width: 30%;">监管事项与标准</th>
          <th style="width: 35%;">应对策略与行动项</th>
        </tr>
      </thead>
      <tbody>
        ${report.complianceRisks.map((risk) => `
          <tr>
            <td><strong>${escapeHtml(marketLabel(risk.market))}</strong></td>
            <td><span class="badge ${risk.severity === 'high' ? 'badge-high' : 'badge-medium'}">${escapeHtml(severityLabel(risk.severity))}</span></td>
            <td>${escapeHtml(risk.label)}</td>
            <td>${escapeHtml(risk.evidence[0]?.excerpt ?? '对照来源资料完成前置审查')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${report.batchRun ? `<section class="memo-section"><div class="section-title">在线批次范围</div><p>${escapeHtml(batchRunLabel(report.batchRun))}</p><p>${report.providerMode === 'bailian' ? '在线结论与样本分母仅来自成功批次；未完成不代表没有痛点，不混入本地规则。' : '明确标识的全范围本地回退，未混入无效在线结论。'}</p><ol>${report.batchRun.batches.map((batch) => `<li>${escapeHtml(batch.id)} · ${escapeHtml(batch.productId)} / ${escapeHtml(batch.market)} · ${escapeHtml(batch.status)} · 尝试 ${escapeHtml(batch.attempts)} · ${batch.cached ? '会话缓存' : '非缓存'}<br />评论 ID：${escapeHtml(batch.reviewIds.join('、'))}<br />${escapeHtml(batch.model ?? '未返回模型')} / ${escapeHtml(batch.promptVersion ?? '未返回提示词')}${batch.error ? ` · ${escapeHtml(batch.error)}` : ''}</li>`).join('')}</ol></section>` : ''}
    ${reviewSection}
    ${detailedCosts}
    ${taskSection}
    ${complianceSection}
    ${imageSection}
    ${taskSummary?.records.length ? `<section class="memo-section"><h2>验证步骤与对照条件</h2>${taskSummary.latest.map(task => `<h3>${escapeHtml(task.plan.title)}</h3><p>${escapeHtml(task.plan.methodDetail)}</p>`).join('')}</section>` : ''}
    ${sensitivitySection}
    ${options.pricingScenario ? `
    <section class="pricing-scenario">
      <div class="section-title"><span>05 / 定价假设与保本测算 (Pricing Assumptions)</span></div>
      <div class="grid">
        ${pricingScenarioRows(options.pricingScenario).map((row) => `<div class="card"><div class="card-label">${escapeHtml(row.label)}</div><div class="card-value">${escapeHtml(row.value)}</div></div>`).join('')}
      </div>
      <p>${escapeHtml(pricingScenarioMessage(options.pricingScenario))}</p>
      <p class="card-detail">${escapeHtml(pricingScenarioNote)}</p>
    </section>` : ''}

    <div class="footer">
      <div>
        生成时间：${escapeHtml(report.generatedAt)}
        ${folioLine(options.integrity)}
        ${options.pricingScenario ? scenarioFolio(options.scenarioIntegrity ?? buildScenarioIntegrity(options.pricingScenario)) : ''}
        <p>指纹不证明来源真实或语义正确，不是数字签名。设计概念、成本假设与合规适用性均需人工验证。</p>
      </div>
      <div class="no-print">打印 / 导出 PDF：使用浏览器菜单或 Ctrl+P。</div>
    </div>
  </div>
</body>
</html>`
}

/**
 * 页脚只写真实计算过的指纹。没有指纹时明确写“未计算”，
 * 不保留“校验通过”这类没有对应计算过程的说法。
 */
function folioLine(integrity?: EvidenceIntegrity): string {
  if (!integrity) return '<div class="fingerprint">本次导出未计算证据链指纹。</div>'
  const version = integrity.schemaVersion ?? 'qling-evidence-chain/1'
  const coverage = integrity.coverage === 'scoped-dataset' ? '当前范围完整输入与引用原文' : '报告引用；不覆盖完整输入'
  return `<div class="fingerprint">证据链指纹 ${escapeHtml(integrity.algorithm)} <strong>${escapeHtml(integrity.digest.toUpperCase())}</strong> · ${escapeHtml(version)} · ${coverage} · 覆盖 ${escapeHtml(integrity.coveredThemes)} 项聚类 / ${escapeHtml(integrity.coveredEvidence)} 条引用 / ${escapeHtml(integrity.coveredClaims)} 条结论；导出时间不参与计算。</div>`
}

function scenarioFolio(integrity: ScenarioIntegrity): string {
  return `<div class="fingerprint">情景指纹 ${escapeHtml(integrity.algorithm)} <strong>${escapeHtml(integrity.digest.toUpperCase())}</strong> · ${escapeHtml(integrity.schemaVersion)} · 公式 ${escapeHtml(integrity.formulaVersion)} · 覆盖定价输入、状态与结果。</div>`
}

function ledgerScore(item: ScoreContribution): string {
  return item.direction === 'subtract' ? `扣减 ${item.rawScore} 分` : `${item.rawScore} 分`
}

/** 台账文案只由分值和输入决定，不再写与数字无关的形容词。 */
function ledgerReading(item: ScoreContribution, themes: ReviewTheme[], highRiskCount: number): string {
  if (item.key === 'improvementSpace' && themes.some((theme) => theme.sampleStats) && !themes.some((theme) => theme.sampleStats?.some((sample) => sample.status === 'eligible'))) return '样本支持不足，改良空间待验证'
  switch (item.key) {
    case 'painIntensity':
      return `识别 ${themes.length} 项聚类痛点`
    case 'improvementSpace':
      if (item.rawScore >= 70) return '改良空间充足'
      if (item.rawScore >= 40) return '改良空间中等，需要用户访谈确认'
      return '改良空间有限，差异化卖点尚不成立'
    case 'competitionAndMargin':
      if (item.rawScore >= 70) return '价格带宽与评价分布留有定位空间'
      if (item.rawScore >= 40) return '竞争强度中等，需要明确切入口'
      return '价格带与评价集中，需要靠成本或渠道切入'
    case 'dataConfidence':
      return '购买标记占比（输入声明，未独立验证）'
    case 'compliancePenalty':
      return `${highRiskCount} 项高风险需前置审查`
    default:
      return ''
  }
}
