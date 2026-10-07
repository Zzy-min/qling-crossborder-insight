import { useState } from 'react'
import type { AnalysisRun } from '../domain/analysis-run'
import type { HumanReview, ReviewSummary } from '../domain/human-review'
import { reviewTargets, reviewTargetKey } from '../domain/human-review'
import type { QuoteAnchor, ReviewSentiment } from '../domain/types'

const labels = { positive: '正向', negative: '负向', neutral: '中性', mixed: '混合' }

function ReviewTarget({ target, current, disabled, onSave }: {
  target: ReturnType<typeof reviewTargets>[number]; current?: HumanReview; disabled: boolean;
  onSave: (themeId: string, anchor: QuoteAnchor, decision: HumanReview['decision'], sentiment: ReviewSentiment | null, reason: string) => void;
}) {
  const [reason, setReason] = useState('')
  const [sentiment, setSentiment] = useState<ReviewSentiment>(current?.acceptedSentiment ?? target.theme.sentiment)
  return <article className="review-target">
    <h3>{target.theme.label} · {target.anchor.reviewId}</h3>
    <p>原预测：{labels[target.theme.sentiment]} · 方面 {target.theme.aspectId ?? '未知'}</p>
    <p>引用锚点：{target.anchor.field} [{target.anchor.start}, {target.anchor.end}) · “{target.anchor.quote}”</p>
    <details><summary>查看完整评论</summary><p>{target.excerpt}</p></details>
    <p>当前决定：{current ? `${current.decision === 'accepted' ? `人工接受 · ${labels[current.acceptedSentiment!]}` : '人工驳回'} · ${current.reason}` : '待人工复核'}</p>
    <div className="review-form no-print">
      <label>确认情绪<select value={sentiment} disabled={disabled} onChange={(event) => setSentiment(event.target.value as ReviewSentiment)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>复核理由（必填）<textarea maxLength={2000} value={reason} disabled={disabled} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="history-actions">
        <button type="button" disabled={disabled || !reason.trim()} onClick={() => onSave(target.theme.id, target.anchor, 'accepted', sentiment, reason)}>接受引用与方面</button>
        <button type="button" disabled={disabled || !reason.trim()} onClick={() => onSave(target.theme.id, target.anchor, 'rejected', null, reason)}>驳回引用与方面</button>
      </div>
    </div>
  </article>
}

export function ReviewPanel({ run, summary, disabled, status, failed, onSave, onRetry, onBackup }: {
  run: AnalysisRun; summary: ReviewSummary; disabled: boolean; status: string; failed: boolean;
  onSave: (themeId: string, anchor: QuoteAnchor, decision: HumanReview['decision'], sentiment: ReviewSentiment | null, reason: string) => void;
  onRetry: () => void; onBackup: () => void;
}) {
  const [visible, setVisible] = useState(20)
  const targets = reviewTargets(run)
  const latest = new Map(summary.records.map((record) => [reviewTargetKey(record.themeId, record.anchor), record]))
  return <section className="analysis-history review-panel no-print" aria-label="人工复核">
    <div className="section-title"><div><span>HUMAN REVIEW</span><h2>人工复核 · 保留原预测</h2></div></div>
    <p>逐条核对方面与情绪是否被完整评论支持。仅本机记录，不证明来源真实，不代表独立双人复核。驳回不删除原预测；修订保留全部理由。确认统计独立展示，不改原评分或采购建议。</p>
    <p role="status">{status}</p>
    <p>人工接受 {summary.accepted} · 人工驳回 {summary.rejected} · 待复核 {summary.pending}</p>
    {failed && <div className="history-actions"><button onClick={onRetry} disabled={disabled} type="button">重试保存复核</button><button onClick={onBackup} type="button">下载未保存复核 JSON</button></div>}
    {!targets.length && <p>旧版报告没有精确锚点，不支持补造复核标注；请用当前数据重新分析。</p>}
    {targets.slice(0, visible).map((target) => <ReviewTarget key={reviewTargetKey(target.theme.id, target.anchor)} target={target} current={latest.get(reviewTargetKey(target.theme.id, target.anchor))} disabled={disabled || failed} onSave={onSave} />)}
    {visible < targets.length && <button type="button" onClick={() => setVisible((count) => count + 20)}>显示更多待复核引用（共 {targets.length} 条）</button>}
    {summary.records.length > 0 && <details><summary>查看全部复核修订（{summary.records.length} 条）</summary><ol>{summary.records.map((record) => <li key={record.id}>修订 {record.revision} · {record.createdAt} · {record.anchor.reviewId} · {record.decision === 'accepted' ? `接受/${labels[record.acceptedSentiment!]}` : '驳回'} · {record.reason}</li>)}</ol></details>}
  </section>
}
