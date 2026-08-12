import { useEffect } from 'react'
import type { EvidenceRef } from '../domain/types'

export interface EvidenceSelection {
  title: string
  kind: string
  confidence: string
  explanation: string
  evidence: EvidenceRef[]
}

export function EvidenceDrawer({ selection, onClose }: { selection: EvidenceSelection | null; onClose: () => void }) {
  useEffect(() => {
    if (!selection) return
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selection, onClose])
  if (!selection) return null
  return <aside className="evidence-drawer" aria-label="证据详情">
    <header><div><span>{selection.kind}</span><h2>{selection.title}</h2></div><button type="button" aria-label="关闭证据详情" onClick={onClose}>×</button></header>
    <div className="confidence-row"><span>结论可信状态</span><strong>{selection.confidence}</strong></div>
    <p className="drawer-explanation">{selection.explanation}</p>
    <div className="evidence-stack">
      {selection.evidence.map((item) => <article key={`${item.evidenceType}-${item.recordId}`}><div><span>{item.evidenceType === 'review' ? '评论' : item.evidenceType === 'policy' ? '政策' : '商品'}</span><time>{item.capturedAt}</time></div><strong>{item.recordId}</strong><p>“{item.excerpt}”</p>{item.sourceUrl.startsWith('fixture:') ? <small>本地演示证据 · 非实时数据</small> : <a href={item.sourceUrl} target="_blank" rel="noreferrer">打开官方来源 ↗</a>}</article>)}
      {!selection.evidence.length && <p className="empty-state">该分项没有直接证据，当前仅展示确定性计算说明。</p>}
    </div>
    <footer>所有结论必须绑定已知 recordId；未知引用会在领域层被拒绝。</footer>
  </aside>
}
