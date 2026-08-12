import type { InsightReport } from '../domain/types'

export function EvidenceWorkspace({ report, onOpenTheme, onOpenMarket, onOpenRisk }: { report: InsightReport; onOpenTheme: (index: number) => void; onOpenMarket: () => void; onOpenRisk: (index: number) => void }) {
  const marketAction = report.actions.find((action) => action.category === 'market')
  const rows = [
    ...report.themes.map((item, index) => ({ id: item.id, label: item.label, review: item.evidence.length, product: 0, policy: 0, action: () => onOpenTheme(index) })),
    ...(marketAction ? [{ id: marketAction.id, label: '竞品价格带与市场验证', review: 0, product: marketAction.evidenceRecordIds.length, policy: 0, action: onOpenMarket }] : []),
    ...report.complianceRisks.map((item, index) => ({ id: item.id, label: item.label, review: 0, product: 0, policy: item.evidence.length, action: () => onOpenRisk(index) })),
  ]
  return <section className="workspace-page evidence-page">
    <header className="page-heading compact"><div><span className="page-index">03 / EVIDENCE</span><h1>每项建议，都能回到原始记录。</h1></div><p>证据矩阵揭示覆盖与缺口；行动项由确定性规则生成，不把模型措辞当作业务事实。</p></header>
    <section className="ledger-section matrix-section"><div className="section-title"><div><span>EVIDENCE MATRIX</span><h2>结论覆盖矩阵</h2></div><span className="coverage-badge">{Math.round(report.evidenceCoverage.coverageRate * 100)}% 已覆盖</span></div><div className="evidence-matrix"><div className="table-head"><span>结论</span><span>评论</span><span>商品</span><span>政策</span><span>状态</span></div>{rows.map((row) => <button type="button" key={row.id} onClick={row.action}><span><strong>{row.label}</strong><small>{row.id}</small></span><span>{row.review || '—'}</span><span>{row.product || '—'}</span><span>{row.policy || '—'}</span><span className={row.review + row.product + row.policy > 0 ? 'covered' : 'missing'}>{row.review + row.product + row.policy > 0 ? '已覆盖' : '缺口'} →</span></button>)}</div></section>
    <section className="action-section"><div className="section-title"><div><span>ACTION QUEUE</span><h2>下一步行动</h2></div><small>按优先级与证据确定性排序</small></div><div className="action-list">{report.actions.map((action, index) => <article key={action.id}><span className="action-number">0{index + 1}</span><div><span className={`priority ${action.priority}`}>{action.priority === 'high' ? '高优先级' : action.priority === 'medium' ? '中优先级' : '低优先级'} · {action.category === 'product' ? '产品改进' : action.category === 'market' ? '市场验证' : '合规复核'}</span><h3>{action.title}</h3><p>{action.rationale}</p><small>依据：{action.evidenceRecordIds.join(' · ')}</small></div><span className="review-flag">{action.humanReviewRequired ? '需人工复核' : '可自动执行'}</span></article>)}</div></section>
  </section>
}
