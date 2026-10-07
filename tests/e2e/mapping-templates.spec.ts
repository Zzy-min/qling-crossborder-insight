import { openAdvanced, analyzeAndOpenReport } from './advanced-controls'
import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cpus, totalmem, release } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const products = '编号,商品名称,市场,币种,售价,采集日\nSKU,Sample charger,US,USD,30,2026-10-06'
const reviews = 'RID,PID,语言,星级,评价,日期\nR1,SKU,en-US,2,charger gets hot,2026-10-06'
const mappings = { products: { productId: '编号', title: '商品名称', market: '市场', currency: '币种', price: '售价', capturedAt: '采集日' }, reviews: { reviewId: 'RID', productId: 'PID', locale: '语言', rating: '星级', body: '评价', reviewedAt: '日期' } }

async function readFields(page: Page, productCsv = products, reviewCsv = reviews) {
  for (const [label, csv] of [['商品 CSV', productCsv], ['评论 CSV', reviewCsv]]) await page.getByLabel(label, { exact: true }).setInputFiles({ name: `${label}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: '读取字段', exact: true }).click()
  await page.getByLabel('products-productId').waitFor()
}
async function map(page: Page) {
  for (const [kind, mapping] of Object.entries(mappings)) for (const [field, column] of Object.entries(mapping)) await page.getByLabel(`${kind}-${field}`, { exact: true }).selectOption(column)
  await page.getByRole('button', { name: '校验并预览' }).click()
  await expect(page.getByText('预览：1 款商品 / 1 条评论 / 去重 0 条')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/health', route => route.fulfill({ json: { providerConfigured: false } }))
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
})

test('mapping templates restore and explicitly apply reordered headers without persisting data or bypassing confirmation', async ({ page }) => {
  const outDir = resolve(`artifacts/product-improvement/mapping-templates-${Date.now()}`)
  await mkdir(outDir, { recursive: true })
  await readFields(page); await map(page)
  const library = page.getByRole('region', { name: '本机字段映射模板' })
  await library.getByLabel('映射模板名称').fill('卖家中文字段')
  await library.getByRole('button', { name: '保存已校验映射为模板' }).click()
  await expect(library.getByRole('status')).toContainText('已保存映射模板')
  const templateId = await library.getByLabel('已保存映射模板').inputValue()
  const event = page.waitForEvent('download')
  await library.getByRole('button', { name: '下载映射模板 JSON' }).click()
  const backup = await readFile((await (await event).path())!, 'utf8')
  const metadata = JSON.parse(backup)
  expect(metadata.schemaVersion).toBe('qling-mapping-template/1')
  expect(backup).not.toContain('charger gets hot')
  expect(metadata).not.toHaveProperty('dataset')
  await page.getByRole('checkbox', { name: /我有权使用这些数据/ }).check()
  await library.getByRole('button', { name: '应用所选映射模板' }).click()
  await expect(page.getByRole('button', { name: '确认导入工作区' })).toHaveCount(0)
  await page.reload()
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const reverse = (csv: string) => csv.split('\n').map(row => row.split(',').reverse().join(',')).join('\n')
  await readFields(page, reverse(products), reverse(reviews))
  await expect(page.getByLabel('products-productId')).toHaveValue('')
  await library.getByLabel('已保存映射模板').selectOption(templateId)
  await library.getByRole('button', { name: '应用所选映射模板' }).click()
  await expect(page.getByLabel('products-productId')).toHaveValue('编号')
  await expect(page.getByLabel('products-market')).toHaveValue('市场')
  await page.getByRole('button', { name: '校验并预览' }).click()
  await expect(page.getByRole('button', { name: '确认导入工作区' })).toBeDisabled()
  const widths = []
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const measured = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(measured.scroll).toBe(measured.client)
    widths.push({ width, ...measured })
    if ([390, 1280].includes(width)) await library.screenshot({ path: `${outDir}/library-${width}.png`, style: '.topbar { visibility: hidden; }' })
  }
  await readFields(page, products.replace('编号', '新编号'))
  await library.getByRole('button', { name: '应用所选映射模板' }).click()
  await expect(library.getByRole('alert')).toContainText('表头集合不匹配')
  await expect(page.getByLabel('products-productId')).toHaveValue('')
  await library.getByLabel('恢复映射模板备份').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(backup) })
  await expect(library.getByLabel('已保存映射模板').locator('option')).toHaveCount(3)
  expect(await library.getByLabel('已保存映射模板').inputValue()).not.toBe(templateId)
  await library.getByLabel('恢复映射模板备份').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...metadata, apiKey: 'synthetic' })) })
  await expect(library.getByRole('alert')).toContainText('模板备份无效')
  await expect(library.getByLabel('已保存映射模板').locator('option')).toHaveCount(3)
  await writeFile(`${outDir}/render-check.json`, JSON.stringify({ widths, source: 'synthetic CSV and mapping metadata, no network upload' }, null, 2), { flag: 'wx' })
  console.log(`Mapping template render evidence: ${outDir}`)
})

test('template quota failure stays unsaved, downloadable and retryable without affecting workspace', async ({ page }) => {
  await readFields(page); await map(page)
  const library = page.getByRole('region', { name: '本机字段映射模板' })
  await library.getByLabel('映射模板名称').fill('Quota test')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    Reflect.set(window, 'restoreTemplateAdd', () => { IDBObjectStore.prototype.add = original })
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'mappingTemplates') throw new DOMException('Quota full', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await library.getByRole('button', { name: '保存已校验映射为模板' }).click()
  await expect(library.getByRole('alert')).toContainText('未保存')
  await expect(library.getByLabel('已保存映射模板').locator('option')).toHaveCount(1)
  const event = page.waitForEvent('download')
  await library.getByRole('button', { name: '下载未保存映射模板备份' }).click()
  const draft = JSON.parse(await readFile((await (await event).path())!, 'utf8'))
  expect(draft.name).toBe('Quota test')
  await page.evaluate(() => Reflect.get(window, 'restoreTemplateAdd')())
  await library.getByRole('button', { name: '重试保存映射模板' }).click()
  await expect(library.getByRole('status')).toContainText('已保存映射模板')
  await expect(page.getByText('预览：1 款商品 / 1 条评论 / 去重 0 条')).toBeVisible()
})

for (const profile of ['short', 'varied'] as const) {
test(`10,000 ${profile} synthetic reviews reach preview within recorded local performance target without blocking heartbeat`, async ({ page, browser }) => {
  const rows = Array.from({ length: 10_000 }, (_, index) => `R${index},SKU,en-US,2,charger gets hot${profile === 'varied' ? ' synthetic context'.repeat(10 + index % 70) : ''},2026-10-06`)
  const productCsv = 'productId,title,market,currency,price,capturedAt\nSKU,Sample charger,US,USD,30,2026-10-06'
  const reviewCsv = 'reviewId,productId,locale,rating,body,reviewedAt\n' + rows.join('\n')
  for (const [label, csv] of [['商品 CSV', productCsv], ['评论 CSV', reviewCsv]]) await page.getByLabel(label, { exact: true }).setInputFiles({ name: `${label}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.evaluate(() => {
    const metrics = { start: performance.now(), ticks: 0, last: performance.now(), maxGap: 0, duration: 0 }
    Reflect.set(window, 'importPerformance', metrics)
    const timer = setInterval(() => { const now = performance.now(); metrics.maxGap = Math.max(metrics.maxGap, now - metrics.last); metrics.last = now; metrics.ticks += 1 }, 16)
    Reflect.set(window, 'stopImportPerformance', () => { clearInterval(timer); metrics.duration = performance.now() - metrics.start; return metrics })
  })
  await page.getByRole('button', { name: '读取字段', exact: true }).click()
  await page.getByLabel('products-productId').waitFor()
  await page.getByRole('button', { name: '校验并预览' }).click()
  await expect(page.getByText('预览：1 款商品 / 10000 条评论 / 去重 0 条')).toBeVisible()
  const metrics = await page.evaluate(() => Reflect.get(window, 'stopImportPerformance')())
  const outDir = resolve(`artifacts/product-improvement/import-performance-${Date.now()}`)
  await mkdir(outDir, { recursive: true })
  const sourceHashes = Object.fromEntries(await Promise.all(['src/components/DatasetImport.tsx', 'src/components/MappingTemplateLibrary.tsx', 'src/domain/dataset-import.ts', 'src/domain/csv.ts', 'src/workers/dataset-import.worker.ts', 'src/domain/mapping-template.ts', 'src/domain/workspace.ts', 'src/App.tsx', 'vite.config.ts', 'package-lock.json', 'tests/e2e/mapping-templates.spec.ts'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  const environment = { cpu: cpus()[0].model, logicalCpus: cpus().length, memoryBytes: totalmem(), osRelease: release(), node: process.version, browser: browser.version(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), worktree: 'uncommitted implementation; HEAD is not a full patch identity', userAgent: await page.evaluate(() => navigator.userAgent) }
  const evidence = { source: `10,000 synthetic ${profile} reviews; no seller data or live model`, bytes: Buffer.byteLength(productCsv + reviewCsv), inputDigest: { products: createHash('sha256').update(productCsv).digest('hex'), reviews: createHash('sha256').update(reviewCsv).digest('hex') }, sourceHashes, metrics, environment, targetMs: 5000, maxHeartbeatGapTargetMs: 200, scope: 'read headers + manual UI validation click + Worker parse + preview render; no IndexedDB commit or analysis', concurrency: 'one Playwright worker for isolated run; check:all may run four workers', targetMet: metrics.duration <= 5000, heartbeatActive: metrics.ticks > 0, responsivenessTargetMet: metrics.maxGap <= 200 }
  await writeFile(`${outDir}/measurement.json`, JSON.stringify(evidence, null, 2), { flag: 'wx' })
  expect(metrics.ticks).toBeGreaterThan(0)
  expect(metrics.duration).toBeLessThanOrEqual(5000)
  expect(metrics.maxGap).toBeLessThanOrEqual(200)
  console.log(`Import performance evidence: ${outDir}; ${metrics.duration.toFixed(1)} ms; max heartbeat gap ${metrics.maxGap.toFixed(1)} ms`)
})
}
