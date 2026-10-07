import { openAdvanced, analyzeAndOpenReport } from './advanced-controls'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

test('competition demo flow works from CSV import to evidence export', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByRole('heading', { name: /让数据先通过审查/ })).toBeVisible()
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles(resolve('public/samples/reviews-template.csv'))
  await expect(page.getByRole('strong').filter({ hasText: '本地 CSV · reviews-template.csv' })).toBeVisible()
  await expect(page.getByText('隐私检查通过')).toBeVisible()
  await page.getByRole('button', { name: /开始分析/ }).click()
  await expect(page.getByRole('heading', { name: '市场机会，不止一个分数。' })).toBeVisible()
  await expect(page.getByText('高负载发热')).toBeVisible()
  await expect(page.locator('.score-table').getByText(/个币种货架/)).toBeVisible()
  await expect(page.getByRole('button', { name: /多口切换中断/ })).toBeVisible()

  await page.getByLabel('售价').fill('49.99')
  await expect(page.getByText('$18.49')).toBeVisible()

  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^qling-insight-\d{4}-\d{2}-\d{2}\.json$/)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const payload = JSON.parse(await readFile(downloadPath!, 'utf8'))
  expect(payload.schemaVersion).toBe('1.2')
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
  expect(payload.evidenceIntegrity.algorithm).toBe('SHA-256')
  expect(payload.evidenceIntegrity.digest).toMatch(/^[0-9a-f]{64}$/)
  expect(payload.evidenceIntegrity.coveredThemes).toBe(payload.report.themes.length)
  expect(payload.evidenceIntegrity.coveredClaims).toBe(payload.report.evidenceCoverage.totalClaims)
  expect(payload.evidenceIntegrity.coveredEvidence).toBeGreaterThan(0)
  expect(payload.evidenceIntegrity.schemaVersion).toBe('qling-evidence-chain/2')
  expect(payload.evidenceIntegrity.coverage).toBe('scoped-dataset')
  expect(createHash('sha256').update(payload.evidencePayload).digest('hex')).toBe(payload.evidenceDigest)
  expect(payload.scenarioDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(payload.provenance).toEqual({ products: 'demo', reviews: 'user-provided', policies: 'demo' })
  expect(payload.disclaimer).toContain('不构成法律、财务或销量预测')
})

test('malicious review text stays inert in HTML and exports matching independent digests', async ({ page, context }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const attack = 'The charger gets hot. <img src=x onerror="window.compromised=true"><script>window.compromised=true</script>'
  const quoted = `"${attack.replaceAll('"', '""')}"`
  const csv = `reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\nunsafe-1,gan-65w-a,en-US,1,Hot,${quoted},2026-07-01,true,fixture:unsafe-1`
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles({ name: 'markup.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText('本地 CSV · markup.csv').first()).toBeVisible()
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  const reportBefore = await page.locator('.report-fingerprint').allTextContents()
  const memoDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出高管备忘录/ }).click()
  const memo = await memoDownload
  const html = await readFile((await memo.path())!, 'utf8')
  expect(html).toContain('用户提供 · 未独立核验')
  expect(html).not.toContain('条真实购买评论')
  const preview = await context.newPage()
  await preview.setContent(html)
  await expect(preview.locator('script, svg, [onerror], [onclick]')).toHaveCount(0)
  expect(await preview.evaluate(() => Reflect.get(window, 'compromised'))).toBeUndefined()
  await expect(preview.locator('.evidence-table').first()).toContainText(attack)
  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON' }).click()
  const json = await jsonDownload
  const payload = JSON.parse(await readFile((await json.path())!, 'utf8'))
  expect(reportBefore[0]).toContain(payload.evidenceDigest.toUpperCase())
  expect(reportBefore[1]).toContain(payload.scenarioDigest.toUpperCase())
  expect(html).toContain(payload.evidenceDigest.toUpperCase())
  expect(html).toContain(payload.scenarioDigest.toUpperCase())
  expect(createHash('sha256').update(payload.evidencePayload).digest('hex')).toBe(payload.evidenceDigest)
  await preview.close()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
  await page.getByLabel('售价', { exact: true }).fill('60')
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  const reportAfter = await page.locator('.report-fingerprint').allTextContents()
  expect(reportAfter[0]).toBe(reportBefore[0])
  expect(reportAfter[1]).not.toBe(reportBefore[1])
})

