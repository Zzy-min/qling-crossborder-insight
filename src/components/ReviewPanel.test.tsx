// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createAnalysisRun } from '../domain/analysis-run'
import { buildInsightReport } from '../domain/analysis'
import { buildPricingScenario } from '../domain/market'
import { buildReviewSummary } from '../domain/human-review'
import { ReviewPanel } from './ReviewPanel'

afterEach(cleanup)

function run() {
  const product = { productId: 'SKU', title: 'Charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'Charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  return createAnalysisRun('workspace', buildInsightReport(dataset), { category: 'Test', sourceLabel: 'Test', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario({ currency: 'USD', price: 30, landedCost: null, platformRate: null, adRate: null, fixedLaunchCost: null }, product) }, 'local')
}

describe('review controls', () => {
  it('requires a reason and sends the chosen sentiment without changing predictions', () => {
    const original = run()
    const onSave = vi.fn()
    render(<ReviewPanel run={original} summary={buildReviewSummary(original, [])} disabled={false} status="已读取" failed={false} onSave={onSave} onRetry={() => {}} onBackup={() => {}} />)
    expect(screen.getByRole('button', { name: '接受引用与方面' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('复核理由（必填）'), { target: { value: '原文否定过热' } })
    fireEvent.change(screen.getByLabelText('确认情绪'), { target: { value: 'positive' } })
    fireEvent.click(screen.getByRole('button', { name: '接受引用与方面' }))
    expect(onSave).toHaveBeenCalledWith(original.report.themes[0].id, original.report.themes[0].evidence[0].quoteAnchor, 'accepted', 'positive', '原文否定过热')
    expect(original.report.themes[0].sentiment).toBe('negative')
    fireEvent.click(screen.getByRole('button', { name: '驳回引用与方面' }))
    expect(onSave).toHaveBeenLastCalledWith(original.report.themes[0].id, original.report.themes[0].evidence[0].quoteAnchor, 'rejected', null, '原文否定过热')
  })
  it('blocks edits while an unsaved decision needs retry and offers backup', () => {
    const original = run()
    const retry = vi.fn()
    const backup = vi.fn()
    render(<ReviewPanel run={original} summary={buildReviewSummary(original, [])} disabled={false} status="未保存" failed onSave={() => {}} onRetry={retry} onBackup={backup} />)
    expect(screen.getByLabelText('复核理由（必填）')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试保存复核' }))
    fireEvent.click(screen.getByRole('button', { name: '下载未保存复核 JSON' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(backup).toHaveBeenCalledOnce()
  })
})
