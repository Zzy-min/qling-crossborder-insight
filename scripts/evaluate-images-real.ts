import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createApiServer } from '../server/app.mjs'
import { buildInsightReport } from '../src/domain/analysis'
import { createAnalysisRun } from '../src/domain/analysis-run'
import { initialProductPricing } from '../src/domain/product-pricing'
import { buildPricingScenario } from '../src/domain/market'
import { createConceptImageRequest, validateConceptImageResponse } from '../src/domain/concept-image'
import { sha256Hex } from '../src/domain/integrity'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { createImageDownloader, isPublicImageAddress } from '../server/download-image.mjs'

if (!process.env.BAILIAN_API_KEY) throw new Error('Missing local configuration; no request sent')
const product = { productId: 'synthetic-image-product', title: 'Synthetic charger concept, not a real commercial product', brand: '', market: 'US' as const, currency: 'USD' as const, price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-07', sourceUrl: null }
const dataset = { products: [product], reviews: [{ reviewId: 'synthetic-image-review', productId: product.productId, locale: 'en-US', rating: 2, title: '', body: 'Synthetic test report: charger gets hot during use.', reviewedAt: '2026-10-07', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided' as const, reviews: 'user-provided' as const, policies: 'unknown' as const } }
const run = createAnalysisRun('synthetic-image-evaluation', buildInsightReport(dataset), { category: 'Synthetic evaluation', sourceLabel: 'Synthetic authorized test, not seller evidence', marketScope: 'ALL', dataset, pricingScenario: buildPricingScenario(initialProductPricing(product), product) }, 'local')
const theme = run.report.themes.find(entry => entry.evidence.some(evidence => evidence.quoteAnchor))!
const request = createConceptImageRequest(run, theme.id, [theme.evidence.find(entry => entry.quoteAnchor)!.quoteAnchor!], 'Untested synthetic ventilation concept; no performance claims or certifications.')
let calls = 0
let upstreamStatus: number | null = null
let responseStructure: Record<string, unknown> = {}
let downloadDiagnostics: Record<string, unknown> = {}
let usage: Record<string, number> | null = null
const server = createApiServer({ apiKey: process.env.BAILIAN_API_KEY, baseUrl: process.env.BAILIAN_BASE_URL, model: process.env.BAILIAN_MODEL,
  imageDownloader: createImageDownloader({
    lookup: async (hostname: string, options: { all: true }) => {
      try {
        const addresses = await lookup(hostname, options)
        downloadDiagnostics = { dnsCount: addresses.length, addresses: addresses.map(entry => ({ family: entry.family, public: isPublicImageAddress(entry.address), fakeIpReservedRange: /^198\.(18|19)\./.test(entry.address) })) }
        return addresses
      } catch (error) { downloadDiagnostics = { dnsError: (error as { code?: string }).code ?? 'unknown' }; throw error }
    },
    request: (...args: Parameters<typeof httpsRequest>) => {
      const request = httpsRequest(...args)
      request.on('error', error => { const code = (error as { code?: string }).code; downloadDiagnostics.connectionError = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'unknown' })
      return request
    },
  }),
  fetcher: async (input: RequestInfo | URL, options: RequestInit) => {
    if (++calls > 1) throw new Error('Diagnostic call limit exceeded')
    const response = await fetch(input, options); upstreamStatus = response.status
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []; let length = 0
    if (!reader) return response
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break
        length += next.value.length
        if (length > 2000000) throw new Error('Diagnostic response exceeds limit')
        chunks.push(next.value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    const safeKeys = (value: unknown) => value && typeof value === 'object' ? Object.keys(value).filter(key => /^[a-zA-Z_]{1,50}$/.test(key)).slice(0, 20) : []
    try {
      const body = JSON.parse(bytes.toString('utf8'))
      usage = body.usage && typeof body.usage === 'object' ? Object.fromEntries(Object.entries(body.usage).filter(([key, value]) => /^[A-Za-z_]{1,50}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0).slice(0, 20)) as Record<string, number> : null
      responseStructure = { contentType: response.headers.get('content-type')?.split(';')[0], keys: safeKeys(body), outputKeys: safeKeys(body.output), errorKeys: safeKeys(body.error), choices: Array.isArray(body.choices) ? body.choices.length : null,
        code: typeof body.code === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(body.code) ? body.code : null,
        outputType: typeof body.output, choiceContentType: typeof body.choices?.[0]?.message?.content }
    } catch { responseStructure = { json: false, bytes: bytes.length } }
    return new Response(bytes, { status: response.status, headers: response.headers })
  } })
await new Promise<void>(complete => server.listen(0, '127.0.0.1', complete))
const address = server.address() as { port: number }
const directory = resolve(`artifacts/product-improvement/image-real-${Date.now()}`)
const result: Record<string, unknown> = { dataIdentity: 'synthetic-only', dataDigest: request.dataDigest, promptVersion: 'qling-image-evidence/2', realCalls: 0, upstreamStatus: null, nativeDecodeVerified: false, semanticQualityVerified: false, usage: null }
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(170000) })
  result.proxyStatus = response.status
  const body = await response.json()
  if (response.ok) {
    const metadata = validateConceptImageResponse(body, request)
    const downloaded = await fetch(`http://127.0.0.1:${address.port}/api/images/${metadata.imageId}`, { signal: AbortSignal.timeout(30000) })
    if (!downloaded.ok) throw new Error('Local image download failed')
    const bytes = new Uint8Array(await downloaded.arrayBuffer())
    if (!bytes.length || bytes.length > 4000000) throw new Error('Invalid image bytes')
    await mkdir(directory, { recursive: true })
    const extension = metadata.mediaType === 'image/jpeg' ? 'jpg' : metadata.mediaType === 'image/webp' ? 'webp' : 'png'
    await writeFile(resolve(directory, `concept.${extension}`), bytes)
    result.image = { model: metadata.model, mediaType: metadata.mediaType, bytes: bytes.length, fileDigest: sha256Hex(bytes), bindingDigest: metadata.binding.bindingDigest }
    result.outcome = 'bound-image-downloaded-native-and-semantic-review-pending'
  } else { result.outcome = typeof body.error === 'string' && /^[a-z_]+$/.test(body.error) ? body.error : 'proxy_error'; result.reason = typeof body.reason === 'string' && /^[a-z_]+$/.test(body.reason) ? body.reason : null }
} catch { result.outcome = 'network-or-validation-failure' }
finally {
  result.realCalls = calls; result.upstreamStatus = upstreamStatus; result.responseStructure = responseStructure; result.downloadDiagnostics = downloadDiagnostics; result.usage = usage
  await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2))
  server.closeAllConnections(); await new Promise<void>(complete => server.close(() => complete()))
  console.log(JSON.stringify({ directory, ...result }))
}