test('invalid personal-data CSV is rejected with a precise message', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles({
    name: 'unsafe.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl,email\nr1,p1,en-US,5,ok,ok,2026-01-01,true,fixture:r1,user@example.com'),
  })
  await expect(page.getByRole('alert')).toContainText('不接受个人信息字段: email')
})

test('CSV with an unknown product reference is rejected', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles({
    name: 'unknown-product.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\nr1,missing-product,en-US,2,Hot,Text,2026-07-01,true,fixture:r1'),
  })
  await expect(page.getByRole('alert')).toContainText('第 2 行 productId: 未在当前商品数据中找到: missing-product')
  await expect(page.getByRole('strong').filter({ hasText: '内置演示样例' })).toBeVisible()
})

test('conflicting duplicate review IDs are rejected without replacing the report', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const rows = [
    'r1,gan-65w-a,en-US,5,Good,First text,2026-07-01,true,fixture:r1',
    'r1,gan-65w-a,en-US,1,Bad,Different text,2026-07-02,true,fixture:r1-copy',
  ].join('\n')
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles({
    name: 'conflict.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\n${rows}`),
  })
  await expect(page.getByRole('alert')).toContainText('第 3 行 reviewId: 与第 2 行重复但内容不一致: r1')
  await expect(page.getByRole('strong').filter({ hasText: '内置演示样例' })).toBeVisible()
})

test('quoted multiline review content imports as one evidence record', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const csv = 'reviewId,productId,locale,rating,title,body,reviewedAt,verifiedPurchase,sourceUrl\nmultiline-1,gan-65w-a,en-US,2,"Hot, then stable","The charger gets hot.\nA second line confirms ""full load"" heat.",2026-07-01,true,fixture:multiline-1'
  await expect(page.getByLabel('预置商品评论 CSV', { exact: true })).toBeEnabled()
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles({ name: 'multiline.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('strong').filter({ hasText: '本地 CSV · multiline.csv' })).toBeVisible()
  await page.getByRole('button', { name: /开始分析/ }).click()
  await expect(page.getByRole('heading', { name: '市场机会，不止一个分数。' })).toBeVisible()
  await page.getByRole('button', { name: /高负载发热/ }).click()
  await expect(page.getByRole('dialog', { name: '证据详情' })).toContainText('Hot, then stable: The charger gets hot.')
  await expect(page.getByRole('dialog', { name: '证据详情' })).toContainText('A second line confirms "full load" heat.')
})

test('market scope keeps policy and competitor evidence aligned', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  await expect(page.getByRole('button', { name: '欧盟', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
  await expect(page.getByText('欧盟 · 中风险')).toBeVisible()
  await expect(page.getByText('美国 · 中风险')).toHaveCount(0)
  await expect(page.getByText('欧盟市场 · EUR')).toBeVisible()
  await expect(page.getByText('美国市场 · USD')).toHaveCount(0)
  await expect(page.getByText('售价（EUR）')).toBeVisible()
  await expect(page.getByLabel('售价')).toHaveValue('45.49')
  // 非美元情景不再沿用 2,500 美元启动成本：留空并要求填写后才给保本销量。
  await expect(page.getByText('启动成本待填写')).toBeVisible()
  await expect(page.getByText('请填写该币种的固定启动成本后再看保本销量。')).toBeVisible()
  await expect(page.getByText(/启动 €2,500/)).toHaveCount(0)
  await expect(page.getByText('$11.19')).toHaveCount(0)

  await page.getByRole('button', { name: '美国', exact: true }).click()
  await expect(page.getByText('美国 · 中风险')).toBeVisible()
  await expect(page.getByText('欧盟 · 中风险')).toHaveCount(0)
  await expect(page.getByText('美国市场 · USD')).toBeVisible()
  await expect(page.getByLabel('售价')).toHaveValue('39.99')
  await expect(page.getByText(/启动 \$2,500/)).toBeVisible()
  await expect(page.getByText(/保本销量/)).toBeVisible()
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
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByText('百炼可用')).toBeVisible()
  await page.getByRole('checkbox', { name: /同意本次在线处理/ }).check()
  await page.getByRole('button', { name: '运行百炼增强' }).click()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
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
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByText('百炼可用')).toBeVisible()
  await page.getByRole('checkbox', { name: /同意本次在线处理/ }).check()
  await page.getByRole('button', { name: '运行百炼增强' }).click()
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
  await page.waitForTimeout(500)
  await expect(page.getByText('过期美国结果')).toHaveCount(0)
  await expect(page.getByText('过期美国政策')).toHaveCount(0)
  await expect(page.getByText('欧盟 · 中风险')).toBeVisible()
  await expect(page.getByText('美国 · 中风险')).toHaveCount(0)
})

test('evidence drawer opens from a pain signal and closes with Escape', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
  await page.getByRole('button', { name: /高负载发热/ }).click()
  await expect(page.getByRole('dialog', { name: '证据详情' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '证据详情' })).toContainText('review-hot-1')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '证据详情' })).toHaveCount(0)
})

