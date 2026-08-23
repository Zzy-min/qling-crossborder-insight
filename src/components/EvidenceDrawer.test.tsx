// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EvidenceDrawer, type EvidenceSelection } from './EvidenceDrawer'
import type { EvidenceRef } from '../domain/types'

afterEach(cleanup)

const sampleEvidence: EvidenceRef[] = [
  { sourceUrl: 'fixture:test/review-1', capturedAt: '2026-01-01', excerpt: '评论摘要', recordId: 'review-1', evidenceType: 'review' },
]

const sampleSelection: EvidenceSelection = {
  title: '测试主题',
  kind: '评论痛点',
  confidence: '有原始评论支持',
  explanation: '解释说明',
  evidence: sampleEvidence,
}

/** 宿主组件：模拟「点击触发 → 打开抽屉 → 关闭」的完整生命周期。 */
function TestHost() {
  const [selection, setSelection] = useState<EvidenceSelection | null>(null)
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setSelection(sampleSelection)}>
        打开抽屉
      </button>
      <EvidenceDrawer selection={selection} onClose={() => setSelection(null)} />
    </div>
  )
}

describe('EvidenceDrawer', () => {
  it('does not render a dialog when selection is null', () => {
    render(<TestHost />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a dialog with correct ARIA when opened', () => {
    render(<TestHost />)
    fireEvent.click(screen.getByTestId('trigger'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', '证据详情')
    expect(screen.getByText('测试主题')).toBeInTheDocument()
  })

  it('closes when Escape is pressed', () => {
    render(<TestHost />)
    fireEvent.click(screen.getByTestId('trigger'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves focus to close button on open and restores focus on close', () => {
    render(<TestHost />)
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    const closeBtn = screen.getByRole('button', { name: '关闭证据详情' })
    expect(closeBtn).toHaveFocus()
    fireEvent.click(closeBtn)
    expect(trigger).toHaveFocus()
  })
})
