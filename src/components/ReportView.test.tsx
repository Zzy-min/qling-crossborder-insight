// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReportView } from './ReportView'
import { loadConceptImageReport, type ConceptImageReport } from '../domain/concept-image-report'
import { createAnalysisRun, type AnalysisRun } from '../domain/analysis-run'
import { buildInsightReport } from '../domain/analysis'
import { initialProductPricing } from '../domain/product-pricing'
import { buildPricingScenario } from '../domain/market'
import { canonicalJson, sha256Hex } from '../domain/integrity'

vi.mock('../domain/concept-image-report', () => ({ loadConceptImageReport: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(loadConceptImageReport).mockReset() })
function run(workspaceId: string) {
  const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-07', sourceUrl: null }
  const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-07', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
  return createAnalysisRun(workspaceId, buildInsightReport(dataset), { category: 'Synthetic', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
}
function empty(run: AnalysisRun): ConceptImageReport {
  const content = { schemaVersion: 'qling-concept-image-report/1' as const, runId: run.id, runDigest: run.archiveDigest, images: [] }
  return { ...content, digest: sha256Hex(canonicalJson(content)) }
}
function props(run: AnalysisRun) { return { report: run.report, sourceLabel: 'Synthetic', analysisRun: run, archive: { id: run.id, digest: run.archiveDigest, savedAt: run.createdAt }, dataset: run.input.dataset, pricingScenario: run.input.pricingScenario, onExport: vi.fn(), onPrint: vi.fn(), onBack: vi.fn() } }
function pending() { let resolve!: (value: ConceptImageReport) => void; const promise = new Promise<ConceptImageReport>(complete => { resolve = complete }); return { promise, resolve } }

describe('report images and asynchronous export scope', () => {
  it('ignores an old image load after selecting another snapshot', async () => {
    const older = run('old'); const newer = run('new'); const reading = pending()
    vi.mocked(loadConceptImageReport).mockReturnValueOnce(reading.promise).mockResolvedValueOnce(empty(newer))
    const view = render(<ReportView {...props(older)} />)
    await waitFor(() => expect(loadConceptImageReport).toHaveBeenCalledTimes(1))
    view.rerender(<ReportView {...props(newer)} />)
    await screen.findByText('报告包含 0 张当前快照的已校验本机图片')
    await act(async () => { reading.resolve(empty(older)) })
    expect(screen.getByRole('button', { name: '📄 导出高管备忘录 HTML' })).toBeEnabled()
    expect(screen.getByText(new RegExp(newer.archiveDigest))).toBeVisible()
  })
  it('does not download an export completed after the selected run changes', async () => {
    const older = run('old'); const newer = run('new'); const exporting = pending()
    const create = vi.fn(() => 'blob:synthetic')
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn() })
    vi.mocked(loadConceptImageReport).mockResolvedValueOnce(empty(older)).mockReturnValueOnce(exporting.promise).mockResolvedValueOnce(empty(newer))
    const view = render(<ReportView {...props(older)} />)
    await screen.findByText('报告包含 0 张当前快照的已校验本机图片')
    fireEvent.click(screen.getByRole('button', { name: '📄 导出高管备忘录 HTML' }))
    await waitFor(() => expect(loadConceptImageReport).toHaveBeenCalledTimes(2))
    view.rerender(<ReportView {...props(newer)} />)
    await screen.findByText('报告包含 0 张当前快照的已校验本机图片')
    await act(async () => { exporting.resolve(empty(older)) })
    expect(create).not.toHaveBeenCalled()
  })
  it('blocks all report outputs after a failed image read until explicit successful recheck', async () => {
    const selected = run('workspace')
    vi.mocked(loadConceptImageReport).mockRejectedValueOnce(new Error('invalid bytes')).mockResolvedValueOnce(empty(selected))
    render(<ReportView {...props(selected)} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '📄 导出高管备忘录 HTML' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '🖨️ 打印 / 保存 PDF' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新校验报告图片' }))
    await screen.findByText('报告包含 0 张当前快照的已校验本机图片')
    expect(screen.getByRole('button', { name: '导出证据 JSON' })).toBeEnabled()
  })
})
