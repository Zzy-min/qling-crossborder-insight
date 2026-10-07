import { useEffect, useRef, useState } from 'react'
import { workspaceDatabase } from '../domain/workspace'
import { applyMappingTemplate, createMappingTemplate, mappingTemplateBackup, readMappingTemplateBackup, mappingTemplateLimits, type MappingTemplate } from '../domain/mapping-template'
import type { FieldMapping } from '../domain/dataset-import'

export function MappingTemplateLibrary({ headers, productMapping, reviewMapping, previewValid, disabled, onApply }: {
  headers: MappingTemplate['headers'] | null; productMapping: FieldMapping; reviewMapping: FieldMapping; previewValid: boolean; disabled: boolean;
  onApply: (mapping: { productMapping: FieldMapping; reviewMapping: FieldMapping }) => void;
}) {
  const [templates, setTemplates] = useState<MappingTemplate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('正在读取本机映射模板…')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<MappingTemplate>()
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const loadRevision = useRef(0)
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
  async function load() {
    const revision = ++loadRevision.current
    try {
      const records = await workspaceDatabase.listMappingTemplates()
      if (!mounted.current || revision !== loadRevision.current) return
      setTemplates(records); setLoaded(true); setStatus('映射模板已读取；仅保存表头和映射，不含数据正文'); setError('')
    } catch { if (mounted.current && revision === loadRevision.current) { setLoaded(false); setError('模板读取失败，原库未修改；请勿清除浏览器数据。') } }
  }
  async function save(template: MappingTemplate) {
    if (busyRef.current) return
    loadRevision.current += 1
    busyRef.current = true; setBusy(true); setStatus('映射模板保存中，尚未确认')
    try {
      await workspaceDatabase.saveMappingTemplate(template)
      if (!mounted.current) return
      setTemplates(current => [template, ...current]); setSelectedId(template.id); setPending(undefined); setError('')
      setStatus(`已保存映射模板“${template.name}”到本机；未导入任何商品或评论`)
    } catch {
      if (mounted.current) { setPending(template); setError('映射模板未保存：额度不足、库满或写入失败；原模板/工作区未改动。可重试或下载未保存模板备份。'); setStatus('映射模板未保存') }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  function create() {
    if (!headers || !previewValid) return
    try { void save(createMappingTemplate(name, headers, productMapping, reviewMapping)) }
    catch { setError('模板未保存：请填写名称，检查映射；模板最多每文件 100 个表头、表头 200 字，不能包含个人信息列。') }
  }
  async function restore(file?: File) {
    if (!file || busyRef.current) return
    if (file.size > mappingTemplateLimits.bytes) { setError('模板文件超过 100 KB，未读取'); return }
    busyRef.current = true; setBusy(true)
    try {
      const template = readMappingTemplateBackup(await file.text())
      if (!mounted.current) return
      busyRef.current = false
      await save(template)
    } catch { if (mounted.current) setError('模板备份无效：版本、字段或指纹不匹配，原库和当前映射未修改。') }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  function apply() {
    const selected = templates.find(template => template.id === selectedId)
    if (!selected || !headers) return
    try { onApply(applyMappingTemplate(selected, headers)); setError(''); setStatus('模板已应用到映射草稿；请重新校验预览并确认来源，不会自动提交') }
    catch (caught) { setError(caught instanceof Error ? caught.message : '表头或模板不匹配，当前映射未改动') }
  }
  function download(template?: MappingTemplate) {
    if (!template) return
    const url = URL.createObjectURL(new Blob([mappingTemplateBackup(template)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = pending?.id === template.id ? 'qling-unsaved-mapping-template.json' : 'qling-mapping-template.json'; link.click(); URL.revokeObjectURL(url)
  }
  const selected = templates.find(template => template.id === selectedId)
  return <section className="mapping-template-library" aria-label="本机字段映射模板">
    <h3>复用字段映射 · 不复用数据假设</h3><p>模板仅存两份表头及字段映射；请检查名称/表头不含个人信息或密钥。表头集合须完全匹配（顺序可变），市场与币种仍从本次文件读取。最多 50 份；模板独立备份，不包含在工作区备份中。</p>
    <p role="status">{status}</p>{error && <p role="alert">{error}</p>}
    {!loaded && <button type="button" disabled={busy} onClick={() => void load()}>重读映射模板</button>}
    <fieldset disabled={disabled || busy || !loaded}><legend>主动保存或应用，不会覆盖原模板</legend>
      <label>模板名称<input aria-label="映射模板名称" maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="button" disabled={!previewValid || !name.trim() || !!pending} onClick={create}>保存已校验映射为模板</button>
      <label>已保存模板<select aria-label="已保存映射模板" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">请选择（{templates.length} 份）</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name} · {template.id.slice(0, 8)}</option>)}</select></label>
      <button type="button" disabled={!headers || !selected} onClick={apply}>应用所选映射模板</button><button type="button" disabled={!selected} onClick={() => download(selected)}>下载映射模板 JSON</button>
      <label>恢复模板备份（创建新模板）<input type="file" aria-label="恢复映射模板备份" accept=".json,application/json" disabled={!!pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void restore(file) }} /></label>
    </fieldset>
    {pending && <div><button type="button" disabled={busy || disabled} onClick={() => void save(pending)}>重试保存映射模板</button><button type="button" onClick={() => download(pending)}>下载未保存映射模板备份</button></div>}
    {selected && <p className="report-fingerprint">模板 SHA-256 {selected.contentDigest} · {selected.createdAt}（保存时间，不是数据更新时间）</p>}
  </section>
}
