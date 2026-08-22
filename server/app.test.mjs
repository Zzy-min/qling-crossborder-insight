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

test('maps upstream HTTP errors without forwarding provider details', async () => {
  const fetcher = async () => new Response('{"message":"provider secret detail"}', { status: 429 })
  const base = await start({ apiKey: 'server-secret', fetcher })
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"products":[],"reviews":[],"policies":[]}' })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'provider_error', upstreamStatus: 429 })
})

test('maps upstream timeouts to 504', async () => {
  const fetcher = async () => { throw new DOMException('timed out', 'TimeoutError') }
  const base = await start({ apiKey: 'server-secret', fetcher })
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"products":[],"reviews":[],"policies":[]}' })
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { error: 'provider_timeout' })
})

test('maps upstream network failures to 502', async () => {
  const fetcher = async () => { throw new TypeError('connect ECONNRESET secret-host') }
  const base = await start({ apiKey: 'server-secret', fetcher })
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"products":[],"reviews":[],"policies":[]}' })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'provider_unavailable' })
})

const MINIMAL_BODY = JSON.stringify({ products: [], reviews: [], policies: [] })

async function captureUpstreamRequest(options) {
  let capturedUrl
  let capturedBody
  const fetcher = async (url, requestOptions) => {
    capturedUrl = url
    capturedBody = JSON.parse(requestOptions.body)
    return new Response('{"choices":[]}', { status: 200 })
  }
  const base = await start({ apiKey: 'server-secret', fetcher, ...options })
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: MINIMAL_BODY })
  assert.equal(response.status, 200)
  return { capturedUrl, capturedBody }
}

test('defaults to the token-plan endpoint and qwen3.7-plus', async () => {
  const savedBaseUrl = process.env.BAILIAN_BASE_URL
  const savedModel = process.env.BAILIAN_MODEL
  delete process.env.BAILIAN_BASE_URL
  delete process.env.BAILIAN_MODEL
  try {
    const { capturedUrl, capturedBody } = await captureUpstreamRequest({})
    assert.equal(capturedUrl, 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
    assert.equal(capturedBody.model, 'qwen3.7-plus')
    assert.equal(capturedBody.response_format.type, 'json_object')
  } finally {
    if (savedBaseUrl !== undefined) process.env.BAILIAN_BASE_URL = savedBaseUrl
    if (savedModel !== undefined) process.env.BAILIAN_MODEL = savedModel
  }
})

test('appends the chat completions path to a base url without a trailing slash', async () => {
  const { capturedUrl } = await captureUpstreamRequest({ baseUrl: 'https://example.com/v1' })
  assert.equal(capturedUrl, 'https://example.com/v1/chat/completions')
})

test('normalizes trailing slashes in a base url', async () => {
  const { capturedUrl } = await captureUpstreamRequest({ baseUrl: 'https://example.com/v1/' })
  assert.equal(capturedUrl, 'https://example.com/v1/chat/completions')
})

test('forwards the configured model to the upstream request body', async () => {
  const { capturedBody } = await captureUpstreamRequest({ model: 'deepseek-v4-pro' })
  assert.equal(capturedBody.model, 'deepseek-v4-pro')
})

test('disables thinking for qwen reasoning models to cut latency', async () => {
  const { capturedBody } = await captureUpstreamRequest({ model: 'qwen3.7-plus' })
  assert.equal(capturedBody.enable_thinking, false)
})

test('omits the thinking flag for non-qwen vendors', async () => {
  const { capturedBody } = await captureUpstreamRequest({ model: 'deepseek-v4-pro' })
  assert.equal('enable_thinking' in capturedBody, false)
})

test('system prompt pins the output schema so the model cannot echo the dataset', async () => {
  const { capturedBody } = await captureUpstreamRequest({})
  const system = capturedBody.messages.find((m) => m.role === 'system').content
  assert.match(system, /"themes"/)
  assert.match(system, /"complianceRisks"/)
  assert.match(system, /never invent IDs/)
  assert.match(system, /Do not echo the dataset/)
})
