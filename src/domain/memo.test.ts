// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildInsightReport } from './analysis'
import { generateExecutiveMemoHtml } from './memo'
import { buildEvidenceIntegrity, shortDigest } from './integrity'
import { sampleDataset } from '../fixtures/usbCChargers'
import { smartPetFeedersDataset } from '../fixtures/smartPetFeeders'
import { buildPricingScenario } from './market'
import { initialCostSet, compareCostScenarios } from './cost-scenario'

describe('generateExecutiveMemoHtml', () => {
  it('escapes detailed cost sources and includes the same versioned scenario digests', () => {
    const set = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
    const attack = '<script>costAttack()</script><img src=x onerror=alert(1)>'
    set.scenarios[0].price.source = attack
    set.scenarios[1].omittedCosts = [attack]
    const html = generateExecutiveMemoHtml(buildInsightReport(sampleDataset), { costSet: set })
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelector('script, [onerror]')).toBeNull()
    expect(parsed.body.textContent).toContain(attack)
    for (const scenario of compareCostScenarios(set.scenarios)) expect(html).toContain(scenario.scenarioDigest)
  })
  it('escapes all untrusted report text and exports no executable markup', () => {
    const report = structuredClone(buildInsightReport(sampleDataset))
    const attack = '<img src=x onerror="globalThis.compromised=true"><script>alert(1)</script>'
    report.recommendation = attack
    report.themes[0].label = attack
    report.themes[0].evidence[0].excerpt = attack
    report.themes[0].evidence[0].quoteAnchor!.quote = attack
    report.themes[0].aspectId = attack
    report.complianceRisks[0].label = attack
    report.complianceRisks[0].evidence[0].excerpt = attack
    report.scoreContributions[0].detail = attack
    report.visualConcepts![0].conceptTitle = attack
    report.visualConcepts![0].imagePrompt = attack
    report.generatedAt = attack
    const html = generateExecutiveMemoHtml(report, { categoryName: attack, conceptImages: { [report.visualConcepts![0].id]: 'data:image/svg+xml;base64,PHN2Zz4=' } })
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelector('script, img, svg, [onclick], [onerror]')).toBeNull()
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'none'")
    expect(parsed.body.textContent).toContain(attack)
    expect(html).not.toContain('条真实购买评论')
    expect(html).not.toContain('项官方合规政策的交叉验证')
    expect(html).toContain('演示数据 · 非商业事实验证')
  })
  it.each([
    { fixedLaunchCost: null, landedCost: 20, message: '固定启动成本待填写' },
    { fixedLaunchCost: 3000, landedCost: 60, message: '无法形成有效的正贡献情景' },
  ])('preserves incomplete or invalid pricing assumptions without fabricated results: %j', ({ fixedLaunchCost, landedCost, message }) => {
    const html = generateExecutiveMemoHtml(buildInsightReport(sampleDataset), {
      pricingScenario: buildPricingScenario({ currency: 'EUR', price: 50, landedCost, fixedLaunchCost, platformRate: 0.15, adRate: 0.12 }),
    })
    expect(html).toContain('定价假设与保本测算')
    expect(html).toContain('EUR 50.00')
    expect(html).toContain(message)
    expect(html).toContain('保本销量未计算')
    expect(html).not.toContain('<div class="card-label">保本销量</div>')
    expect(html).toContain('证据链指纹不包含定价参数')
  })

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
    expect(html).toContain('负向样本覆盖（预测）')
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
    expect(html).toContain('概念提示词，尚未生成图片：')
    const withImage = generateExecutiveMemoHtml(report, {
      categoryName: '智能宠物喂食器',
      marketScope: 'ALL',
      conceptImages: { [report.visualConcepts![0].id]: 'data:image/png;base64,iVBORw0KGgo=' },
    })
    expect(withImage).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(withImage).toContain('参考图已嵌入，仍须人工判断，不是实拍商品。')
  })

  it('prints only a computed evidence fingerprint and never claims an uncomputed hash', () => {
    const report = buildInsightReport(sampleDataset, '2026-08-27T00:00:00.000Z')
    const integrity = buildEvidenceIntegrity(report, '3C数码快充|US')

    const withDigest = generateExecutiveMemoHtml(report, {
      categoryName: '3C数码快充',
      marketScope: 'US',
      integrity,
    })
    expect(withDigest).toContain('证据链指纹 SHA-256')
    expect(withDigest).toContain(shortDigest(integrity.digest, 32))
    expect(withDigest).toContain(`覆盖 ${integrity.coveredThemes} 项聚类`)
    expect(withDigest).not.toContain('哈希校验通过')

    const withoutDigest = generateExecutiveMemoHtml(report, { categoryName: '3C数码快充', marketScope: 'US' })
    expect(withoutDigest).toContain('本次导出未计算证据链指纹。')
    expect(withoutDigest).not.toContain('哈希校验通过')
  })

  it('derives the ledger wording from the score instead of fixed adjectives', () => {
    const strong = generateExecutiveMemoHtml(buildInsightReport(sampleDataset, '2026-08-27T00:00:00.000Z'), {
      categoryName: '3C数码快充',
      marketScope: 'US',
    })
    const empty = generateExecutiveMemoHtml(buildInsightReport({ products: [], reviews: [], policies: [] }, '2026-08-27T00:00:00.000Z'), {
      categoryName: '空白样例',
      marketScope: 'US',
    })

    expect(strong).toContain('输入：')
    expect(strong).toContain('个币种货架')
    expect(strong).not.toContain('建议锁定中高端溢价带')
    expect(strong).not.toContain('差异化改良空间充足')
    expect(empty).toContain('改良空间有限，差异化卖点尚不成立')
    expect(empty).not.toContain('改良空间充足')
    expect(empty).toContain('无在售商品快照')
  })
})
