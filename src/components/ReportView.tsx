import type { InsightReport } from '../domain/types'
import { decisionState } from '../domain/decision'
import { generateExecutiveMemoHtml } from '../domain/memo'

export function ReportView({
  report,
  sourceLabel,
  categoryName = '出海选品',
  marketScope = '全球市场',
  onExport,
  onPrint,
  onBack,
}: {
  report: InsightReport
  sourceLabel: string
  categoryName?: string
  marketScope?: string
  onExport: () => void
  onPrint: () => void
  onBack: () => void
}) {
  const decision = decisionState(report)

  function exportMemo() {
    const html = generateExecutiveMemoHtml(report, { categoryName, marketScope })
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html; charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-executive-memo-${report.generatedAt.slice(0, 10)}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="workspace-page report-page">
      <header className="report-toolbar no-print">
        <div>
          <span className="page-index">04 / DECISION REPORT</span>
          <h1>决策报告已就绪。</h1>
        </div>
        <div className="report-actions-row">
          <button type="button" onClick={onBack}>← 返回修改数据</button>
          <button type="button" onClick={exportMemo}>📄 导出高管备忘录 HTML</button>
          <button type="button" onClick={onPrint}>🖨️ 打印 / 保存 PDF</button>
          <button className="primary-action" type="button" onClick={onExport}>导出证据 JSON</button>
        </div>
      </header>
      <article className="print-report">
        <header>
          <div className="report-brand">
            <span>QL</span>
            <strong>Qling 出海智察</strong>
          </div>
          <small>生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')} · {sourceLabel} · {categoryName}</small>
        </header>

        <div className="report-decision">
          <div>
            <span>市场进入建议</span>
            <h2>{decision.label}</h2>
            <p>{report.recommendation}</p>
          </div>
          <strong>{report.opportunityScore}<small>/100</small></strong>
        </div>

        <div className="report-kpis">
          <div><span>证据覆盖</span><strong>{Math.round(report.evidenceCoverage.coverageRate * 100)}%</strong></div>
          <div><span>关键痛点</span><strong>{report.themes.length}</strong></div>
          <div><span>合规事项</span><strong>{report.complianceRisks.length}</strong></div>
          <div><span>有效购买</span><strong>{Math.round(report.dataQuality.verifiedPurchaseRate * 100)}%</strong></div>
        </div>

        <section>
          <span className="report-section-label">TOP ACTIONS</span>
          <h3>建议优先执行</h3>
          {report.actions.slice(0, 3).map((action, index) => (
            <div className="report-action" key={action.id}>
              <span>0{index + 1}</span>
              <div>
                <strong>{action.title}</strong>
                <p>{action.rationale}</p>
                <small>证据：{action.evidenceRecordIds.join('、')}</small>
              </div>
            </div>
          ))}
        </section>

        {report.visualConcepts && report.visualConcepts.length > 0 && (
          <section>
            <span className="report-section-label">PRODUCT CONCEPTS</span>
            <h3>产品改良概念与生图提示词</h3>
            <div className="report-concepts-list">
              {report.visualConcepts.map((c) => (
                <div key={c.id} className="report-concept-item">
                  <strong>{c.conceptTitle}（针对：{c.themeLabel}）</strong>
                  <p>{c.designSolution}</p>
                  <small>Prompt: {c.imagePrompt}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="report-method">
          <span className="report-section-label">METHOD</span>
          <h3>评分口径</h3>
          <p>{report.scoreContributions.map((item) => item.label + ' ' + (item.direction === 'subtract' ? '−' : '+') + Math.round(item.weight * 100) + '%').join(' · ')}</p>
          <small>AI 负责文本理解，确定性规则负责评分；模型不能直接修改最终分数。</small>
        </section>

        <footer>本报告为信息辅助，不构成法律、财务或销量预测。合规结论与市场行动均需人工复核。</footer>
      </article>
    </section>
  )
}
