import type { BatchRun } from '../domain/types'
import { batchRunLabel } from '../domain/analysis-batch'

export function BatchRunNotice({ run, offline = false, report = false }: { run: BatchRun; offline?: boolean; report?: boolean }) {
  return <section className="analysis-notice batch-notice" aria-label="在线批次范围">
    <p role="status">{batchRunLabel(run)}</p>
    <p>{offline ? '本报告为明确标识的全范围本地回退，未混入无效在线结论。' : '在线结论与样本分母仅来自成功批次，未完成范围不是没有痛点；不混入本地规则。'}取消只能阻止后续发送，不能撤回已发送的数据；结构通过仍需人工复核。</p>
    <details><summary>查看每批范围、版本与尝试次数</summary><ol>{run.batches.map((batch) => <li key={batch.id}>{batch.id} · {batch.productId}/{batch.market} · {batch.status} · 尝试 {batch.attempts} · {batch.cached ? '会话缓存' : '非缓存'}<br />评论 ID：{batch.reviewIds.join('、')}<br />{batch.model ?? '未返回模型'} / {batch.promptVersion ?? '未返回提示词版本'}{batch.error ? ` · ${batch.error}` : ''}</li>)}</ol></details>
    {report && <ol className="batch-print-only">{run.batches.map((batch) => <li key={batch.id}>{batch.id} · {batch.productId}/{batch.market} · {batch.status} · 尝试 {batch.attempts} · {batch.cached ? '会话缓存' : '非缓存'}<br />评论 ID：{batch.reviewIds.join('、')}<br />{batch.model ?? '未返回模型'} / {batch.promptVersion ?? '未返回提示词版本'}{batch.error ? ` · ${batch.error}` : ''}</li>)}</ol>}
  </section>
}
