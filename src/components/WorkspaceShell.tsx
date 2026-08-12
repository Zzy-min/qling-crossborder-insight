import type { ReactNode } from 'react'
import type { InsightReport } from '../domain/types'
import type { MarketScope } from '../domain/scope'

export type WorkspaceStep = 'data' | 'opportunity' | 'evidence' | 'report'

const steps: Array<{ id: WorkspaceStep; number: string; label: string; hint: string }> = [
  { id: 'data', number: '01', label: '数据准备', hint: '导入与校验' },
  { id: 'opportunity', number: '02', label: '市场机会', hint: '评分与竞品' },
  { id: 'evidence', number: '03', label: '证据与风险', hint: '来源与行动' },
  { id: 'report', number: '04', label: '决策报告', hint: '导出与打印' },
]

function decisionState(report: InsightReport) {
  if (report.evidenceCoverage.totalClaims === 0 || report.opportunityScore < 40) return '暂缓进入'
  if (report.opportunityScore < 60) return '补充证据'
  return '进入验证'
}

export function WorkspaceShell({
  activeStep,
  onStepChange,
  sourceLabel,
  marketScope,
  providerLabel,
  report,
  children,
}: {
  activeStep: WorkspaceStep
  onStepChange: (step: WorkspaceStep) => void
  sourceLabel: string
  marketScope: MarketScope
  providerLabel: string
  report: InsightReport
  children: ReactNode
}) {
  const state = decisionState(report)
  return <main className="workspace-shell">
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark">QL</span><div><strong>Qling 出海智察</strong><small>证据约束型市场决策工作台</small></div></div>
      <dl className="context-strip">
        <div><dt>数据源</dt><dd>{sourceLabel}</dd></div>
        <div><dt>目标市场</dt><dd>{marketScope === 'BOTH' ? '美国 + 欧盟' : marketScope === 'US' ? '美国' : '欧盟'}</dd></div>
        <div><dt>分析模式</dt><dd>{providerLabel}</dd></div>
        <div><dt>更新时间</dt><dd>{new Date(report.generatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</dd></div>
      </dl>
    </header>

    <div className="workspace-grid">
      <aside className="process-rail" aria-label="分析流程">
        <div className="rail-intro"><span>WORKFLOW</span><p>从原始证据到可复核决策</p></div>
        <nav>
          {steps.map((step) => <button key={step.id} type="button" className={activeStep === step.id ? 'active' : ''} aria-current={activeStep === step.id ? 'step' : undefined} onClick={() => onStepChange(step.id)}>
            <span>{step.number}</span><strong>{step.label}</strong><small>{step.hint}</small>
          </button>)}
        </nav>
        <div className="privacy-stamp"><strong>LOCAL FIRST</strong><p>CSV 默认仅在浏览器本地处理；不接收个人信息字段。</p></div>
      </aside>

      <section className="work-surface">{children}</section>

      <aside className="decision-rail">
        <span className="rail-kicker">本次决策</span>
        <div className={`decision-status status-${state}`}><i />{state}</div>
        <div className="rail-score"><strong>{report.opportunityScore}</strong><span>/100</span></div>
        <p>{report.recommendation}</p>
        <dl className="rail-metrics">
          <div><dt>证据覆盖</dt><dd>{Math.round(report.evidenceCoverage.coverageRate * 100)}%</dd></div>
          <div><dt>关键痛点</dt><dd>{report.themes.length}</dd></div>
          <div><dt>合规事项</dt><dd>{report.complianceRisks.length}</dd></div>
        </dl>
        <div className="next-action"><span>下一步建议</span><strong>{report.actions[0]?.title ?? '补充有效数据'}</strong><button type="button" onClick={() => onStepChange('evidence')}>查看依据 →</button></div>
        <small className="rail-disclaimer">信息辅助，不构成法律、财务或销量预测。</small>
      </aside>
    </div>
  </main>
}
