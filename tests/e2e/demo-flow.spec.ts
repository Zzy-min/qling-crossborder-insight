import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

test('competition demo flow works from CSV import to evidence export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /让数据先通过审查/ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(resolve('public/samples/reviews-template.csv'))
  await expect(page.getByRole('strong').filter({ hasText: '本地 CSV · reviews-template.csv' })).toBeVisible()
  await expect(page.getByText('隐私检查通过')).toBeVisible()
  await page.getByRole('button', { name: /开始分析/ }).click()
  await expect(page.getByRole('heading', { name: '市场机会，不止一个分数。' })).toBeVisible()
  await expect(page.getByText('高负载发热')).toBeVisible()
  await expect(page.getByRole('button', { name: /多口切换中断/ })).toBeVisible()

  await page.getByLabel('售价').fill('49.99')
  await expect(page.getByText('$18.49')).toBeVisible()

  await page.getByRole('button', { name: /决策报告/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^qling-insight-\d{4}-\d{2}-\d{2}\.json$/)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const payload = JSON.parse(await readFile(downloadPath!, 'utf8'))
  expect(payload.schemaVersion).toBe('1.1')
  expect(payload.marketScope).toBe('BOTH')
  expect(payload.sourceLabel).toBe('本地 CSV · reviews-template.csv')
  expect(payload.report.themes.every((theme: { evidence: unknown[] }) => theme.evidence.length > 0)).toBe(true)
  expect(payload.report.complianceRisks.every((risk: { humanReviewRequired: boolean; evidence: unknown[] }) => risk.humanReviewRequired && risk.evidence.length > 0)).toBe(true)
  expect(payload.competitorSnapshots.map((snapshot: { currency: string }) => snapshot.currency).sort()).toEqual(['EUR', 'USD'])
  expect(payload.pricingScenario.currency).toBe('USD')
  expect(payload.pricingScenario.fixedLaunchCost).toBe(2500)
  expect(payload.report.dataQuality.totalReviews).toBeGreaterThan(0)
  expect(payload.report.evidenceCoverage.coverageRate).toBe(1)
  expect(payload.report.scoreContributions).toHaveLength(5)
  expect(payload.report.actions.map((action: { category: string }) => action.category)).toEqual(['product', 'market', 'compliance'])
  expect(payload.disclaimer).toContain('不构成法律、财务或销量预测')
})

test('invalid personal-data CSV is rejected with a precise message', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'unsafe.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl,email\nr1,p1,en-US,5,ok,ok,2026-01-01,true,fixture:r1,user@example.com'),
  })
  await expect(page.getByRole('alert')).toContainText('不接受个人信息字段: email')
})

test('CSV with an unknown product reference is rejected', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'unknown-product.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\nr1,missing-product,en-US,2,Hot,Text,2026-07-01,true,fixture:r1'),
  })
  await expect(page.getByRole('alert')).toContainText('第 2 行 productId: 未在当前商品数据中找到: missing-product')
  await expect(page.getByRole('strong').filter({ hasText: '内置演示样例' })).toBeVisible()
})

test('conflicting duplicate review IDs are rejected without replacing the report', async ({ page }) => {
  await page.goto('/')
  const rows = [
    'r1,gan-65w-a,en-US,5,Good,First text,2026-07-01,true,fixture:r1',
    'r1,gan-65w-a,en-US,1,Bad,Different text,2026-07-02,true,fixture:r1-copy',
  ].join('\n')
  await page.locator('input[type=file]').setInputFiles({
    name: 'conflict.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\n${rows}`),
  })
  await expect(page.getByRole('alert')).toContainText('第 3 行 reviewId: 与第 2 行重复但内容不一致: r1')
  await expect(page.getByRole('strong').filter({ hasText: '内置演示样例' })).toBeVisible()
})

test('quoted multiline review content imports as one evidence record', async ({ page }) => {
  await page.goto('/')
  const csv = 'reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\nmultiline-1,gan-65w-a,en-US,2,"Hot, then stable","The charger gets hot.\nA second line confirms ""full load"" heat.",2026-07-01,true,fixture:multiline-1'
  await page.locator('input[type=file]').setInputFiles({ name: 'multiline.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('strong').filter({ hasText: '本地 CSV · multiline.csv' })).toBeVisible()
  await page.getByRole('button', { name: /开始分析/ }).click()
  await expect(page.getByRole('heading', { name: '市场机会，不止一个分数。' })).toBeVisible()
  await page.getByRole('button', { name: /高负载发热/ }).click()
  await expect(page.getByRole('complementary', { name: '证据详情' })).toContainText('Hot, then stable: The charger gets hot.')
  await expect(page.getByRole('complementary', { name: '证据详情' })).toContainText('A second line confirms "full load" heat.')
})

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(widths.scroll).toBe(widths.client)
})