test('market evidence row drills into product snapshots', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: /证据与风险/ }).click()
  await page.getByRole('button', { name: /竞品价格带与市场验证/ }).click()
  const drawer = page.getByRole('dialog', { name: '证据详情' })
  await expect(drawer).toContainText('商品快照')
  await expect(drawer).toContainText('gan-65w-a')
  await expect(drawer).toContainText('不代表实时市场')
})

test('report view contains the top actions and print-safe disclaimer', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  await expect(page.getByRole('heading', { name: '决策报告已就绪。' })).toBeVisible()
  await expect(page.locator('.print-report')).toContainText('建议优先执行')
  await expect(page.locator('.print-report')).toContainText('不构成法律、财务或销量预测')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-report')).toBeVisible()
  await expect(page.locator('.report-toolbar')).toBeHidden()
})

test('executive memo export carries the same evidence fingerprint as the evidence JSON', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')

  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON' }).click()
  const payload = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'))

  const memoDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出高管备忘录/ }).click()
  const memo = await memoDownload
  expect(memo.suggestedFilename()).toMatch(/^qling-executive-memo-\d{4}-\d{2}-\d{2}\.html$/)
  const html = await readFile((await memo.path())!, 'utf8')

  const prefix = payload.evidenceIntegrity.digest.slice(0, 32).toUpperCase()
  await expect(page.locator('.report-fingerprint').filter({ hasText: '证据链指纹' })).toContainText(prefix)
  expect(html).toContain('证据链指纹 SHA-256')
  expect(html).toContain(prefix)
  expect(html).not.toContain('哈希校验通过')
})

test('pricing assumptions survive CSV import, market selection and all report exports', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByLabel('预置商品评论 CSV', { exact: true }).setInputFiles(resolve('public/samples/reviews-template.csv'))
  await expect(page.getByText('本地 CSV · reviews-template.csv').first()).toBeVisible()
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  await page.getByRole('button', { name: /市场机会/ }).click()
  await openAdvanced(page, '高级成本模型')
  await page.getByLabel('售价', { exact: true }).fill('50')
  await page.getByLabel('到岸成本', { exact: true }).fill('20')
  await page.getByLabel('固定启动成本', { exact: true }).fill('3000')
  await expect(page.getByText('182 件')).toBeVisible()
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  const reportPricing = page.locator('.report-pricing')
  await expect(reportPricing).toContainText('EUR 50.00')
  await expect(reportPricing).toContainText('EUR 20.00')
  await expect(reportPricing).toContainText('EUR 3,000.00')
  await expect(reportPricing).toContainText('EUR 16.50')
  await expect(reportPricing).toContainText('182 件')

  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON' }).click()
  const payload = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'))
  expect(payload.pricingAssumptions).toEqual({ currency: 'EUR', price: 50, landedCost: 20, fixedLaunchCost: 3000, platformRate: 0.15, adRate: 0.12 })
  expect(payload.pricingStatus).toBe('ready')
  expect(payload.pricingScenario).toMatchObject({ currency: 'EUR', contributionPerUnit: 16.5, contributionMarginRate: 0.33, breakEvenUnits: 182 })

  const memoDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出高管备忘录/ }).click()
  const html = await readFile((await (await memoDownload).path())!, 'utf8')
  for (const value of ['EUR 50.00', 'EUR 20.00', 'EUR 3,000.00', 'EUR 16.50', '182 件']) expect(html).toContain(value)

  await page.emulateMedia({ media: 'print' })
  await expect(reportPricing).toBeVisible()
  await expect(reportPricing).toContainText('182 件')
})

