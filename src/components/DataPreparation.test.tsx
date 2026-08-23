// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DataPreparation, type ImportErrorDetail } from './DataPreparation'
import type { DataQualitySummary } from '../domain/types'

afterEach(cleanup)

const baseQuality: DataQualitySummary = {
  totalReviews: 120,
  verifiedPurchaseRate: 0.85,
  timeRange: { from: '2026-01-01', to: '2026-07-30' },
  linkedProducts: 4,
  deduplicatedCount: 8,
  marketCoverage: ['US', 'EU'],
  privacyCheck: 'passed',
}

const sampleError: ImportErrorDetail = {
  summary: '第 3 行的 rating 未通过校验',
  detail: 'rating 必须在 1–5 之间',
}

describe('DataPreparation', () => {
  it('shows the validation error alert when error is provided', () => {
    render(
      <DataPreparation
        quality={baseQuality}
        sourceLabel="内置演示样例"
        error={sampleError}
        canAnalyze={true}
        onFile={() => {}}
        onReset={() => {}}
        onAnalyze={() => {}}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('第 3 行的 rating 未通过校验')
    expect(alert).toHaveTextContent('rating 必须在 1–5 之间')
  })

  it('does not show an error alert when error is null', () => {
    render(
      <DataPreparation
        quality={baseQuality}
        sourceLabel="内置演示样例"
        error={null}
        canAnalyze={true}
        onFile={() => {}}
        onReset={() => {}}
        onAnalyze={() => {}}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the analyze button when canAnalyze is false', () => {
    render(
      <DataPreparation
        quality={baseQuality}
        sourceLabel="内置演示样例"
        error={null}
        canAnalyze={false}
        onFile={() => {}}
        onReset={() => {}}
        onAnalyze={() => {}}
      />,
    )
    const button = screen.getByRole('button', { name: /开始分析/ })
    expect(button).toBeDisabled()
  })

  it('calls onAnalyze when the button is clicked and canAnalyze is true', () => {
    const onAnalyze = vi.fn()
    render(
      <DataPreparation
        quality={baseQuality}
        sourceLabel="内置演示样例"
        error={null}
        canAnalyze={true}
        onFile={() => {}}
        onReset={() => {}}
        onAnalyze={onAnalyze}
      />,
    )
    const button = screen.getByRole('button', { name: /开始分析/ })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onAnalyze).toHaveBeenCalledOnce()
  })
})
