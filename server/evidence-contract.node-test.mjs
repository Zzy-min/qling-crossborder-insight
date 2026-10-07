import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiServer, ANCHORED_SYSTEM_PROMPT } from './app.mjs'

const dataset = {
  products: [{ productId: 'SKU', title: 'Charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-06', sourceUrl: null }],
  reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'It gets hot.', reviewedAt: '2026-10-06', verifiedPurchase: null, sourceUrl: null }], policies: [],
}
const result = () => ({ themes: [{ id: 'heat', aspectId: 'thermal', productId: 'SKU', market: 'US', label: '发热', sentiment: 'mixed', quotes: [{ reviewId: 'R1', field: 'body', quote: 'It gets hot.', start: 0, end: 12 }] }], complianceRisks: [] })

async function request(output, input = { protocolVersion: 2, dataset }) {
  let upstreamBody
  const server = createApiServer({ apiKey: 'test-only-not-real', fetcher: async (_url, options) => {
    upstreamBody = JSON.parse(options.body)
    return new Response(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: JSON.stringify(output) } }] }))
  } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    return { status: response.status, payload: await response.json(), prompt: response.headers.get('x-qling-prompt-version'), upstreamBody }
  } finally { await new Promise((resolve) => server.close(resolve)) }
}

test('v2 validates quotes, exposes its protocol and uses constrained prompt', async () => {
  const response = await request(result())
  assert.equal(response.status, 200)
  assert.equal(response.payload.protocolVersion, 2)
  assert.equal(response.prompt, 'qling-proxy-analysis/4')
  assert.equal(response.upstreamBody.messages[0].content, ANCHORED_SYSTEM_PROMPT)
  assert.deepEqual(JSON.parse(response.upstreamBody.messages[1].content), dataset)
})

test('v2 rejects valid IDs with wrong text, scope, offsets or missing anchors without leaking data', async () => {
  for (const change of [
    (output) => { output.themes[0].quotes[0].quote = 'SECRET_SOURCE_TEXT' },
    (output) => { output.themes[0].market = 'EU' },
    (output) => { output.themes[0].quotes[0].end = 99 },
    (output) => { delete output.themes[0].quotes; output.themes[0].reviewIds = ['R1'] },
  ]) {
    const output = result()
    change(output)
    const response = await request(output)
    assert.equal(response.status, 502)
    assert.deepEqual(response.payload, { error: 'invalid_provider_response', reason: 'invalid_evidence_contract' })
    assert.equal(JSON.stringify(response.payload).includes('SECRET_SOURCE_TEXT'), false)
  }
})

test('unknown or extra protocol fields are rejected before upstream', async () => {
  for (const input of [{ protocolVersion: 3, dataset }, { protocolVersion: 2, dataset, apiKey: 'do-not-forward' }, { protocolVersion: 2 }]) {
    const response = await request(result(), input)
    assert.equal(response.status, 400)
    assert.equal(response.upstreamBody, undefined)
  }
})

test('legacy bare datasets still use the original contract without fabricated anchors', async () => {
  const response = await request({ themes: [{ id: 'heat', label: '发热', sentiment: 'negative', reviewIds: ['R1'] }], complianceRisks: [] }, dataset)
  assert.equal(response.status, 200)
  assert.equal(response.prompt, 'qling-proxy-analysis/1')
  assert.equal(response.payload.protocolVersion, undefined)
})

test('server binds unique raw substrings without repairing explicitly wrong offsets', async () => {
  const output = result()
  delete output.themes[0].quotes[0].start
  delete output.themes[0].quotes[0].end
  const response = await request(output)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.payload.choices[0].message.content).themes[0].quotes[0], { reviewId: 'R1', field: 'body', quote: 'It gets hot.', start: 0, end: 12 })
  output.themes[0].quotes[0].start = 0
  output.themes[0].quotes[0].end = 11
  assert.equal((await request(output)).status, 502)
})

test('client cancellation aborts upstream work without crashing the server', { timeout: 4000 }, async () => {
  let started
  let aborted
  const start = new Promise((resolve) => { started = resolve })
  const stop = new Promise((resolve) => { aborted = resolve })
  const server = createApiServer({ apiKey: 'test-only', fetcher: async (_url, options) => {
    started()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(new DOMException('abort', 'AbortError')) }, { once: true }))
  } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const controller = new AbortController()
    const pending = fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, dataset }), signal: controller.signal }).catch((error) => error)
    await start
    controller.abort()
    await stop
    assert.equal((await pending).name, 'AbortError')
    assert.equal((await fetch(`${base}/health`)).status, 200)
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
})
