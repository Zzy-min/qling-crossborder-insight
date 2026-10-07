import { openAdvanced, analyzeAndOpenReport } from './advanced-controls'
import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateAnchoredImageRequest } from '../../server/image-contract.mjs'

test('native PNG JPEG and WebP dimensions agree with bounded header inspection', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const types = await page.evaluate(async () => {
    const { rasterDimensions } = await import('/src/domain/raster-dimensions.ts')
    const canvas = document.createElement('canvas'); canvas.width = 3; canvas.height = 2
    canvas.getContext('2d')!.fillRect(0, 0, 3, 2)
    const results = []
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type))
      const dimensions = rasterDimensions(new Uint8Array(await blob.arrayBuffer()), blob.type, { dimension: 4096, pixels: 4_194_304 })
      const bitmap = await createImageBitmap(blob)
      results.push({ type: blob.type, header: dimensions, native: { width: bitmap.width, height: bitmap.height } }); bitmap.close()
    }
    return results
  })
  expect(types).toEqual(['image/png', 'image/jpeg', 'image/webp'].map(type => ({ type, header: { width: 3, height: 2 }, native: { width: 3, height: 2 } })))
})

test('native browser decodes and restores a bound Blob, rejecting header-only images without losing saved data', async ({ page }) => {
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const result = await page.evaluate(async paths => {
    const { buildInsightReport } = await import(paths[0])
    const { createAnalysisRun } = await import(paths[1])
    const { buildPricingScenario } = await import(paths[2])
    const { initialProductPricing } = await import(paths[3])
    const { createConceptImageRequest, conceptImageBinding } = await import(paths[4])
    const { ProxyProvider } = await import(paths[5])
    const { WorkspaceDatabase } = await import(paths[6])
    const { sha256Hex } = await import(paths[7])
    const { conceptImageFileBackup, readConceptImageFileBackup } = await import(paths[8])
    const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
    const dataset = { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } }
    const run = createAnalysisRun('image-test-workspace', buildInsightReport(dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
    const theme = run.report.themes[0]
    const request = createConceptImageRequest(run, theme.id, [theme.evidence[0].quoteAnchor], 'Untested synthetic concept')
    const metadata = { imageId: '0123456789abcdef', mediaType: 'image/png', model: 'synthetic-no-model-call', reviewIds: ['R1'], binding: conceptImageBinding(request), cached: false }
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2, 2)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    let calls = 0
    const provider = new ProxyProvider({ fetcher: async () => { calls += 1; return new Response(blob, { headers: { 'content-type': 'image/png' } }) } })
    const db = new WorkspaceDatabase(`qling-image-test-${crypto.randomUUID()}`)
    try {
      await db.saveAnalysisRun(run)
      const file = await provider.downloadAnchoredConceptImage(run, theme.id, metadata)
      await db.saveConceptImage(file)
      db.close(); await db.open()
      const restored = await db.listConceptImages(run.workspaceId)
      const restoredBlob = restored[0].blob
      const backup = await conceptImageFileBackup(restored[0], run)
      const recovered = await readConceptImageFileBackup(backup)
      const imageUrl = URL.createObjectURL(restoredBlob)
      const image = new Image(); image.src = imageUrl
      await image.decode()
      const natural = { width: image.naturalWidth, height: image.naturalHeight }
      URL.revokeObjectURL(imageUrl)
      let invalidRejected = false
      const invalidProvider = new ProxyProvider({ fetcher: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), { headers: { 'content-type': 'image/png' } }) })
      try { await invalidProvider.downloadAnchoredConceptImage(run, theme.id, metadata) } catch { invalidRejected = true }
      return { count: await db.conceptImages.count(), calls, width: restored[0].width, height: restored[0].height, natural, digestMatches: sha256Hex(new Uint8Array(await blob.arrayBuffer())) === restored[0].fileDigest, sameBytes: blob.size === restoredBlob.size, backupMatches: recovered.file.recordDigest === restored[0].recordDigest && recovered.run.archiveDigest === run.archiveDigest && sha256Hex(new Uint8Array(await recovered.file.blob.arrayBuffer())) === restored[0].fileDigest, invalidRejected, identity: restored[0].identity }
    } finally { await db.delete() }
  }, ['/src/domain/analysis.ts', '/src/domain/analysis-run.ts', '/src/domain/market.ts', '/src/domain/product-pricing.ts', '/src/domain/concept-image.ts', '/src/providers/provider.ts', '/src/domain/workspace.ts', '/src/domain/integrity.ts', '/src/domain/concept-image-file.ts'])
  expect(result).toEqual({ count: 1, calls: 1, width: 2, height: 2, natural: { width: 2, height: 2 }, digestMatches: true, sameBytes: true, backupMatches: true, invalidRejected: true, identity: 'unverified-concept-reference' })
})

