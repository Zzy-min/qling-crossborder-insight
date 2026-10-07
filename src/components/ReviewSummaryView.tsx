import type { ReviewSummary } from '../domain/human-review'
import { sampleStatisticsLabel } from '../domain/sample-statistics'

export function ReviewSummaryView({ summary }: { summary: ReviewSummary }) {
  return <section className="review-summary" aria-label="人工确认统计">
    <span className="report-section-label">REVIEWED EVIDENCE</span><h3>人工确认统计 · 与原预测分开</h3>
    <p>人工接受 {summary.accepted} · 人工驳回 {summary.rejected} · 待复核 {summary.pending}（按唯一锚点计数）</p>
    <p>仅接受的方面/情绪参与下方样本统计；分母仍为当前分析商品的全部采样评论。未复核与驳回不算已确认痛点，不代表不存在痛点。同评论同方面冲突归混合。此为本机用户复核，不代表独立评测、平台验证或法律结论。原评分与建议未重算。</p>
    {summary.statistics.map(({ aspectId, sample }) => <p key={`${aspectId}-${sample.productId}-${sample.market}`}>人工确认方面 {aspectId} · {sampleStatisticsLabel(sample).replace('预测负向占比', '确认负向占比')}</p>)}
    {summary.statistics.length === 0 && <p>尚无人工接受证据，不计算确认提及率。</p>}
    <ol>{summary.records.map((record) => <li key={record.id}>修订 {record.revision} · {record.createdAt} · {record.themeId} / {record.anchor.reviewId} · 原预测 {record.originalSentiment} → {record.decision === 'accepted' ? `接受/${record.acceptedSentiment}` : '驳回'}<br />“{record.anchor.quote}” · 理由：{record.reason}</li>)}</ol>
    <p className="report-fingerprint">复核指纹 SHA-256 {summary.digest} · {summary.schemaVersion} · 覆盖复核记录和确认统计，不改变原证据或情景指纹，不是数字签名。</p>
  </section>
}