test('incomplete and invalid pricing exports retain inputs without stale break-even results', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await page.getByRole('button', { name: '欧盟', exact: true }).click()
  let evidenceDigest: string | undefined
  for (const scenario of [
    { status: 'missing-launch-cost', cost: '20', launch: '', message: '固定启动成本待填写' },
    { status: 'invalid', cost: '60', launch: '3000', message: '无法形成有效的正贡献情景' },
  ]) {
    await page.getByRole('button', { name: /市场机会/ }).click()
    await openAdvanced(page, '高级成本模型')
    await page.getByLabel('售价', { exact: true }).fill('50')
    await page.getByLabel('到岸成本', { exact: true }).fill(scenario.cost)
    await page.getByLabel('固定启动成本', { exact: true }).fill(scenario.launch)
    await page.getByRole('button', { name: /决策报告/ }).click()
    await openAdvanced(page, '比较两个历史版本')
    const reportPricing = page.locator('.report-pricing')
    await expect(reportPricing).toContainText(scenario.message)
    await expect(reportPricing).toContainText('EUR 50.00')
    await expect(reportPricing.locator('dt').filter({ hasText: '保本销量' })).toHaveCount(0)

    const jsonDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出证据 JSON' }).click()
    const payload = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'))
    expect(payload.pricingStatus).toBe(scenario.status)
    expect(payload.pricingAssumptions).toMatchObject({ currency: 'EUR', price: 50, landedCost: Number(scenario.cost), fixedLaunchCost: scenario.launch === '' ? null : 3000 })
    expect(payload.pricingScenario).toBeNull()
    if (evidenceDigest) expect(payload.evidenceIntegrity.digest).toBe(evidenceDigest)
    evidenceDigest = payload.evidenceIntegrity.digest

    const memoDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /导出高管备忘录/ }).click()
    const html = await readFile((await (await memoDownload).path())!, 'utf8')
    expect(html).toContain(scenario.message)
    expect(html).toContain('EUR 50.00')
    expect(html).not.toContain('<div class="card-label">保本销量</div>')
  }
})

for (const width of [320, 390, 768, 1280]) {
  test(`workspace pages fit and evidence remains accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await openAdvanced(page, '工作区设置')
    await openAdvanced(page, '仅替换演示评论')
    await openAdvanced(page, '字段映射模板')
    const expectPageToFit = async () => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    }
    await expectPageToFit()

    await page.getByRole('button', { name: /开始分析/ }).click()
    await expect(page.locator('.score-table')).toBeVisible()
    await expectPageToFit()
    const signal = page.getByRole('button', { name: /高负载发热/ })
    const signalWidths = await signal.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }))
    expect(signalWidths.scroll).toBe(signalWidths.client)
    await signal.click()
    await expect(page.getByRole('dialog', { name: '证据详情' })).toContainText('review-hot-1')
    await page.keyboard.press('Escape')

    if (width <= 540) {
      const table = page.locator('.competitor-table').first()
      await table.scrollIntoViewIfNeeded()
      const scroll = await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
        return { left: element.scrollLeft, width: element.clientWidth, content: element.scrollWidth }
      })
      expect(scroll.content).toBeGreaterThan(scroll.width)
      expect(scroll.left).toBeGreaterThan(0)
      await expectPageToFit()
    }

    await page.getByRole('button', { name: /证据与风险/ }).click()
    await expect(page.locator('.evidence-matrix')).toBeVisible()
    await expectPageToFit()
    await page.getByRole('button', { name: /决策报告/ }).click()
    await openAdvanced(page, '比较两个历史版本')
    await expect(page.locator('.print-report')).toBeVisible()
    await expectPageToFit()
  })
}
