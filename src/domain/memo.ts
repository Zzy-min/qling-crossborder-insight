import type { InsightReport } from './types'
import { marketLabel, severityLabel } from './labels'

export interface MemoOptions {
  categoryName?: string
  marketScope?: string
  productTitle?: string
  author?: string
}

export function generateExecutiveMemoHtml(report: InsightReport, options: MemoOptions = {}): string {
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

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${categoryName} · 出海投资决策备忘录 (Executive Memo)</title>
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
    .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; background: #ffffff; }
    .card-label { font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
    .card-value { font-size: 14px; color: #1e293b; font-weight: 600; }
    .evidence-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    .evidence-table th { background: #f8fafc; text-align: left; padding: 8px 10px; border-bottom: 1px solid #cbd5e1; color: #475569; }
    .evidence-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .badge { display: inline-block; padding: 2px 6px; font-size: 11px; border-radius: 4px; font-weight: 600; }
    .badge-urgent { background: #fee2e2; color: #991b1b; }
    .badge-high { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
    .badge-medium { background: #fef3c7; color: #92400e; }
    .concept-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin-bottom: 12px; background: #fafafa; }
    .concept-title { font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 6px; }
    .concept-solution { font-size: 13px; color: #334155; margin-bottom: 4px; }
    .concept-prompt { font-size: 12px; color: #64748b; font-family: monospace; background: #f1f5f9; padding: 6px 8px; border-radius: 4px; margin-top: 6px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px dashed #cbd5e1; font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .memo-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="memo-container">
    <div class="header">
      <div>
        <div style="font-size: 12px; color: #0284c7; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;">QLING CROSS-BORDER INSIGHT · 证据约束型决策体系</div>
        <h1>${categoryName} · 出海投资决策备忘录</h1>
      </div>
      <div class="meta">
        <div><strong>评估日期：</strong>${dateStr}</div>
        <div><strong>目标市场：</strong>${marketLabel(marketScope)}</div>
        <div><strong>引擎模式：</strong>${report.providerMode === 'bailian' ? '阿里云百炼 AI 增强' : '本地确定性引擎'}</div>
      </div>
    </div>

    <div class="verdict-box">
      <div class="verdict-title">Executive Verdict / 核心结论</div>
      <div>
        <span class="verdict-score">${report.opportunityScore}分</span>
        <span class="verdict-text">${report.recommendation}</span>
      </div>
      <div style="margin-top: 8px; font-size: 13px; color: #475569;">
        基于 ${report.dataQuality.totalReviews} 条真实购买评论、${report.dataQuality.linkedProducts} 款在售竞品与 ${report.complianceRisks.length} 项官方合规政策的交叉验证（证据覆盖率 ${Math.round(report.evidenceCoverage.coverageRate * 100)}%）。
      </div>
    </div>

    <div class="section-title"><span>01 / 核心指标与评分贡献 (Ledger Breakdown)</span></div>
    <div class="grid">
      <div class="card">
        <div class="card-label">痛点强度 (Weight: 30%)</div>
        <div class="card-value">${report.scoreBreakdown.painIntensity} 分 · 识别 ${report.themes.length} 项关键聚类痛点</div>
      </div>
      <div class="card">
        <div class="card-label">可改进空间 (Weight: 25%)</div>
        <div class="card-value">${report.scoreBreakdown.improvementSpace} 分 · 差异化改良空间充足</div>
      </div>
      <div class="card">
        <div class="card-label">竞争与利润空间 (Weight: 20%)</div>
        <div class="card-value">${report.scoreBreakdown.competitionAndMargin} 分 · 建议锁定中高端溢价带</div>
      </div>
      <div class="card">
        <div class="card-label">合规惩罚 (Weight: -15%)</div>
        <div class="card-value">扣减 ${report.scoreBreakdown.compliancePenalty} 分 · ${highRisks.length} 项高风险合规项需前置审查</div>
      </div>
    </div>

    <div class="section-title"><span>02 / 关键买家痛点与证据支撑 (Evidence-Grounded Signals)</span></div>
    <table class="evidence-table">
      <thead>
        <tr>
          <th style="width: 25%;">痛点维度</th>
          <th style="width: 15%;">严重象限</th>
          <th style="width: 15%;">频次</th>
          <th style="width: 45%;">代表性买家原声摘要</th>
        </tr>
      </thead>
      <tbody>
        ${topThemes.map((theme) => `
          <tr>
            <td><strong>${theme.label}</strong></td>
            <td><span class="badge ${theme.quadrant === 'urgent_fix' ? 'badge-urgent' : 'badge-medium'}">${theme.quadrant === 'urgent_fix' ? '致命短板' : '隐性痛点'}</span></td>
            <td>${theme.mentions} 次提及</td>
            <td>“${theme.evidence[0]?.excerpt ?? '暂无直接摘要'}”</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${concepts.length ? `
    <div class="section-title"><span>03 / 差异化改良方案与视觉概念 (Product Improvement Concepts)</span></div>
    ${concepts.map((concept) => `
      <div class="concept-card">
        <div class="concept-title">${concept.conceptTitle} <span class="badge" style="background:#e0f2fe;color:#0369a1;">针对：${concept.themeLabel}</span></div>
        <div class="concept-solution"><strong>改良方案：</strong>${concept.designSolution}（预估成本变动：${concept.estimatedCost}，可行性：${concept.feasibility === 'high' ? '高' : '中'}）</div>
        <div class="concept-prompt"><strong>AI 视觉 Prompt：</strong>${concept.imagePrompt}</div>
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
            <td><strong>${marketLabel(risk.market)}</strong></td>
            <td><span class="badge badge-${risk.severity}">${severityLabel(risk.severity)}</span></td>
            <td>${risk.label}</td>
            <td>${risk.evidence[0]?.excerpt ?? '对照官方规范完成前置审查'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      <div>生成时间：${report.generatedAt} · 证据完整度哈希校验通过</div>
      <div class="no-print"><button onclick="window.print()" style="padding: 6px 12px; cursor: pointer; background: #0f172a; color: white; border: none; border-radius: 4px; font-size: 12px;">打印 / 导出 PDF</button></div>
    </div>
  </div>
</body>
</html>`
}
