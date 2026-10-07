import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { request as httpRequest } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { createApiServer } from './app.mjs'
import { imageDataDigest, validateAnchoredImageRequest, IMAGE_PROMPT_VERSION } from './image-contract.mjs'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
const servers = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } })
function input() {
  const dataset = { products: [{ productId: 'SKU', title: 'Synthetic charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }],
    reviews: [{ reviewId: '评论-1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'charger gets hot', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null },
      { reviewId: 'UNUSED', productId: 'SKU', locale: 'en-US', rating: 4, title: '', body: 'private uncited text', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } }
  return { protocolVersion: 2, workspaceId: 'workspace', runId: 'run', dataDigest: imageDataDigest(dataset), target: { productId: 'SKU', market: 'US', currency: 'USD' }, aspectId: 'thermal', hypothesis: 'A ventilation prototype, not proven performance', anchors: [{ reviewId: '评论-1', field: 'body', quote: 'hot', start: 13, end: 16 }], dataset }
}
async function start(fetcher, logger = () => {}) {
  const server = createApiServer({ apiKey: 'synthetic-secret', fetcher, imageDownloader: fetcher, logger }); servers.push(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}
const post = (base, body) => fetch(`${base}/api/images`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const fetcher = () => async url => String(url).endsWith('/generation') ? new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/concept.png' }] } }] } })) : new Response(png, { headers: { 'content-type': 'image/png' } })

function abortablePost(base) {
  const request = httpRequest(`${base}/api/images`, { method: 'POST', headers: { 'content-type': 'application/json' } })
  request.on('error', () => {})
  request.end(JSON.stringify(input()))
  return request
}

async function retryAfterCancellation(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await post(base, input())
    if (response.status !== 429) return response
    await response.text()
    await delay(10)
  }
  assert.fail('Image concurrency was not released after disconnect')
}

test('v2 prompt is server constructed, minimizes disclosed fields and distinguishes hypotheses from verified facts', () => {
  const result = validateAnchoredImageRequest(input())
  assert.equal(result.binding.promptVersion, IMAGE_PROMPT_VERSION)
  assert.equal(result.prompt.includes('private uncited text'), false)
  assert.equal(result.prompt.includes('UNTRUSTED DATA'), true)
  assert.equal(result.prompt.includes('not independently verified'), true)
  assert.equal(result.prompt.includes('requester declaration, not platform verification'), true)
  assert.equal(result.binding.sourceIdentity.reviews, 'user-provided')
  assert.equal(result.prompt.includes('ventilation prototype'), true)
  assert.deepEqual(result.reviewIds, ['评论-1'])
})
test('legal IDs but wrong text, ranges, aspect, scope, dataset hash or free prompts never call upstream', async () => {
  let calls = 0; const base = await start(async () => { calls += 1 })
  const variants = [body => { body.anchors[0].quote = 'cold' }, body => { body.anchors[0].start = 999 }, body => { body.target.market = 'JP' }, body => { body.target.currency = 'JPY' }, body => { body.dataDigest = '0'.repeat(64) }, body => { body.dataset.reviews[0].body = 'changed text' }, body => { body.prompt = 'invent proof' }, body => { body.aspectId = 'invented' }, body => { body.anchors.push(body.anchors[0]) }, body => { body.anchors[0].reviewId = 'MISSING' }]
  for (const change of variants) { const body = input(); change(body); assert.equal((await post(base, body)).status, 400) }
  assert.equal(calls, 0)
})
test('cross-product quotes and UTF-16 surrogate splits are rejected', () => {
  const body = input(); body.dataset.products.push({ ...body.dataset.products[0], productId: 'OTHER', market: 'JP', currency: 'JPY' }); body.dataset.reviews[0].productId = 'OTHER'; body.dataDigest = imageDataDigest(body.dataset)
  assert.throws(() => validateAnchoredImageRequest(body), /scope/)
  const unicode = input(); unicode.dataset.reviews[0].body = '🔥 hot'; unicode.dataDigest = imageDataDigest(unicode.dataset); unicode.anchors[0] = { ...unicode.anchors[0], quote: '\uD83D', start: 0, end: 1 }
  assert.throws(() => validateAnchoredImageRequest(unicode), /text/)
})
test('supports full 10,000-review identity without sending all reviews in the provider prompt, rejects 10,001', () => {
  const body = input(); body.dataset.reviews = [body.dataset.reviews[0], ...Array.from({ length: 9999 }, (_, index) => ({ ...body.dataset.reviews[1], reviewId: `R${index}` }))]; body.dataDigest = imageDataDigest(body.dataset)
  assert.equal(validateAnchoredImageRequest(body).prompt.includes('private uncited text'), false)
  body.dataset.reviews.push({ ...body.dataset.reviews[0], reviewId: 'EXCESS' }); body.dataDigest = imageDataDigest(body.dataset)
  assert.throws(() => validateAnchoredImageRequest(body))
})
test('cache is isolated by full dataset, workspace, run, hypothesis and original binding metadata', async () => {
  let calls = 0; const original = fetcher(); const logs = []
  const base = await start(async (...args) => { if (String(args[0]).endsWith('/generation')) calls += 1; return original(...args) }, message => logs.push(message))
  const first = await (await post(base, input())).json()
  assert.equal(first.binding.protocolVersion, 2)
  assert.equal((await (await post(base, input())).json()).cached, true)
  for (const key of ['workspaceId', 'runId', 'hypothesis']) { const body = input(); body[key] += '-changed'; assert.equal((await (await post(base, body)).json()).cached, false) }
  const changed = input(); changed.dataset.reviews[1].body += ' changed'; changed.dataDigest = imageDataDigest(changed.dataset)
  assert.equal((await (await post(base, changed)).json()).cached, false)
  assert.equal(calls, 5)
  assert.equal(JSON.stringify(logs).includes('hot'), false)
  assert.equal(JSON.stringify(first).includes('synthetic-secret'), false)
  const image = await fetch(`${base}/api/images/${first.imageId}`)
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff')
})
test('a claimed image MIME cannot turn HTML/SVG into a downloadable raster', async () => {
  const base = await start(async url => String(url).endsWith('/generation') ? fetcher()(url) : new Response('<svg onload="attack()"></svg>', { headers: { 'content-type': 'image/png' } }))
  assert.equal((await post(base, input())).status, 502)
})
test('download rejects IP/credential/nonstandard-port URLs and prevents redirect following', async () => {
  for (const url of ['https://127.0.0.1/image', 'https://[::1]/image', 'https://localhost/image', 'https://user:password@cdn.example/image', 'https://cdn.example:8443/image']) {
    let downloads = 0
    const base = await start(async address => { if (String(address).endsWith('/generation')) return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: url }] } }] } })); downloads += 1; return new Response(png) })
    assert.equal((await post(base, input())).status, 502); assert.equal(downloads, 0)
  }
  const base = await start(async (url, options) => { if (String(url).endsWith('/generation')) return fetcher()(url); assert.equal(options.redirect, 'error'); return new Response(null, { status: 302, headers: { location: 'https://localhost/private' } }) })
  assert.equal((await post(base, input())).status, 502)
})
test('large image streams are cancelled at 4 MB and do not crash or fill the cache', async () => {
  let cancelled = false
  const base = await start(async url => String(url).endsWith('/generation') ? fetcher()(url) : new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2_000_001)) }, cancel() { cancelled = true } })))
  assert.equal((await post(base, input())).status, 413)
  assert.equal(cancelled, true)
  assert.equal((await fetch(`${base}/health`)).status, 200)
})
test('oversized upstream JSON streams are cancelled before buffering the full provider response', async () => {
  let cancelled = false
  const base = await start(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)) }, cancel() { cancelled = true } })))
  assert.equal((await post(base, input())).status, 502)
  assert.equal(cancelled, true)
  assert.equal((await fetch(`${base}/health`)).status, 200)
})

