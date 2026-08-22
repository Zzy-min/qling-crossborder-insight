// Compare prompt/param variants for the real analyze request (one-off probe).
import { readFileSync } from 'node:fs'

const key = readFileSync('.env', 'utf8').match(/BAILIAN_API_KEY=(.+)/)[1].trim()
const dataset = JSON.parse(readFileSync(new URL('./smoke-dataset.json', import.meta.url), 'utf8'))

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

const variants = [
  { name: 'qwen3.7-plus + schema prompt + thinking on', extra: {} },
  { name: 'qwen3.7-plus + schema prompt + enable_thinking:false', extra: { enable_thinking: false } },
]

for (const variant of variants) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.7-plus',
        response_format: { type: 'json_object' },
        ...variant.extra,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(dataset) },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    })
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    if (!res.ok) {
      console.log(`[${variant.name}] status ${res.status} in ${elapsed}s — ${JSON.stringify(await res.json()).slice(0, 300)}`)
      continue
    }
    const body = await res.json()
    const content = body.choices?.[0]?.message?.content ?? ''
    let parsed = null
    try { parsed = JSON.parse(content) } catch { /* leave null */ }
    const reviewIds = new Set(dataset.reviews.map((r) => r.reviewId))
    const policyIds = new Set(dataset.policies.map((p) => p.policyId))
    const unknownReviews = (parsed?.themes ?? []).flatMap((t) => (t.reviewIds ?? []).filter((id) => !reviewIds.has(id)))
    const unknownPolicies = (parsed?.complianceRisks ?? []).flatMap((r) => (r.policyIds ?? []).filter((id) => !policyIds.has(id)))
    console.log(`[${variant.name}] status 200 in ${elapsed}s`)
    console.log(`  themes=${parsed?.themes?.length ?? 'INVALID'} risks=${parsed?.complianceRisks?.length ?? 'INVALID'} unknownReviews=${unknownReviews.length} unknownPolicies=${unknownPolicies.length}`)
    console.log('  content head:', content.slice(0, 300).replace(/\n/g, ' '))
  } catch (error) {
    console.log(`[${variant.name}] ERROR after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${error.message}`)
  }
}
