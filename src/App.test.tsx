// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

afterEach(cleanup)

/** 构造一个合法的百炼 OpenAI 兼容信封。 */
function bailianEnvelope(content: Record<string, unknown>) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const validAnalysis = {
  themes: [{ id: 'thermal', label: '发热', sentiment: 'negative', reviewIds: ['review-hot-1'] }],
  complianceRisks: [{ id: 'fcc', label: 'FCC', severity: 'medium', policyIds: ['us-fcc-label'] }],
}

/** 模拟 fetch：/health 返回 providerConfigured:true，/api/analyze 按 analyzeFn 返回。 */
function mockFetch(analyzeFn: () => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/health'))
      return new Response(JSON.stringify({ providerConfigured: true }), { status: 200 })
    if (url.includes('/api/analyze'))
      return await analyzeFn()
    return new Response('', { status: 404 })
  }) as typeof fetch
}

async function toggleOnlineConsent() {
  const checkbox = screen.getByRole('checkbox', { name: /同意本次在线处理/ })
  await waitFor(() => expect(checkbox).toBeEnabled())
  fireEvent.click(checkbox)
}

describe('App AI state machine', () => {
  it('does not send data before consent and revokes consent on market changes', async () => {
    originalFetch = globalThis.fetch
    const mocked = mockFetch(() => bailianEnvelope(validAnalysis))
    globalThis.fetch = mocked
    render(<App />)
    await waitFor(() => expect(screen.getByText('百炼可用')).toBeInTheDocument())
    const button = screen.getByRole('button', { name: '运行百炼增强' })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /同意本次在线处理/ })).toBeEnabled())
    expect(button).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /同意本次在线处理/ })).not.toBeChecked()
    fireEvent.click(button)
    expect(vi.mocked(mocked).mock.calls.some(([request]) => String(request).includes('/api/analyze'))).toBe(false)
    await toggleOnlineConsent()
    expect(button).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '欧盟' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /同意本次在线处理/ })).not.toBeChecked())
    expect(button).toBeDisabled()
  })

  it('ignores a pending response after online consent is withdrawn', async () => {
    originalFetch = globalThis.fetch
    let complete: ((response: Response) => void) | undefined
    globalThis.fetch = mockFetch(() => new Promise<Response>((resolve) => { complete = resolve }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('百炼可用')).toBeInTheDocument())
    await toggleOnlineConsent()
    fireEvent.click(screen.getByRole('button', { name: '运行百炼增强' }))
    await waitFor(() => expect(complete).toBeDefined())
    await toggleOnlineConsent()
    complete!(bailianEnvelope(validAnalysis))
    await waitFor(() => expect(screen.getByRole('button', { name: '运行百炼增强' })).toBeDisabled())
    expect(screen.getByRole('heading', { name: /让数据先通过审查/ })).toBeInTheDocument()
  })
  let originalFetch: typeof globalThis.fetch | undefined

  afterEach(() => {
    if (originalFetch !== undefined) globalThis.fetch = originalFetch
    else delete (globalThis as Record<string, unknown>).fetch
    cleanup()
  })

  it('advances to the opportunity page after a successful Bailian analysis', async () => {
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch(() => bailianEnvelope(validAnalysis))

    render(<App />)

    // 等待健康检查完成，AI 按钮可用
    await waitFor(() => {
      expect(screen.getByText('百炼可用')).toBeInTheDocument()
    })

    await toggleOnlineConsent()
    fireEvent.click(screen.getByRole('button', { name: '运行百炼增强' }))

    // 分析成功后自动进入 02 市场机会页
    await waitFor(() => {
      expect(screen.getByText('市场机会，不止一个分数。')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('falls back to local analysis on failure and shows a retry button', async () => {
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch(() => new Response('Service Unavailable', { status: 503 }))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('百炼可用')).toBeInTheDocument()
    })

    await toggleOnlineConsent()
    fireEvent.click(screen.getByRole('button', { name: '运行百炼增强' }))

    // 应回退到本地分析并显示错误提示 + 重试按钮
    await waitFor(() => {
      expect(screen.getByText(/安全回退/)).toBeInTheDocument()
    }, { timeout: 5000 })

    expect(screen.getByRole('button', { name: '重试百炼分析' })).toBeInTheDocument()
  })

  it('retry triggers a second analysis attempt that succeeds', async () => {
    originalFetch = globalThis.fetch
    let analyzeCallCount = 0
    globalThis.fetch = mockFetch(() => {
      analyzeCallCount++
      if (analyzeCallCount === 1)
        return new Response('Service Unavailable', { status: 503 })
      return bailianEnvelope(validAnalysis)
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('百炼可用')).toBeInTheDocument())

    // 第一次分析失败
    await toggleOnlineConsent()
    fireEvent.click(screen.getByRole('button', { name: '运行百炼增强' }))
    await waitFor(() => {
      expect(screen.getByText(/安全回退/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // 点击重试
    fireEvent.click(screen.getByRole('button', { name: '重试百炼分析' }))

    // 第二次成功，进入市场机会页
    await waitFor(() => {
      expect(screen.getByText('市场机会，不止一个分数。')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('shows offline status when the API proxy is unreachable', async () => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as typeof fetch

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('离线可用')).toBeInTheDocument()
    })

    // AI 按钮应禁用
    const button = screen.getByRole('button', { name: '运行百炼增强' })
    expect(button).toBeDisabled()
  })

  it('keeps the header market label aligned with the selected scope', async () => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as typeof fetch

    render(<App />)

    const headerMarket = () => screen.getAllByText('目标市场').find((element) => element.tagName === 'DT')?.nextElementSibling
    expect(headerMarket()).toHaveTextContent('美国 + 欧盟')

    await waitFor(() => expect(screen.getByRole('button', { name: /宠物智能喂食器/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /宠物智能喂食器/ }))
    expect(headerMarket()).toHaveTextContent('全部市场')
    expect(headerMarket()).not.toHaveTextContent('欧盟')
  })
})
