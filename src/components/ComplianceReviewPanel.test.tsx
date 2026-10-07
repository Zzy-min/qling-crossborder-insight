// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createAnalysisRun } from '../domain/analysis-run'
import { buildInsightReport } from '../domain/analysis'
import { buildPricingScenario } from '../domain/market'
import { initialProductPricing } from '../domain/product-pricing'
import { buildComplianceSummary } from '../domain/compliance-review'
import { ComplianceReviewPanel } from './ComplianceReviewPanel'

afterEach(cleanup)
function fixture() {
  const product = { productId: 'SKU', title: 'Synthetic charger', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'Gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  const run = createAnalysisRun('workspace', buildInsightReport(dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'US', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
  return { run, summary: buildComplianceSummary(run, []), disabled: false, failed: false, status: '已读取', onSave: vi.fn(), onRetry: vi.fn(), onBackup: vi.fn() }
}
describe('historical compliance editor', () => {
  it('retains unknown defaults and refuses incomplete confirmation in the domain', () => {
    const props = fixture(); render(<ComplianceReviewPanel {...props} />)
    expect(screen.getByLabelText('合规适用性')).toHaveValue('unknown')
    expect(screen.getByLabelText('合规来源身份')).toHaveValue('unknown')
    fireEvent.change(screen.getByLabelText('合规主题'), { target: { value: 'Scope' } })
    fireEvent.change(screen.getByLabelText('合规复核人'), { target: { value: 'User' } })
    fireEvent.change(screen.getByLabelText('合规复核理由'), { target: { value: 'Need source' } })
    fireEvent.change(screen.getByLabelText('合规人工状态'), { target: { value: 'confirmed' } })
    fireEvent.submit(screen.getByRole('button', { name: '保存合规复核到本机' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('人工确认需要')
    expect(props.onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('合规人工状态'), { target: { value: 'pending' } })
    fireEvent.submit(screen.getByRole('button', { name: '保存合规复核到本机' }).closest('form')!)
    expect(props.onSave).toHaveBeenCalledOnce()
    expect(props.onSave.mock.calls[0][0]).toMatchObject({ applicability: 'unknown', revision: 1, source: { checkedAt: null } })
  })
  it('does not write while busy or failed and retains recovery actions', () => {
    const props = fixture(); render(<ComplianceReviewPanel {...props} failed status="未保存" />)
    expect(screen.getByRole('button', { name: '保存合规复核到本机' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试保存合规复核' }))
    fireEvent.click(screen.getByRole('button', { name: '下载未保存合规复核备份' }))
    expect(props.onRetry).toHaveBeenCalledOnce(); expect(props.onBackup).toHaveBeenCalledOnce()
    expect(props.onSave).not.toHaveBeenCalled()
  })
})
