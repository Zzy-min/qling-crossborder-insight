import { useState } from 'react'
import type { AnalysisRun } from '../domain/analysis-run'
import { createComplianceReview, type ComplianceAssessment, type ComplianceReview, type ComplianceSummary } from '../domain/compliance-review'
import { ComplianceReviewSummaryView } from './ComplianceReviewSummaryView'
import { sha256Hex } from '../domain/integrity'

const initial: ComplianceAssessment = { topic: '', applicability: 'unknown', conditions: null, productFacts: null, source: { title: '待查来源', authority: null, url: null, identity: 'unknown', checkedAt: null }, status: 'pending', reviewer: '', reason: '' }

export function ComplianceReviewPanel({ run, summary, disabled, failed, status, onSave, onRetry, onBackup }: {
  run: AnalysisRun; summary: ComplianceSummary; disabled: boolean; failed: boolean; status: string;
  onSave: (record: ComplianceReview) => void; onRetry: () => void; onBackup: () => void;
}) {
  const [assessment, setAssessment] = useState<ComplianceAssessment>(initial)
  const [productId, setProductId] = useState(run.input.dataset.products[0].productId)
  const [itemId, setItemId] = useState('')
  const [error, setError] = useState('')
  const selected = summary.latest.find(record => record.itemId === itemId)
  const update = (key: keyof ComplianceAssessment, value: unknown) => { setError(''); setAssessment(current => ({ ...current, [key]: value })) }
  const nullable = (value: string) => value.trim() || null
  return <section className="quality-section no-print" aria-label="合规复核编辑">
    <div className="section-title"><div><span>COMPLIANCE REVIEW</span><h2>合规复核</h2></div><small>只绑定已保存快照 · 不改评分</small></div>
    <p role={failed ? 'alert' : 'status'}>{status}</p>
    <p>{summary.limitation}</p>
    {failed && <div className="source-actions"><button type="button" disabled={disabled} onClick={onRetry}>重试保存合规复核</button><button type="button" onClick={onBackup}>下载未保存合规复核备份</button></div>}
    <label>合规事项<select aria-label="合规事项" value={itemId} disabled={disabled || failed} onChange={event => {
      const record = summary.latest.find(entry => entry.itemId === event.target.value)
      setItemId(event.target.value); setError('')
      if (record) { setProductId(record.productId); setAssessment({ topic: record.topic, applicability: record.applicability, conditions: record.conditions, productFacts: record.productFacts, source: record.source, status: record.status, reviewer: record.reviewer, reason: '' }) }
      else setAssessment(initial)
    }}><option value="">新增待复核事项</option>{itemId && !selected && <option value={itemId}>当前待保存事项</option>}{summary.latest.map(record => <option key={record.itemId} value={record.itemId}>{record.productId} · {record.topic}</option>)}</select></label>
    {!selected && run.report.complianceRisks.length > 0 && <div className="source-actions">{run.report.complianceRisks.map(risk => <button key={risk.id} disabled={disabled || failed} type="button" onClick={() => {
      const product = run.input.dataset.products.find(item => item.market === risk.market)
      if (!product) return
      const stableId = `risk-${sha256Hex(JSON.stringify([run.id, product.productId, risk.id]))}`
      const existing = summary.latest.find(record => record.itemId === stableId)
      setProductId(product.productId); setAssessment(existing ? { topic: existing.topic, applicability: existing.applicability, conditions: existing.conditions, productFacts: existing.productFacts, source: existing.source, status: existing.status, reviewer: existing.reviewer, reason: '' } : { ...initial, topic: risk.label }); setItemId(stableId)
    }}>预填系统提示：{risk.label}（仍待复核）</button>)}</div>}
    <form onSubmit={event => {
      event.preventDefault()
      if (disabled || failed) return
      try {
        const record = createComplianceReview(run, productId, itemId || crypto.randomUUID(), assessment, summary.records.length + 1)
        onSave(record); setItemId(record.itemId); setError('')
      } catch (caught) { setError(caught instanceof Error ? caught.message : '合规复核未通过校验') }
    }}>
      <fieldset className="compliance-form" disabled={disabled || failed}>
        <legend>人工判断与来源记录</legend>
        <label>合规商品<select aria-label="合规商品" disabled={!!selected} value={productId} onChange={event => setProductId(event.target.value)}>{run.input.dataset.products.map(product => <option key={product.productId} value={product.productId}>{product.title} · {product.productId} / {product.market}</option>)}</select></label>
        <label>合规主题<input aria-label="合规主题" required maxLength={2000} disabled={!!selected} value={assessment.topic} onChange={event => update('topic', event.target.value)} /></label>
        <label>适用性<select aria-label="合规适用性" value={assessment.applicability} onChange={event => update('applicability', event.target.value)}><option value="unknown">未知</option><option value="applicable">适用（用户判断）</option><option value="not-applicable">不适用（用户判断）</option></select></label>
        <label>人工状态<select aria-label="合规人工状态" value={assessment.status} onChange={event => update('status', event.target.value)}><option value="pending">待复核</option><option value="confirmed">人工确认记录，非认证</option><option value="rejected">驳回原判断</option></select></label>
        <label>适用条件<textarea aria-label="合规适用条件" maxLength={2000} value={assessment.conditions ?? ''} onChange={event => update('conditions', nullable(event.target.value))} /></label>
        <label>商品事实<textarea aria-label="合规商品事实" maxLength={2000} value={assessment.productFacts ?? ''} onChange={event => update('productFacts', nullable(event.target.value))} /></label>
        {(['title', 'authority', 'url', 'checkedAt'] as const).map(key => <label key={key}>{({ title: '来源标题', authority: '来源机构（用户填写）', url: 'HTTPS 来源 URL', checkedAt: '来源核验日期（用户声明）' })[key]}<input aria-label={`合规来源-${key}`} type={key === 'checkedAt' ? 'date' : 'text'} maxLength={key === 'url' ? 2048 : 2000} value={assessment.source[key] ?? ''} onChange={event => update('source', { ...assessment.source, [key]: key === 'title' ? event.target.value : nullable(event.target.value) })} /></label>)}
        <label>来源身份<select aria-label="合规来源身份" value={assessment.source.identity} onChange={event => update('source', { ...assessment.source, identity: event.target.value })}><option value="unknown">未知</option><option value="user-provided">用户提供，未独立核验</option></select></label>
        <label>复核人<input aria-label="合规复核人" required maxLength={120} value={assessment.reviewer} onChange={event => update('reviewer', event.target.value)} /></label>
        <label>复核理由<textarea aria-label="合规复核理由" required maxLength={2000} value={assessment.reason} onChange={event => update('reason', event.target.value)} /></label>
        <button className="primary-action" type="submit">保存合规复核到本机</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="validation-error">未保存：{error}</p>}
    <details><summary>查看全部合规修订记录</summary><ComplianceReviewSummaryView value={summary} /></details>
  </section>
}
