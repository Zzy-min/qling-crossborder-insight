// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MappingTemplateLibrary } from './MappingTemplateLibrary'
import { workspaceDatabase } from '../domain/workspace'
import { createMappingTemplate } from '../domain/mapping-template'
import { productFields, reviewFields, suggestMapping } from '../domain/dataset-import'

const headers = { products: ['SKU', 'title', 'market', 'currency', 'price', 'capturedAt'], reviews: ['reviewId', 'SKU', 'locale', 'rating', 'body', 'reviewedAt'] }
const props = { headers, productMapping: suggestMapping(headers.products, productFields), reviewMapping: suggestMapping(headers.reviews, reviewFields), previewValid: true, disabled: false, onApply: vi.fn() }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(complete => { resolve = complete }); return { promise, resolve } }

describe('mapping library asynchronous state', () => {
  it('does not allow an older load response to replace a newly loaded library', async () => {
    const template = createMappingTemplate('当前模板', headers, props.productMapping, props.reviewMapping)
    const earlier = pending<typeof template[]>()
    vi.spyOn(workspaceDatabase, 'listMappingTemplates').mockReturnValueOnce(earlier.promise).mockResolvedValueOnce([template])
    render(<MappingTemplateLibrary {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '重读映射模板' }))
    await screen.findByRole('option', { name: /当前模板/ })
    await act(async () => { earlier.resolve([]) })
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
  it('saves the validated mapping snapshot but never applies it after the parent changes files', async () => {
    vi.spyOn(workspaceDatabase, 'listMappingTemplates').mockResolvedValue([])
    const saving = pending<void>()
    const save = vi.spyOn(workspaceDatabase, 'saveMappingTemplate').mockReturnValue(saving.promise)
    const onApply = vi.fn()
    const view = render(<MappingTemplateLibrary {...props} onApply={onApply} />)
    await screen.findByText(/映射模板已读取/)
    fireEvent.change(screen.getByLabelText('映射模板名称'), { target: { value: '原文件映射' } })
    fireEvent.click(screen.getByRole('button', { name: '保存已校验映射为模板' }))
    view.rerender(<MappingTemplateLibrary {...props} headers={null} previewValid={false} onApply={onApply} />)
    await act(async () => { saving.resolve() })
    expect(save.mock.calls[0][0].headers).toEqual(headers)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '应用所选映射模板' }).hasAttribute('disabled')).toBe(true)
  })
})
