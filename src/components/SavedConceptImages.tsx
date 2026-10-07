import { useEffect, useRef, useState } from 'react'
import type { AnalysisRun } from '../domain/analysis-run'
import type { ConceptImageFile } from '../domain/concept-image-file'
import { conceptImageFileBackup, validateConceptImageFile } from '../domain/concept-image-file'
import { workspaceDatabase } from '../domain/workspace'
import { ConceptImageGenerator } from './ConceptImageGenerator'
import type { ProxyProvider } from '../providers/provider'

export function SavedConceptImages({ run, provider, enabled = false, destination = '未知（不发送）', onIncompleteChange }: { run: AnalysisRun; provider?: ProxyProvider; enabled?: boolean; destination?: string; onIncompleteChange?: (incomplete: boolean) => void }) {
  const [revision, setRevision] = useState(0)
  const [entries, setEntries] = useState<{ file: ConceptImageFile; url: string }[]>([])
  const [status, setStatus] = useState('正在读取本机图片')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const scope = useRef(0)
  const downloads = useRef(new Set<string>())
  useEffect(() => {
    const version = ++scope.current
    const urls: string[] = []
    setEntries([]); setStatus('正在读取并校验本机图片'); setError(''); setBusy(false)
    void (async () => {
      try {
        const files = await workspaceDatabase.listConceptImages(run.workspaceId)
        if (scope.current !== version) return
        const selected = files.filter(file => file.runId === run.id)
        const next = []
        for (const file of selected) {
          const checked = await validateConceptImageFile(file, run)
          if (scope.current !== version) return
          const url = URL.createObjectURL(checked.blob)
          urls.push(url); next.push({ file: checked, url })
        }
        if (scope.current !== version) return
        setEntries(next); setStatus(`当前历史快照已校验 ${next.length} 张本机概念参考图`)
      } catch {
        for (const url of urls.splice(0)) URL.revokeObjectURL(url)
        if (scope.current === version) { setError('图片读取或校验失败，未展示未经校验的内容；原数据未删除。可重读或保留原工作区。'); setStatus('图片未加载') }
      }
    })()
    return () => {
      scope.current += 1
      for (const url of urls) URL.revokeObjectURL(url)
      for (const url of downloads.current) URL.revokeObjectURL(url)
      downloads.current.clear()
    }
  }, [run.id, run.workspaceId, run.archiveDigest, revision, run])
  async function backup(file: ConceptImageFile) {
    const version = scope.current
    if (busy) return
    setBusy(true); setError('')
    try {
      const content = await conceptImageFileBackup(file, run)
      if (scope.current !== version) return
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      downloads.current.add(url)
      const link = document.createElement('a'); link.href = url; link.download = `qling-concept-image-${file.id}.json`; link.click()
      setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url) }, 1000)
      setStatus('已发起单张图片备份下载，包含原文与完整分析；请私下保存，不代表公开分享授权。')
    } catch {
      if (scope.current === version) setError('单张备份未导出：图片或原分析校验失败；原记录保留，不自动上传或重试。')
    } finally { if (scope.current === version) setBusy(false) }
  }
  return <section className="saved-concept-images ledger-section no-print" aria-label="已保存概念参考图">
    <h2>本机概念参考图</h2>
    <p>只展示当前历史快照的已校验图片。不证明性能、尺寸、认证或量产可行性，也不证明假设成立。恢复图片保留原生成来源，不冒充新模型生成。</p>
    <p role="status">{status}</p>
    <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>重读已保存图片</button>
    {error && <p role="alert">{error}</p>}
    {provider && <ConceptImageGenerator key={run.id} run={run} provider={provider} enabled={enabled} destination={destination} onSaved={() => setRevision(value => value + 1)} onIncompleteChange={onIncompleteChange} />}
    {entries.map(({ file, url }) => <article key={file.id}>
      <h3>{run.report.themes.find(theme => theme.id === file.themeId)?.label ?? file.themeId} · 未验证概念</h3>
      <img src={url} alt="概念参考图：仅用于讨论改良假设，尚未验证" onError={() => setError('图片显示失败；原本机记录未删除，可下载备份检查。')} />
      <p>假设：{file.response.binding.hypothesis}</p>
      {file.response.binding.anchors.map((anchor, index) => <blockquote key={index}>{anchor.quote}<small>原文锚点 {anchor.reviewId} · 语义待复核</small></blockquote>)}
      <p>原生成模型 {file.response.model} · {file.createdAt} · {file.width}×{file.height} · {file.bytes} 字节</p>
      <p>{file.schemaVersion === 'qling-concept-image-file/2' ? '从备份恢复，原生成绑定保留' : '原本机保存记录'} · 文件版本 {file.schemaVersion}</p>
      <p className="report-fingerprint">字节指纹 {file.fileDigest}</p>
      <button type="button" disabled={busy} onClick={() => void backup(file)}>下载单张概念图备份</button>
    </article>)}
  </section>
}