test('market scope keeps policy and competitor evidence aligned', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  await expect(page.getByRole('button', { name: '欧盟', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /市场机会/ }).click()
  await expect(page.getByText('EU · MEDIUM')).toBeVisible()
  await expect(page.getByText('US · MEDIUM')).toHaveCount(0)
  await expect(page.getByText('欧盟市场 · EUR')).toBeVisible()
  await expect(page.getByText('美国市场 · USD')).toHaveCount(0)
  await expect(page.getByText('售价（EUR）')).toBeVisible()
  await expect(page.getByText('€11.19')).toBeVisible()
  await expect(page.getByText(/启动 €2,500/)).toBeVisible()
  await expect(page.getByText('$11.19')).toHaveCount(0)

  await page.getByRole('button', { name: '美国', exact: true }).click()
  await expect(page.getByText('US · MEDIUM')).toBeVisible()
  await expect(page.getByText('EU · MEDIUM')).toHaveCount(0)
  await expect(page.getByText('美国市场 · USD')).toBeVisible()
})

test('configured proxy enables AI analysis with evidence binding', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, providerConfigured: true }), { status: 200 })
      if (url.endsWith('/api/analyze')) {
        const dataset = JSON.parse(String(init?.body))
        const content = JSON.stringify({
          themes: [{ id: 'ai-thermal', label: 'AI 识别：高负载热管理', sentiment: 'negative', reviewIds: [dataset.reviews[0].reviewId] }],
      complianceRisks: [{ id: 'ai-fcc', label: 'AI 识别：FCC 宣传措辞', severity: 'medium', policyIds: [dataset.policies[0].policyId] }],
        })
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
      }
      return originalFetch(input, init)
    }
  })
  await page.goto('/')
  await expect(page.getByText('百炼可用')).toBeVisible()
  await page.getByRole('button', { name: '运行百炼增强' }).click()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await expect(page.getByRole('button', { name: /AI 识别：高负载热管理/ })).toBeVisible()
  await expect(page.getByText('AI 识别：FCC 宣传措辞')).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: '百炼增强' })).toBeVisible()
})

test('late AI response cannot overwrite a newly selected market', async ({ page }) => {
  await page.addInitScript(() => {
    window.fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/health')) return new Response(JSON.stringify({ providerConfigured: true }))
      if (url.endsWith('/api/analyze')) {
        const dataset = JSON.parse(String(init?.body))
        await new Promise((resolve) => setTimeout(resolve, 300))
        const content = JSON.stringify({
          themes: [{ id: 'late-us', label: '过期美国结果', sentiment: 'negative', reviewIds: [dataset.reviews[0].reviewId] }],
          complianceRisks: [{ id: 'late-us-policy', label: '过期美国政策', severity: 'medium', policyIds: ['us-fcc-label'] }],
        })
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    }
  })
  await page.goto('/')
  await expect(page.getByText('百炼可用')).toBeVisible()
  await page.getByRole('button', { name: '运行百炼增强' }).click()
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('过期美国结果')).toHaveCount(0)
  await expect(page.getByText('过期美国政策')).toHaveCount(0)
  await expect(page.getByText('EU · MEDIUM')).toBeVisible()
  await expect(page.getByText('US · MEDIUM')).toHaveCount(0)
})

test('evidence drawer opens from a pain signal and closes with Escape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /市场机会/ }).click()
  await page.getByRole('button', { name: /高负载发热/ }).click()
  await expect(page.getByRole('complementary', { name: '证据详情' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '证据详情' })).toContainText('review-hot-1')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: '证据详情' })).toHaveCount(0)
})

test('market evidence row drills into product snapshots', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /证据与风险/ }).click()
  await page.getByRole('button', { name: /竞品价格带与市场验证/ }).click()
  const drawer = page.getByRole('complementary', { name: '证据详情' })
  await expect(drawer).toContainText('商品快照')
  await expect(drawer).toContainText('gan-65w-a')
  await expect(drawer).toContainText('不代表实时市场')
})

test('report view contains the top actions and print-safe disclaimer', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /决策报告/ }).click()
  await expect(page.getByRole('heading', { name: '决策报告已就绪。' })).toBeVisible()
  await expect(page.locator('.print-report')).toContainText('建议优先执行')
  await expect(page.locator('.print-report')).toContainText('不构成法律、财务或销量预测')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-report')).toBeVisible()
  await expect(page.locator('.report-toolbar')).toBeHidden()
})

for (const width of [768, 1280]) {
  test(`layout has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(widths.scroll).toBe(widths.client)
  })
}
