import type { ComplianceSummary } from '../domain/compliance-review'

export const complianceStatusLabels = { pending: '待复核', confirmed: '人工确认记录', rejected: '驳回原判断' }
export const applicabilityLabels = { unknown: '未知', applicable: '适用（用户判断）', 'not-applicable': '不适用（用户判断）' }

export function ComplianceReviewSummaryView({ value }: { value: ComplianceSummary }) {
  return <section className="ledger-section compliance-summary" aria-label="人工合规复核汇总">
    <h2>人工合规复核 · 与系统风险提示分开</h2>
    <p>{value.limitation}</p><p>待复核 {value.pending} · 人工确认记录 {value.confirmed} · 驳回 {value.rejected}</p>
    <p>运行 {value.runId} · 存档指纹 {value.runDigest}</p>
    {value.latest.map(record => <article key={record.itemId}><h3>{record.topic} · {complianceStatusLabels[record.status]}</h3><p>{record.productId} / {record.market} · {applicabilityLabels[record.applicability]} · 最新修订 #{record.revision}</p>
      {value.records.filter(entry => entry.itemId === record.itemId).map(entry => <div className="compliance-revision" key={entry.id}>
        <strong>修订 #{entry.revision} · {complianceStatusLabels[entry.status]} · {applicabilityLabels[entry.applicability]}</strong>
        <p>适用条件：{entry.conditions ?? '未知'}<br />商品事实：{entry.productFacts ?? '未知'}</p>
        <p>来源：{entry.source.title} · authority：{entry.source.authority ?? '未知'} · 身份：{entry.source.identity === 'unknown' ? '未知' : '用户提供，未独立核验'}<br />URL：{entry.source.url ?? '未知'}<br />核验日期（用户声明）：{entry.source.checkedAt ?? '未记录'}</p>
        <p>复核人：{entry.reviewer} · 时间：{entry.createdAt}<br />理由：{entry.reason}<br />记录指纹：{entry.recordDigest}</p>
      </div>)}
    </article>)}
    {!value.records.length && <p>尚无人工合规复核，不代表没有合规风险或已经准入。</p>}
    <p>合规汇总指纹 {value.digest} · {value.schemaVersion}</p>
  </section>
}