test('disconnect during generation aborts upstream, releases concurrency and does not cache a cancelled run', { timeout: 5000 }, async () => {
  let entered; const ready = new Promise(resolve => { entered = resolve })
  let stopped; const cancelled = new Promise(resolve => { stopped = resolve })
  let calls = 0; let slow = true
  const base = await start(async (url, options) => {
    if (!String(url).endsWith('/generation')) return fetcher()(url)
    calls += 1
    if (!slow) return fetcher()(url)
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { stopped(options.signal.reason); reject(options.signal.reason) }, { once: true })
      entered()
    })
  })
  const request = abortablePost(base)
  await ready
  assert.equal((await post(base, input())).status, 429)
  request.destroy()
  assert.equal((await cancelled).name, 'AbortError')
  slow = false
  const response = await retryAfterCancellation(base)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).cached, false)
  assert.equal(calls, 2)
  assert.equal((await fetch(`${base}/health`)).status, 200)
})

for (const stage of ['provider-json', 'image-download']) {
  test(`disconnect during ${stage} cancels the pending body reader without publishing or caching an image`, { timeout: 5000 }, async () => {
    let entered; const ready = new Promise(resolve => { entered = resolve })
    let stopped; const cancelled = new Promise(resolve => { stopped = resolve })
    let slow = true; let generationCalls = 0; let downloadCalls = 0
    const base = await start(async (url, options) => {
      const generation = String(url).endsWith('/generation')
      if (generation) generationCalls += 1
      else downloadCalls += 1
      if (slow && generation === (stage === 'provider-json')) {
        return new Response(new ReadableStream({
          pull() { entered() },
          cancel(reason) { assert.equal(options.signal.aborted, true); stopped(reason) },
        }))
      }
      return fetcher()(url)
    })
    const request = abortablePost(base)
    await ready
    request.destroy()
    assert.equal((await cancelled).name, 'AbortError')
    if (stage === 'provider-json') assert.equal(downloadCalls, 0)
    slow = false
    const response = await retryAfterCancellation(base)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).cached, false)
    assert.equal(generationCalls, 2)
    assert.equal((await (await post(base, input())).json()).cached, true)
  })
}

test('normal completion and cache hits do not abort completed upstream signals', async () => {
  const signals = []; let calls = 0
  const base = await start(async (url, options) => { calls += 1; signals.push(options.signal); return fetcher()(url) })
  assert.equal((await post(base, input())).status, 200)
  assert.equal((await (await post(base, input())).json()).cached, true)
  await delay(10)
  assert.equal(calls, 2)
  assert.equal(signals.every(signal => !signal.aborted), true)
})
