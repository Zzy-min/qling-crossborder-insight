import { createServer } from 'node:http'
import { validateDataset } from './dataset-schema.mjs'

const MAX_BODY_BYTES = 1_000_000

export function createApiServer({ apiKey, fetcher = fetch, endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' }) {
  return createServer(async (request, response) => {
    const origin = request.headers.origin
    const localOrigin = origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    if (localOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'OPTIONS') {
      if (!localOrigin) {
        response.writeHead(403).end(JSON.stringify({ error: 'origin_not_allowed' }))
        return
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
      response.writeHead(204).end()
      return
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.end(JSON.stringify({ ok: true, providerConfigured: Boolean(apiKey) }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/api/analyze') {
      response.writeHead(404).end(JSON.stringify({ error: 'not_found' }))
      return
    }
    if (!apiKey) {
      response.writeHead(503).end(JSON.stringify({ error: 'provider_not_configured' }))
      return
    }
    if (origin && !localOrigin) {
      response.writeHead(403).end(JSON.stringify({ error: 'origin_not_allowed' }))
      return
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      response.writeHead(415).end(JSON.stringify({ error: 'json_required' }))
      return
    }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > MAX_BODY_BYTES) throw new Error('payload_too_large')
        chunks.push(chunk)
      }
      const dataset = validateDataset(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const upstream = await fetcher(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.BAILIAN_MODEL || 'qwen-plus',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return JSON only. Cite only reviewIds and policyIds supplied by the user.' },
            { role: 'user', content: JSON.stringify(dataset) },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      })
      const body = await upstream.text()
      response.writeHead(upstream.status).end(body)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'payload_too_large'
      response.writeHead(tooLarge ? 413 : 400).end(JSON.stringify({ error: tooLarge ? 'payload_too_large' : 'invalid_request' }))
    }
  })
}
