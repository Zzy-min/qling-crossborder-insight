import { taskStatusLabels, taskMethodLabels, type ValidationSummary } from '../domain/validation-task'

export function ValidationSummaryView({ value }: { value: ValidationSummary }) {
  return <section className="validation-summary" aria-label="验证方案与结果报告"><h3>采用与未采用的验证方案</h3><p>{value.notice}</p>
    {value.latest.map(task => <div key={task.taskId} className="validation-task-card"><strong>{task.plan.title} · {taskStatusLabels[task.status]} · {task.decision === 'adopted' ? '采用（用户决定）' : task.decision === 'not-adopted' ? '未采用' : '待决定'}</strong><p>假设：{task.plan.hypothesis}</p><p>指标：{task.plan.metric} · 方法：{taskMethodLabels[task.plan.method]}</p><p>预计单件新增成本：{task.plan.expectedCost.value === null ? '未知' : `${task.target.currency} ${task.plan.expectedCost.value}`} · 用户假设</p><blockquote>{task.anchor.quote}<small>{task.anchor.reviewId}/{task.target.productId}/{task.target.market}</small></blockquote>
      <p>验证步骤：{task.plan.methodDetail}</p>
      {value.records.filter(record => record.taskId === task.taskId).map(record => <p key={record.id}>修订 #{record.revision} · {taskStatusLabels[record.status]} · {record.createdAt}<br />理由：{record.reason}<br />结果：{record.result || '尚无'}<br />采用决定：{record.decision}<br />附件：{record.attachments.map(file => `${file.name} (${file.bytes} 字节；SHA-256 ${file.digest})`).join('；') || '无'}</p>)}
      <p className="report-fingerprint">分析快照 {task.runDigest} · 成本快照 {task.costDigests.join(' / ') || '无'} · 最新任务指纹 {task.recordDigest}</p></div>)}
    <p className="report-fingerprint">任务汇总指纹 {value.digest} · {value.schemaVersion}，不证明结果真实。</p>
  </section>
}
