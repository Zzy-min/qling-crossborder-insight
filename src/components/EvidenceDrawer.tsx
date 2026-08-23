import { useEffect, useRef } from 'react'
import type { EvidenceRef } from '../domain/types'

export interface EvidenceSelection {
  title: string
  kind: string
  confidence: string
  explanation: string
  evidence: EvidenceRef[]
}

export function EvidenceDrawer({ selection, onClose }: { selection: EvidenceSelection | null; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  // 打开时聚焦关闭按钮；关闭时把焦点归还给触发元素。
  useEffect(() => {
    if (selection && !wasOpenRef.current) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      closeButtonRef.current?.focus()
    } else if (!selection && wasOpenRef.current) {
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
    wasOpenRef.current = Boolean(selection)
  }, [selection])

  // Escape 关闭 + Tab 焦点陷阱（焦点始终留在抽屉内）。
  useEffect(() => {
    if (!selection) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusables = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selection, onClose])

  if (!selection) return null
  return <aside ref={drawerRef} className="evidence-drawer" role="dialog" aria-modal="true" aria-label="证据详情">
    <header><div><span>{selection.kind}</span><h2>{selection.title}</h2></div><button ref={closeButtonRef} type="button" aria-label="关闭证据详情" onClick={onClose}>×</button></header>
    <div className="confidence-row"><span>结论可信状态</span><strong>{selection.confidence}</strong></div>
    <p className="drawer-explanation">{selection.explanation}</p>
    <div className="evidence-stack">
      {selection.evidence.map((item) => <article key={`${item.evidenceType}-${item.recordId}`}><div><span>{item.evidenceType === 'review' ? '评论' : item.evidenceType === 'policy' ? '政策' : '商品'}</span><time>{item.capturedAt}</time></div><strong>记录 {item.recordId}</strong><p>“{item.excerpt}”</p>{item.sourceUrl.startsWith('fixture:') ? <small>本地演示证据 · 非实时数据</small> : <a href={item.sourceUrl} target="_blank" rel="noreferrer">打开官方来源 ↗</a>}</article>)}
      {!selection.evidence.length && <p className="empty-state">该分项没有直接证据，当前仅展示确定性计算说明。</p>}
    </div>
    <footer>所有结论必须绑定已知 recordId；未知引用会在领域层被拒绝。</footer>
  </aside>
}
