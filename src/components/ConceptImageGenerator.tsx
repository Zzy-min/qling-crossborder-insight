import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisRun } from '../domain/analysis-run'
import { reviewTargets } from '../domain/human-review'
import { createConceptImageRequest } from '../domain/concept-image'
import { conceptImageFileBackup, type ConceptImageFile } from '../domain/concept-image-file'
import { runConceptImageJob } from '../domain/concept-image-job'
import { workspaceDatabase } from '../domain/workspace'
import type { ProxyProvider } from '../providers/provider'
import { ASPECT_IDS } from '../domain/evidence-contract.mjs'

export function ConceptImageGenerator({ run, provider, enabled, destination, onSaved, onIncompleteChange }: {
  run: AnalysisRun; provider: ProxyProvider; enabled: boolean; destination: string; onSaved: () => void; onIncompleteChange?: (incomplete: boolean) => void;
}) {
  const targets = useMemo(() => reviewTargets(run).filter(target => ASPECT_IDS.includes(target.theme.aspectId as string) && target.anchor.quote.length <= 1000), [run])
  const [index, setIndex] = useState(0)
  const [hypothesis, setHypothesis] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState('尚未生成；离线可继续填写验证任务')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ConceptImageFile | null>(null)
  const controller = useRef<AbortController | null>(null)
  const active = useRef(true)
  const runIdentity = `${run.workspaceId}/${run.id}/${run.archiveDigest}`
  const currentIdentity = useRef(runIdentity)
  currentIdentity.current = runIdentity
  const allowed = useRef(enabled && consent)
  allowed.current = enabled && consent
  useEffect(() => { onIncompleteChange?.(busy || !!pending) }, [busy, pending, onIncompleteChange])
  useEffect(() => () => onIncompleteChange?.(false), [onIncompleteChange])
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort() } }, [run])
  useEffect(() => {
    if (!enabled || !consent) controller.current?.abort()
    if (!enabled) setConsent(false)
  }, [enabled, consent])
  async function start() {
    const target = targets[index]
    if (!target || !allowed.current || controller.current || pending) return
    try { createConceptImageRequest(run, target.theme.id, [target.anchor], hypothesis) }
    catch { setStatus('未发送：必须选择合法原文并填写 1–1,000 字的改良假设。'); return }
    const current = new AbortController(); controller.current = current; setBusy(true)
    const inScope = () => active.current && currentIdentity.current === runIdentity && controller.current === current
    const stillCurrent = () => inScope() && allowed.current
    try {
      await runConceptImageJob({ run, themeId: target.theme.id, anchor: target.anchor, hypothesis, provider, signal: current.signal, stillCurrent,
        onStage: stage => { if (stillCurrent()) setStatus({ generating: '正在生成，不自动重试', downloading: '正在下载并校验图片，尚未保存', saving: '正在本机保存，尚未确认成功', saved: '概念参考图已保存到本机；不代表改良效果成立' }[stage]) },
        onFile: file => { if (stillCurrent()) setPending(file) }, save: (file, options) => workspaceDatabase.saveConceptImage(file, options) })
      if (stillCurrent()) { setPending(null); onSaved() }
    } catch {
      if (inScope()) setStatus(current.signal.aborted ? '操作已取消；不会继续生成或自动重试。已下载但未保存的图片可备份。' : '生成、下载或保存失败，不自动重试。若有已校验图片，先下载未保存备份或只重试本机保存；否则可检查配置后重新发起。')
    } finally { if (inScope()) setBusy(false); if (controller.current === current) controller.current = null }
  }
  async function retrySave() {
    if (!pending || controller.current) return
    const current = new AbortController(); controller.current = current; setBusy(true); setStatus('仅重试本机保存，不重新调用模型')
    try {
      await workspaceDatabase.saveConceptImage(pending, { signal: current.signal, stillCurrent: () => active.current && controller.current === current })
      if (active.current && controller.current === current) { setPending(null); setStatus('概念参考图已保存到本机'); onSaved() }
    } catch { if (active.current) setStatus('本机仍未保存；图片留在内存，请下载备份。不会自动删除已有内容。') }
    finally { if (active.current) setBusy(false); if (controller.current === current) controller.current = null }
  }
  async function backup() {
    if (!pending || busy) return
    const file = pending
    setBusy(true)
    try {
      const content = await conceptImageFileBackup(file, run)
      if (!active.current) return
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `qling-unsaved-concept-${file.id}.json`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('已发起未保存图片备份下载；原评论与成本在备份中，请私下保存。')
    } catch { if (active.current) setStatus('未保存图片备份失败；原内存图片保留，请不要离开当前历史快照。') }
    finally { if (active.current) setBusy(false) }
  }
  return <section className="concept-image-generator validation-task-panel ledger-section no-print" aria-label="生成绑定原文的概念参考图">
    <h2>原文 → 假设 → 概念参考图</h2>
    <p>实验性在线能力，提供商实际图像兼容性及语义质量尚未验证。不会把图像视为性能、认证、尺寸或量产证明；离线保留文字方案与验证任务。</p>
    <p>本机代理接收该历史快照完整商品、评论、政策、来源与数据指纹，不发送成本；上游图像提供商 {destination} 仅接收所选商品标题、方面、原文片段、来源声明与假设。请检查个人信息与资料使用授权。</p>
    <fieldset disabled={busy || !!pending}><legend>选择证据与待验证设计</legend>
      <label>生图原文依据<select value={index} onChange={event => { setIndex(Number(event.target.value)); setConsent(false) }}>{targets.map((target, position) => <option key={position} value={position}>{target.theme.label} / {target.anchor.reviewId} / {target.anchor.quote.slice(0, 100)}</option>)}</select></label>
      {targets[index] && <blockquote>{targets[index].anchor.quote}<small>语义待复核，评论报告未独立验证</small></blockquote>}
      <label>生图改良假设<textarea maxLength={1000} value={hypothesis} onChange={event => { setHypothesis(event.target.value); setConsent(false) }} /></label>
      <label className="image-consent"><input type="checkbox" checked={consent} disabled={!enabled} onChange={event => setConsent(event.target.checked)} /><span>同意发送该历史快照并生成未验证概念图</span></label>
    </fieldset>
    {!enabled && <p>当前未启用在线处理或未确认代理配置；不会发送数据。</p>}
    {!targets.length && <p>当前快照没有可用方面原文锚点，不生成无依据图片。</p>}
    <p role="status">{status}</p>
    <button type="button" disabled={!enabled || !consent || !hypothesis.trim() || !targets.length || busy || !!pending} onClick={() => void start()}>生成并保存概念参考图</button>
    {busy && controller.current && <button type="button" onClick={() => controller.current?.abort()}>取消图片操作</button>}
    {pending && <div><p>图片尚未确认保存。完整工作区备份不包含这份内存图片；离开历史快照前请先保存或下载。</p><button type="button" disabled={busy} onClick={() => void retrySave()}>仅重试本机图片保存</button><button type="button" disabled={busy} onClick={() => void backup()}>下载未保存图片备份</button></div>}
  </section>
}
