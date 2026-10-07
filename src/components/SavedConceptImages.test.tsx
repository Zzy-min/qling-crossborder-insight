// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SavedConceptImages } from './SavedConceptImages'
import { workspaceDatabase } from '../domain/workspace'
import { createAnalysisRun } from '../domain/analysis-run'
import { buildInsightReport } from '../domain/analysis'
import { initialProductPricing } from '../domain/product-pricing'
import { buildPricingScenario } from '../domain/market'
import type { ConceptImageFile } from '../domain/concept-image-file'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function run(workspaceId: string) {
  const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-07', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-07', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  return createAnalysisRun(workspaceId, buildInsightReport(dataset), { category: 'Synthetic', sourceLabel: 'Synthetic test', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
}
function pending() {
  let resolve!: (files: ConceptImageFile[]) => void
  const promise = new Promise<ConceptImageFile[]>(complete => { resolve = complete })
  return { promise, resolve }
}
describe('saved concept images scope and error handling', () => {
  it('does not replace a newer historical scope with an older read result', async () => {
    const earlier = pending()
    vi.spyOn(workspaceDatabase, 'listConceptImages').mockReturnValueOnce(earlier.promise).mockResolvedValueOnce([])
    const view = render(<SavedConceptImages run={run('old')} />)
    view.rerender(<SavedConceptImages run={run('new')} />)
    await screen.findByText('当前历史快照已校验 0 张本机概念参考图')
    await act(async () => { earlier.resolve([{} as ConceptImageFile]) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('reports a failed read and only retries on an explicit user action', async () => {
    const read = vi.spyOn(workspaceDatabase, 'listConceptImages').mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce([])
    render(<SavedConceptImages run={run('workspace')} />)
    await screen.findByRole('alert')
    expect(read).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '重读已保存图片' }))
    await screen.findByText('当前历史快照已校验 0 张本机概念参考图')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('ignores completion after unmount without creating preview URLs', async () => {
    const reading = pending()
    vi.spyOn(workspaceDatabase, 'listConceptImages').mockReturnValueOnce(reading.promise)
    const view = render(<SavedConceptImages run={run('workspace')} />)
    view.unmount()
    await act(async () => { reading.resolve([{} as ConceptImageFile]) })
    expect(screen.queryByRole('region')).toBeNull()
  })
})
