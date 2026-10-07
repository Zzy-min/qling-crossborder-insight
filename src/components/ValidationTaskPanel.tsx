import { useState } from 'react'
import type { AnalysisRun } from '../domain/analysis-run'
import { reviewTargets } from '../domain/human-review'
import { createValidationTask, reviseValidationTask, createTaskAttachment, attachmentMetadata, attachmentBytes, taskStatusLabels, taskMethodLabels, type ValidationTask, type TaskAttachment, type ValidationSummary } from '../domain/validation-task'

export function ValidationTaskPanel({ run, summary, files, busy, failed, status, onSave, onRetry, onBackup }: { run: AnalysisRun; summary: ValidationSummary; files: TaskAttachment[]; busy: boolean; failed: boolean; status: string; onSave: (task: ValidationTask, files?: TaskAttachment[]) => void; onRetry: () => void; onBackup: () => void }) {
  const targets = reviewTargets(run).filter(target => target.theme.aspectId)
  const [targetIndex, setTargetIndex] = useState(0)
  const [title, setTitle] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [metric, setMetric] = useState('')
  const [method, setMethod] = useState<'interview' | 'prototype' | 'supplier' | 'other'>('interview')
  const [methodDetail, setMethodDetail] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState('')
  const disabled = busy || failed
  function create() {
    const target = targets[targetIndex]
    if (!target) return
    const review = run.input.dataset.reviews.find(row => row.reviewId === target.anchor.reviewId)!
    const product = run.input.dataset.products.find(row => row.productId === review.productId)!
    try {
      const expectedCost = { currency: product.currency, value: cost.trim() ? Number(cost) : null, status: cost.trim() ? 'included' as const : 'unknown' as const, identity: 'user-assumption' as const, source: null, updatedAt: null }
      onSave(createValidationTask(run, target.theme.id, target.anchor, { title, hypothesis, metric, method, methodDetail, expectedCost }))
      setError('')
    } catch { setError('未创建：请填写标题、改良假设、待验证指标及验证步骤；新增成本只能为非负数或未知。') }
  }
  return <section className="validation-task-panel ledger-section no-print" aria-label="改良验证任务">
    <h2>证据 → 假设 → 验证</h2><p>仅绑定当前已保存快照。默认访谈、样机或供应商核对，不自动建议采购；评论报告未独立验证。任务状态是用户记录，不代表性能、认证或实际收益证明。</p>
    <p role="status">{status}</p>{failed && <div><button type="button" disabled={busy} onClick={onRetry}>重试保存任务</button><button type="button" onClick={onBackup}>下载未保存任务备份</button></div>}
    <fieldset disabled={disabled || !targets.length}><legend>创建待验证方案</legend>
      <label>原文依据<select aria-label="任务原文依据" value={targetIndex} onChange={event => setTargetIndex(Number(event.target.value))}>{targets.map((target, index) => <option key={`${target.theme.id}-${index}`} value={index}>{target.theme.label} / {target.anchor.reviewId} / {target.anchor.quote.slice(0, 100)}</option>)}</select></label>
      {targets[targetIndex] && <blockquote>{targets[targetIndex].anchor.quote}<small>语义待复核 · {targets[targetIndex].anchor.reviewId}</small></blockquote>}
      <label>标题<input aria-label="验证任务标题" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>设计假设<textarea aria-label="任务设计假设" maxLength={5000} value={hypothesis} onChange={event => setHypothesis(event.target.value)} /></label>
      <label>待验证指标<textarea aria-label="任务待验证指标" maxLength={5000} value={metric} onChange={event => setMetric(event.target.value)} /></label>
      <label>验证方法<select aria-label="任务验证方法" value={method} onChange={event => setMethod(event.target.value as typeof method)}>{Object.entries(taskMethodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>验证步骤与对照条件<textarea aria-label="任务验证步骤" maxLength={5000} value={methodDetail} onChange={event => setMethodDetail(event.target.value)} /></label>
      <label>预计单件新增成本（原商品币种，未知留空）<input type="number" aria-label="任务预计新增成本" min="0" step="any" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <button type="button" onClick={create}>创建并保存验证任务</button>
    </fieldset>{error && <p role="alert">{error}</p>}
    {summary.latest.map(task => <TaskEditor key={`${task.taskId}-${task.revision}`} task={task} run={run} revisions={summary.records.filter(record => record.taskId === task.taskId)} files={files} disabled={disabled} onSave={onSave} />)}
  </section>
}

function TaskEditor({ task, run, revisions, files, disabled, onSave }: { task: ValidationTask; run: AnalysisRun; revisions: ValidationTask[]; files: TaskAttachment[]; disabled: boolean; onSave: (task: ValidationTask, files?: TaskAttachment[]) => void }) {
  const [status, setStatus] = useState(task.status)
  const [decision, setDecision] = useState(task.decision)
  const [reason, setReason] = useState('')
  const [result, setResult] = useState(task.result)
  const [pendingFiles, setPendingFiles] = useState<TaskAttachment[]>([])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  async function attach(list: FileList | null) {
    if (!list) return
    setReading(true)
    try {
      const added: TaskAttachment[] = []
      for (const file of Array.from(list)) added.push(await createTaskAttachment(file, task))
      if (added.length + pendingFiles.length + task.attachments.length > 20 || [...added, ...pendingFiles].reduce((sum, file) => sum + file.bytes, 0) > 10_000_000) throw new Error('附件超出上限')
      setPendingFiles(current => [...current, ...added]); setError('')
    } catch { setError('附件未加入：只允许 TXT/MD/LOG、PNG/JPEG/WebP、PDF，单文件最多 5 MB，任务最多 20 个附件，工作区合计 10 MB；请自行检查个人信息。') }
    finally { setReading(false) }
  }
  function save() {
    try {
      const next = reviseValidationTask(task, run, { status, decision: status === 'rejected' ? 'not-adopted' : decision, reason, result, attachments: [...task.attachments, ...pendingFiles.map(attachmentMetadata)] })
      onSave(next, pendingFiles); setError('')
    } catch { setError('未保存：请填写理由；按待验证→验证中→已验证/已否定/暂缓转换。结论需要结果，已验证需要采用决定；原计划不可改写。') }
  }
  function download(file: TaskAttachment) {
    const url = URL.createObjectURL(new Blob([attachmentBytes(file).buffer as ArrayBuffer], { type: 'application/octet-stream' }))
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url)
  }
  return <article className="validation-task-card" aria-label={`验证任务 ${task.plan.title}`}><h3>{task.plan.title} · {taskStatusLabels[task.status]}</h3>
    <p>假设：{task.plan.hypothesis}</p><p>指标：{task.plan.metric} · 方法：{taskMethodLabels[task.plan.method]}</p><p>预计单件新增成本：{task.plan.expectedCost.value === null ? '未知' : `${task.target.currency} ${task.plan.expectedCost.value}`}（用户假设）</p>
    <p>验证步骤：{task.plan.methodDetail}</p>
    <blockquote>{task.anchor.quote}<small>{task.target.productId}/{task.target.market} · {task.aspectId} · {task.anchor.reviewId}</small></blockquote>
    <p className="report-fingerprint">分析快照 {task.runDigest} · 成本快照 {task.costDigests.join(' / ') || '此商品没有绑定成本快照'}</p>
    <fieldset disabled={disabled || reading}><legend>追加验证记录（保留原计划与历次结果）</legend>
      <label>任务状态<select aria-label="任务状态" value={status} onChange={event => { setStatus(event.target.value as typeof status); setDecision(event.target.value === 'rejected' ? 'not-adopted' : 'undecided') }}>{Object.entries(taskStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>采用决定<select aria-label="任务采用决定" value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="undecided">尚未决定</option><option value="adopted">采用（用户决定）</option><option value="not-adopted">不采用</option></select></label>
      <label>结果记录<textarea aria-label="任务结果记录" maxLength={10000} value={result} onChange={event => setResult(event.target.value)} /></label>
      <label>本次理由（必填）<textarea aria-label="任务本次理由" maxLength={5000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label>结果附件（本机保存，不自动预览或执行）<input type="file" aria-label="任务结果附件" accept=".txt,.md,.log,.png,.jpg,.jpeg,.webp,.pdf" multiple onChange={event => void attach(event.target.files)} /></label>
      <p>{reading ? '正在检查附件，尚未保存' : `待保存附件 ${pendingFiles.length} 个`}</p><button type="button" onClick={save}>保存任务状态与结果</button>
    </fieldset>{error && <p role="alert">{error}</p>}
    {task.attachments.map(meta => <p key={meta.id}>{meta.name} · {meta.bytes} 字节 <button type="button" onClick={() => { const file = files.find(candidate => candidate.id === meta.id); if (file) download(file) }}>下载原结果附件</button></p>)}
    <details><summary>查看任务修订链（{revisions.length} 条）</summary>{revisions.map(record => <p key={record.id}>#{record.revision} · {taskStatusLabels[record.status]} · {record.createdAt}<br />理由：{record.reason}<br />结果：{record.result || '尚无'}<br />采用：{record.decision}</p>)}</details>
  </article>
}
