import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createApiServer } from './app.mjs'

let server
afterEach(() => server?.close())

async function start(options) {
  server = createApiServer(options)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

test('health does not reveal the API key', async () => {
  const base = await start({ apiKey: 'secret-value' })
  const body = await (await fetch(`${base}/health`)).text()
  assert.equal(body.includes('secret-value'), false)
  assert.deepEqual(JSON.parse(body), { ok: true, providerConfigured: true })
})

test('analysis is disabled without a server-side key', async () => {
  const base = await start({})
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: '{}' })
  assert.equal(response.status, 503)
})

test('server injects authorization without returning it', async () => {
  let authorization
  const fetcher = async (_url, options) => {
    authorization = options.headers.Authorization
    return new Response('{"choices":[]}', { status: 200 })
  }
  const base = await start({ apiKey: 'server-secret', fetcher })
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"products":[],"reviews":[],"policies":[]}' })
  assert.equal(authorization, 'Bearer server-secret')
  assert.equal((await response.text()).includes('server-secret'), false)
})

test('rejects personal data before calling the upstream provider', async () => {
  let called = false
  const base = await start({ apiKey: 'server-secret', fetcher: async () => { called = true } })
  const response = await fetch(`${base}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products: [], policies: [], reviews: [{ reviewId: 'r1', productId: 'p1', locale: 'en-US', rating: 5, title: '', body: 'ok', reviewedAt: '2026-01-01', verifiedPurchase: true, sourceUrl: 'fixture:r1', email: 'person@example.com' }] }),
  })
  assert.equal(response.status, 400)
  assert.equal(called, false)
})

test('rejects orphan review references before calling upstream', async () => {
  let called = false
  const base = await start({ apiKey: 'server-secret', fetcher: async () => { called = true } })
  const response = await fetch(`${base}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products: [], policies: [], reviews: [{ reviewId: 'r1', productId: 'missing', locale: 'en-US', rating: 5, title: '', body: 'ok', reviewedAt: '2026-01-01', verifiedPurchase: true, sourceUrl: 'fixture:r1' }] }),
  })
  assert.equal(response.status, 400)
  assert.equal(called, false)
})

test('rejects more than 1000 reviews before calling upstream', async () => {
  let called = false
  const base = await start({ apiKey: 'server-secret', fetcher: async () => { called = true } })
  const product = { productId: 'p1', title: 'x', brand: 'x', market: 'US', currency: 'USD', price: 1, rating: 5, reviewCount: 1, capturedAt: '2026-01-01', sourceUrl: 'fixture:p1' }
  const reviews = Array.from({ length: 1001 }, (_, index) => ({ reviewId: `r${index}`, productId: 'p1', locale: 'en-US', rating: 5, title: '', body: 'ok', reviewedAt: '2026-01-01', verifiedPurchase: true, sourceUrl: `fixture:r${index}` }))
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: [product], reviews, policies: [] }) })
  assert.equal(response.status, 400)
  assert.equal(called, false)
})

test('rejects cross-site browser requests before using the provider key', async () => {
  let called = false
  const base = await start({ apiKey: 'server-secret', fetcher: async () => { called = true } })
  const response = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: '{"reviews":[],"policies":[]}',
  })
  assert.equal(response.status, 403)
  assert.equal(called, false)
})

test('allows CORS preflight only from a loopback web app', async () => {
  const base = await start({ apiKey: 'server-secret' })
  const allowed = await fetch(`${base}/api/analyze`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5181' } })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5181')
  const denied = await fetch(`${base}/api/analyze`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } })
  assert.equal(denied.status, 403)
})
