import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('competition demo flow works from CSV import to evidence export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /把分散信息/ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(resolve('public/samples/reviews-template.csv'))
  await expect(page.getByText('本地 CSV · reviews-template.csv')).toBeVisible()
  await expect(page.getByText('高负载发热')).toBeVisible()
  await expect(page.getByText('多口切换中断')).toBeVisible()

  await page.getByLabel('售价').fill('49.99')
  await expect(page.getByText('$18.49')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据报告' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^qling-insight-\d{4}-\d{2}-\d{2}\.json$/)
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

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(widths.scroll).toBe(widths.client)
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
  await expect(page.getByText('服务端已配置')).toBeVisible()
  await page.getByRole('button', { name: '运行百炼增强' }).click()
  await expect(page.getByText('AI 识别：高负载热管理')).toBeVisible()
  await expect(page.getByText('AI 识别：FCC 宣传措辞')).toBeVisible()
  await expect(page.getByText('百炼增强 · 证据约束')).toBeVisible()
})
