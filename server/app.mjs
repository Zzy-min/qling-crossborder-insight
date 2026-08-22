import { createServer } from 'node:http'
import { validateDataset } from './dataset-schema.mjs'

const MAX_BODY_BYTES = 1_000_000

const DEFAULT_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen3.7-plus'
const DEFAULT_TIMEOUT_MS = 60_000

const SYSTEM_PROMPT = `You are a cross-border e-commerce market analyst. Analyze the dataset (products, reviews, policies) provided by the user.

Return ONLY a JSON object with this exact shape:
{
  "themes": [ { "id": string, "label": string, "sentiment": "positive" | "negative", "reviewIds": string[] } ],
  "complianceRisks": [ { "id": string, "label": string, "severity": "low" | "medium" | "high", "policyIds": string[] } ]
}

Rules:
- themes: group recurring opinions from reviews into 3-8 themes. reviewIds must cite only review IDs present in the dataset, never invent IDs.
- complianceRisks: identify product compliance risks relevant to the supplied policies. policyIds must cite only policy IDs present in the dataset.
- Do not echo the dataset. Output the JSON object only.`

export function createApiServer({
  apiKey,
  fetcher = fetch,
  baseUrl = process.env.BAILIAN_BASE_URL || DEFAULT_BASE_URL,
  model = process.env.BAILIAN_MODEL || DEFAULT_MODEL,
  timeoutMs = Number(process.env.BAILIAN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
}) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
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
      try {
        // qwen3.x are reasoning models; disabling thinking cuts latency ~5x
        // (48s -> 9s measured on the token-plan endpoint) without quality loss
        // for this structured extraction task. Other vendors may reject the
        // parameter, so it is only sent for qwen models.
        const extraParams = model.startsWith('qwen') ? { enable_thinking: false } : {}
        const upstream = await fetcher(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            response_format: { type: 'json_object' },
            ...extraParams,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: JSON.stringify(dataset) },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!upstream.ok) {
          response.writeHead(502).end(JSON.stringify({ error: 'provider_error', upstreamStatus: upstream.status }))
          return
        }
        const body = await upstream.text()
        response.writeHead(200).end(body)
      } catch (error) {
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        response.writeHead(timeout ? 504 : 502).end(JSON.stringify({ error: timeout ? 'provider_timeout' : 'provider_unavailable' }))
      }
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'payload_too_large'
      response.writeHead(tooLarge ? 413 : 400).end(JSON.stringify({ error: tooLarge ? 'payload_too_large' : 'invalid_request' }))
    }
  })
}