test('workspace UI exports images in v6, restores their original provenance, and rejects corrupt bytes atomically', async ({ page }) => {
  await page.route('**/health', route => route.fulfill({ json: { providerConfigured: true, providerEndpoint: 'https://synthetic-image.example' } }))
  await page.goto('/')
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  const paths = ['/src/domain/analysis.ts', '/src/domain/analysis-run.ts', '/src/domain/market.ts', '/src/domain/product-pricing.ts', '/src/domain/concept-image.ts', '/src/domain/workspace.ts', '/src/domain/concept-image-file.ts']
  const original = await page.evaluate(async paths => {
    const { buildInsightReport } = await import(paths[0])
    const { createAnalysisRun } = await import(paths[1])
    const { buildPricingScenario } = await import(paths[2])
    const { initialProductPricing } = await import(paths[3])
    const { createConceptImageRequest, conceptImageBinding } = await import(paths[4])
    const { workspaceDatabase } = await import(paths[5])
    const { createConceptImageFile } = await import(paths[6])
    const product = { productId: 'SKU', title: 'Synthetic', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }
    const snapshot = { version: 2, id: crypto.randomUUID(), name: 'Synthetic images', updatedAt: new Date().toISOString(), pricingProductId: 'SKU', productScenarios: {}, deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL', pricing: initialProductPricing(product), scenarios: {}, dataset: { products: [product], reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } } }
    const run = createAnalysisRun(snapshot.id, buildInsightReport(snapshot.dataset), { category: '用户商品集合', sourceLabel: 'Synthetic', marketScope: 'ALL', dataset: snapshot.dataset, pricingScenario: buildPricingScenario(snapshot.pricing, product) }, 'local')
    const theme = run.report.themes[0]
    const request = createConceptImageRequest(run, theme.id, [theme.evidence[0].quoteAnchor], 'Untested synthetic concept')
    const response = { imageId: '0123456789abcdef', mediaType: 'image/png', model: 'synthetic', reviewIds: ['R1'], binding: conceptImageBinding(request), cached: false }
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    const file = await createConceptImageFile(run, theme.id, response, blob)
    await workspaceDatabase.save(snapshot); await workspaceDatabase.saveAnalysisRun(run); await workspaceDatabase.saveConceptImage(file)
    return { workspaceId: snapshot.id, runId: run.id, recordDigest: file.recordDigest, fileDigest: file.fileDigest }
  }, paths)
  await page.reload()
  await openAdvanced(page, '工作区设置')
  await openAdvanced(page, '仅替换演示评论')
  await openAdvanced(page, '字段映射模板')
  await expect(page.getByText('用户工作区 · Synthetic images', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  await expect(page.getByRole('button', { name: '查看历史报告' })).toHaveCount(1)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出工作区 JSON 备份' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('qling-workspace-backup-v6.json')
  const text = await readFile((await download.path())!, 'utf8')
  const parsed = JSON.parse(text)
  expect(parsed.schemaVersion).toBe('qling-workspace-backup/6')
  expect(parsed.conceptImages).toHaveLength(1)
  await page.getByLabel('恢复工作区备份', { exact: true }).setInputFiles({ name: 'with-images.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect.poll(() => page.evaluate(async path => { const { workspaceDatabase } = await import(path); return (await workspaceDatabase.restore())?.id }, paths[5])).not.toBe(original.workspaceId)
  const restored = await page.evaluate(async path => {
    const { workspaceDatabase } = await import(path)
    const snapshot = await workspaceDatabase.restore()
    const images = await workspaceDatabase.listConceptImages(snapshot.id)
    return { workspaceId: snapshot.id, runId: images[0].runId, fileDigest: images[0].fileDigest, responseWorkspaceId: images[0].response.binding.workspaceId, sourceRecordDigest: images[0].origin.image.recordDigest, schemaVersion: images[0].schemaVersion, count: await workspaceDatabase.conceptImages.count() }
  }, paths[5])
  expect(restored.workspaceId).not.toBe(original.workspaceId)
  expect(restored.runId).not.toBe(original.runId)
  expect(restored.fileDigest).toBe(original.fileDigest)
  expect(restored.responseWorkspaceId).toBe(original.workspaceId)
  expect(restored.sourceRecordDigest).toBe(original.recordDigest)
  expect(restored.schemaVersion).toBe('qling-concept-image-file/2')
  expect(restored.count).toBe(2)
  const nested = JSON.parse(parsed.conceptImages[0]); nested.data = 'aW52YWxpZA=='
  parsed.conceptImages[0] = JSON.stringify(nested)
  await page.getByLabel('恢复工作区备份', { exact: true }).setInputFiles({ name: 'corrupt-images.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(parsed)) })
  await expect(page.getByRole('alert')).toContainText('备份恢复未生效，原工作区保持不变')
  const after = await page.evaluate(async path => { const { workspaceDatabase } = await import(path); return { id: (await workspaceDatabase.restore()).id, count: await workspaceDatabase.conceptImages.count() } }, paths[5])
  expect(after).toEqual({ id: restored.workspaceId, count: 2 })
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
  await page.getByRole('button', { name: '查看历史报告' }).click()
  await openAdvanced(page, '评论语义人工复核')
  await openAdvanced(page, '验证任务（高级）')
  await openAdvanced(page, '已保存概念图')
  const gallery = page.getByRole('region', { name: '已保存概念参考图' })
  await expect(gallery.getByRole('status').first()).toContainText('已校验 1 张')
  await expect(gallery.getByText('从备份恢复，原生成绑定保留', { exact: false })).toBeVisible()
  await expect(gallery.getByRole('img')).toBeVisible()
  expect(await gallery.getByRole('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 2)).toBe(true)
  const imageDownloadEvent = page.waitForEvent('download')
  await gallery.getByRole('button', { name: '下载单张概念图备份' }).click()
  const imageDownload = await imageDownloadEvent
  const single = JSON.parse(await readFile((await imageDownload.path())!, 'utf8'))
  expect(single.schemaVersion).toBe('qling-concept-image-backup/1')
  expect(single.image.origin.image.recordDigest).toBe(original.recordDigest)
  expect(single.image.response.binding.workspaceId).toBe(original.workspaceId)
  expect(single.image.fileDigest).toBe(original.fileDigest)
  expect(JSON.stringify(single)).not.toContain('apiKey')
  const generator = page.getByRole('region', { name: '生成绑定原文的概念参考图' })
  await expect(generator.getByRole('button', { name: '生成并保存概念参考图' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '同意本次在线处理（分析或参考图生成）' }).check()
  await generator.getByLabel('生图改良假设', { exact: true }).fill('Untested ventilation concept')
  await generator.getByRole('checkbox', { name: '同意发送该历史快照并生成未验证概念图' }).check()
  let generated = 0
  let hold = true
  await page.route('**/api/images', async route => {
    generated += 1
    const input = route.request().postDataJSON()
    const checked = validateAnchoredImageRequest(input)
    if (hold) { await new Promise(resolve => setTimeout(resolve, 300)); }
    await route.fulfill({ json: { imageId: 'fedcba9876543210', mediaType: 'image/png', model: 'synthetic-no-real-call', reviewIds: checked.reviewIds, binding: checked.binding, cached: false } }).catch(() => {})
  })
  await page.route('**/api/images/fedcba9876543210', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(single.data, 'base64') }))
  await generator.getByRole('button', { name: '生成并保存概念参考图' }).click()
  await expect.poll(() => generated).toBe(1)
  await generator.getByRole('button', { name: '取消图片操作' }).click()
  await expect(generator.getByRole('status')).toContainText('操作已取消')
  expect(await page.evaluate(async path => { const { workspaceDatabase } = await import(path); return workspaceDatabase.conceptImages.count() }, paths[5])).toBe(2)
  hold = false
  await page.evaluate(async path => {
    const { workspaceDatabase } = await import(path)
    const originalSave = workspaceDatabase.saveConceptImage.bind(workspaceDatabase)
    workspaceDatabase.saveConceptImage = async () => { workspaceDatabase.saveConceptImage = originalSave; throw new DOMException('synthetic quota failure', 'QuotaExceededError') }
  }, paths[5])
  await generator.getByRole('button', { name: '生成并保存概念参考图' }).click()
  await expect(generator.getByRole('status')).toContainText('保存失败')
  await page.getByRole('button', { name: '导出工作区 JSON 备份' }).click()
  await expect(page.getByText('完整备份未导出：图片操作未完成或图片尚未保存，请先取消、重试保存或下载未保存图片备份。', { exact: true })).toBeVisible()
  const unsavedEvent = page.waitForEvent('download')
  await generator.getByRole('button', { name: '下载未保存图片备份' }).click()
  const unsavedDownload = await unsavedEvent
  const unsaved = JSON.parse(await readFile((await unsavedDownload.path())!, 'utf8'))
  expect(unsaved.image.response.binding.workspaceId).toBe(restored.workspaceId)
  await page.getByRole('checkbox', { name: '同意本次在线处理（分析或参考图生成）' }).uncheck()
  await generator.getByRole('button', { name: '仅重试本机图片保存' }).click()
  await expect(generator.getByRole('status')).toContainText('已保存到本机')
  await expect(gallery.getByRole('status').first()).toContainText('已校验 2 张')
  expect(generated).toBe(2)
  const directory = resolve(`artifacts/product-improvement/image-workspace-backup-${Date.now()}`)
  await mkdir(directory, { recursive: true })
  const reportImages = page.getByRole('region', { name: '报告概念参考图' })
  await expect(reportImages.getByRole('img')).toHaveCount(2)
  const jsonEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出证据 JSON', exact: true }).click()
  const jsonDownload = await jsonEvent
  const reportJson = JSON.parse(await readFile((await jsonDownload.path())!, 'utf8'))
  expect(reportJson.schemaVersion).toBe('1.7')
  expect(reportJson.imageReport.images).toHaveLength(2)
  expect(reportJson.imageReport.images.find((entry: { metadata: { schemaVersion: string } }) => entry.metadata.schemaVersion === 'qling-concept-image-file/2').metadata.origin.image.recordDigest).toBe(original.recordDigest)
  const memoEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '📄 导出高管备忘录 HTML', exact: true }).click()
  const memoDownload = await memoEvent
  const html = await readFile((await memoDownload.path())!, 'utf8')
  expect(html).toContain(reportJson.imageReport.digest)
  expect(html).toContain('从备份恢复，保留原生成绑定')
  const memoPage = await page.context().newPage()
  const externalRequests: string[] = []
  await memoPage.route('**/*', route => { externalRequests.push(route.request().url()); return route.abort() })
  await memoPage.setContent(html)
  await expect(memoPage.getByAltText('未验证概念参考图')).toHaveCount(2)
  await expect.poll(() => memoPage.getByAltText('未验证概念参考图').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 2))).toBe(true)
  expect(externalRequests).toEqual([])
  for (const width of [390, 1280]) {
    await memoPage.setViewportSize({ width, height: 900 })
    expect(await memoPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await memoPage.locator('.saved-image-report').screenshot({ path: resolve(directory, `memo-images-${width}.png`) })
  }
  await memoPage.pdf({ path: resolve(directory, 'offline-image-memo.pdf'), format: 'A4', printBackground: true })
  await memoPage.close()
  await page.evaluate(() => { (window as unknown as { imagePrintCount: number }).imagePrintCount = 0; window.print = () => { (window as unknown as { imagePrintCount: number }).imagePrintCount = document.querySelectorAll('.print-report .report-saved-images img').length } })
  await page.getByRole('button', { name: '🖨️ 打印 / 保存 PDF', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { imagePrintCount: number }).imagePrintCount)).toBe(2)
  await page.emulateMedia({ media: 'print' })
  await expect(reportImages.getByRole('img').first()).toBeVisible()
  await page.pdf({ path: resolve(directory, 'workspace-image-report.pdf'), format: 'A4', printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(directory, `backup-${width}.png`), fullPage: true })
    await gallery.screenshot({ path: resolve(directory, `gallery-${width}.png`) })
    await generator.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(directory, `generator-viewport-${width}.png`) })
  }
  await page.evaluate(async path => {
    const { workspaceDatabase } = await import(path)
    const current = await workspaceDatabase.restore()
    const files = await workspaceDatabase.conceptImages.where('workspaceId').equals(current.id).toArray()
    await workspaceDatabase.conceptImages.update(files[0].id, { blob: new Blob(['corrupt'], { type: 'image/png' }) })
  }, paths[5])
  await gallery.getByRole('button', { name: '重读已保存图片' }).click()
  await expect(gallery.getByRole('alert')).toContainText('图片读取或校验失败')
  await expect(gallery.getByRole('img')).toHaveCount(0)
  await expect(gallery.getByRole('button', { name: '下载单张概念图备份' })).toHaveCount(0)
  let unexpectedDownload = false
  page.on('download', () => { unexpectedDownload = true })
  await page.getByRole('button', { name: '📄 导出高管备忘录 HTML', exact: true }).click()
  await expect(page.getByText('备忘录未导出：图片或完整报告校验失败/超过 20 MiB，未悄悄遗漏图片；原数据保留。', { exact: true })).toBeVisible()
  expect(unexpectedDownload).toBe(false)
  await page.getByRole('button', { name: '重新校验报告图片' }).click()
  await expect(page.getByText('报告图片读取或校验失败，未遗漏图片生成报告；原数据保留。请重读检查。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '📄 导出高管备忘录 HTML', exact: true })).toBeDisabled()
  expect(await page.evaluate(async path => { const { workspaceDatabase } = await import(path); return workspaceDatabase.conceptImages.count() }, paths[5])).toBe(3)
  console.log(`Image backup render evidence: ${directory}`)
})
