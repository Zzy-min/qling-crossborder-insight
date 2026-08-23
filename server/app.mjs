import { createServer } from 'node:http'
import { validateDataset } from './dataset-schema.mjs'

const MAX_BODY_BYTES = 1_000_000
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_INFLIGHT = 2

const DEFAULT_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen3.7-plus'
const DEFAULT_TIMEOUT_MS = 60_000

export const SYSTEM_PROMPT = `You are a cross-border e-commerce market analyst. Analyze the dataset (products, reviews, policies) provided by the user.

Return ONLY a JSON object with this exact shape:
{
  "themes": [ { "id": string, "label": string, "sentiment": "positive" | "negative", "reviewIds": string[] } ],
  "complianceRisks": [ { "id": string, "label": string, "severity": "low" | "medium" | "high", "policyIds": string[] } ]
}

Rules:
- themes: group recurring opinions from reviews into 3-8 themes. reviewIds must cite only review IDs present in the dataset, never invent IDs.
- complianceRisks: identify product compliance risks relevant to the supplied policies. policyIds must cite only policy IDs present in the dataset.
- Do not echo the dataset. Output the JSON object only.`

function send(response, status, payload) {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status).end(payload === undefined ? '' : JSON.stringify(payload))
}

function sendRaw(response, status, body, contentType = 'application/json; charset=utf-8') {
  if (response.headersSent || response.destroyed) return
  response.setHeader('Content-Type', contentType)
  response.writeHead(status).end(body)
}

export function createApiServer({
  apiKey,
  fetcher = fetch,
  baseUrl = process.env.BAILIAN_BASE_URL || DEFAULT_BASE_URL,
  model = process.env.BAILIAN_MODEL || DEFAULT_MODEL,
  timeoutMs = Number(process.env.BAILIAN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  logger = () => {},
}) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  let inFlight = 0
  return createServer(async (request, response) => {
    try {
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
          send(response, 403, { error: 'origin_not_allowed' })
          return
        }
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
        send(response, 204)
        return
      }
      if (request.method === 'GET' && request.url === '/health') {
        send(response, 200, { ok: true, providerConfigured: Boolean(apiKey) })
        return
      }
      if (request.method !== 'POST' || request.url !== '/api/analyze') {
        send(response, 404, { error: 'not_found' })
        return
      }
      if (!apiKey) {
        send(response, 503, { error: 'provider_not_configured' })
        return
      }
      if (origin && !localOrigin) {
        send(response, 403, { error: 'origin_not_allowed' })
        return
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        send(response, 415, { error: 'json_required' })
        return
      }
      if (inFlight >= MAX_INFLIGHT) {
        send(response, 429, { error: 'busy' })
        return
      }
      inFlight++
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
          const startedAt = Date.now()
          logger(JSON.stringify({ event: 'upstream_call', model }))
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
          logger(JSON.stringify({ event: 'upstream_done', model, elapsedMs: Date.now() - startedAt, upstreamStatus: upstream.status }))
          if (!upstream.ok) {
            send(response, 502, { error: 'provider_error', upstreamStatus: upstream.status })
            return
          }
          // Envelope validation: the server is not a dumb pipe. It checks the
          // upstream response has the minimal OpenAI-compatible shape before
          // forwarding it. The full zod contract remains enforced client-side
          // (materializeModelOutput is the final defence), so we do NOT
          // duplicate the complete schema here — only the structural minimum.
          const body = await upstream.text()
          if (body.length > MAX_RESPONSE_BYTES) {
            send(response, 502, { error: 'invalid_provider_response', reason: 'response_too_large' })
            return
          }
          let parsed
          try {
            parsed = JSON.parse(body)
          } catch {
            send(response, 502, { error: 'invalid_provider_response', reason: 'not_json' })
            return
          }
          const content = parsed?.choices?.[0]?.message?.content
          if (typeof content !== 'string' || content.length === 0) {
            send(response, 502, { error: 'invalid_provider_response', reason: 'missing_content' })
            return
          }
          let modelOutput
          try {
            modelOutput = JSON.parse(content)
          } catch {
            send(response, 502, { error: 'invalid_provider_response', reason: 'content_not_json' })
            return
          }
          if (!Array.isArray(modelOutput.themes) || !Array.isArray(modelOutput.complianceRisks)) {
            send(response, 502, { error: 'invalid_provider_response', reason: 'wrong_shape' })
            return
          }
          // Structure validated — forward the original envelope unchanged so
          // the client-side materializeModelOutput can apply the full contract.
          sendRaw(response, 200, body)
        } catch (error) {
          const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          send(response, timeout ? 504 : 502, { error: timeout ? 'provider_timeout' : 'provider_unavailable' })
        }
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === 'payload_too_large'
        send(response, tooLarge ? 413 : 400, { error: tooLarge ? 'payload_too_large' : 'invalid_request' })
      } finally {
        if (inFlight > 0) inFlight--
      }
    } catch (error) {
      // Top-level safety net: a client disconnect mid-request, a destroyed
      // socket writeHead, or any other unexpected throw must not crash the
      // process. The request simply fails with a 500.
      send(response, 500, { error: 'internal_error' })
    }
  })
}
