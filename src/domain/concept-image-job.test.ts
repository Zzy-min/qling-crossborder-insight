import { describe, expect, it, vi } from 'vitest'
import { runConceptImageJob } from './concept-image-job'
import type { AnalysisRun } from './analysis-run'
import type { ConceptImageFile } from './concept-image-file'
import type { ConceptImageResponse } from './concept-image'

function input() {
  const response = {} as ConceptImageResponse
  const file = {} as ConceptImageFile
  return { run: {} as AnalysisRun, themeId: 'theme', anchor: { reviewId: 'R', field: 'body' as const, quote: 'hot', start: 0, end: 3 }, hypothesis: 'Untested',
    provider: { generateAnchoredConceptImage: vi.fn(async () => ({ ...response, imageUrl: '/unused' })), downloadAnchoredConceptImage: vi.fn(async () => file) },
    signal: new AbortController().signal, stillCurrent: () => true, onStage: vi.fn(), onFile: vi.fn(), save: vi.fn(async () => {}) }
}
describe('concept image job sequencing', () => {
  it('only reports saved after generation, validated download and persistence complete', async () => {
    const job = input()
    await runConceptImageJob(job)
    expect(job.onStage.mock.calls.map(call => call[0])).toEqual(['generating', 'downloading', 'saving', 'saved'])
    expect(job.onFile).toHaveBeenCalledOnce()
    expect(job.save).toHaveBeenCalledOnce()
    expect(job.provider.generateAnchoredConceptImage).toHaveBeenCalledOnce()
  })
  it('preserves a downloaded file callback on save failure without retrying the model', async () => {
    const job = input(); job.save.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(runConceptImageJob(job)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(job.onFile).toHaveBeenCalledOnce()
    expect(job.onStage.mock.calls.map(call => call[0])).not.toContain('saved')
    expect(job.provider.generateAnchoredConceptImage).toHaveBeenCalledOnce()
  })
  it('cancels before sending or after a late generation response without downloading or saving', async () => {
    const controller = new AbortController(); controller.abort()
    const first = { ...input(), signal: controller.signal }
    await expect(runConceptImageJob(first)).rejects.toMatchObject({ name: 'AbortError' })
    expect(first.provider.generateAnchoredConceptImage).not.toHaveBeenCalled()
    const later = new AbortController(); const job = { ...input(), signal: later.signal }
    job.provider.generateAnchoredConceptImage.mockImplementationOnce(async () => { later.abort(); return { ...({} as ConceptImageResponse), imageUrl: '/unused' } })
    await expect(runConceptImageJob(job)).rejects.toMatchObject({ name: 'AbortError' })
    expect(job.provider.downloadAnchoredConceptImage).not.toHaveBeenCalled()
    expect(job.save).not.toHaveBeenCalled()
  })
  it('does not expose or save a downloaded file after the run scope changes', async () => {
    let current = true; const job = { ...input(), stillCurrent: () => current }
    job.provider.downloadAnchoredConceptImage.mockImplementationOnce(async () => { current = false; return {} as ConceptImageFile })
    await expect(runConceptImageJob(job)).rejects.toMatchObject({ name: 'AbortError' })
    expect(job.onFile).not.toHaveBeenCalled()
    expect(job.save).not.toHaveBeenCalled()
  })
})
