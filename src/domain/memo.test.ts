import { describe, expect, it } from 'vitest'
import { buildInsightReport } from './analysis'
import { generateExecutiveMemoHtml } from './memo'
import { sampleDataset } from '../fixtures/usbCChargers'
import { smartPetFeedersDataset } from '../fixtures/smartPetFeeders'

describe('generateExecutiveMemoHtml', () => {
  it('generates a complete HTML executive decision memo for USB-C dataset', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-27T00:00:00.000Z')
    const html = generateExecutiveMemoHtml(report, {
      categoryName: '3C数码快充',
      marketScope: 'US',
    })

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('3C数码快充 · 出海投资决策备忘录')
    expect(html).toContain('Executive Verdict / 核心结论')
    expect(html).toContain('评分贡献 (Ledger Breakdown)')
    expect(html).toContain('痛点强度')
    expect(html).toContain('跨国市场准入合规矩阵')
    expect(html).toContain('打印 / 导出 PDF')
  })

  it('includes visual product concepts when present in report', () => {
    const report = buildInsightReport(smartPetFeedersDataset, '2026-08-27T00:00:00.000Z')
    const html = generateExecutiveMemoHtml(report, {
      categoryName: '智能宠物喂食器',
      marketScope: 'ALL',
    })

    expect(html).toContain('智能宠物喂食器')
    expect(html).toContain('Product Improvement Concepts')
    expect(html).toContain('AI 视觉 Prompt：')
  })
})
