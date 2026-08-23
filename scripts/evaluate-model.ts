// Real model contract evaluation — sends 12 discriminating cases through the
// 8787 proxy and checks the model output for: zod contract shape, zero
// hallucinated reviewIds/policyIds, and theme grounding (cited reviews actually
// mention keywords related to the theme label).
//
// Usage: npm run eval:model
// Requires: dev:api running with a real BAILIAN_API_KEY in .env
// Budget guard: ≤ 20 real model calls (12 cases + up to 8 retries on transient errors)

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatasetBundle } from '../src/domain/types'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const base = process.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8787'
const maxCalls = 20

// ─── Test cases ──────────────────────────────────────────────────────────

interface ModelCase {
  id: string
  label: string
  difficulty: 'clear' | 'moderate' | 'hard' | 'negative'
  dataset: DatasetBundle
  /** Themes we expect the model to surface (keyword hints, not exact IDs). */
  expectedKeywords: string[]
}

const usProduct = (id: string, title: string, brand: string, price: number, rating: number) => ({
  productId: id, title, brand, market: 'US' as const, currency: 'USD' as const,
  price, rating, reviewCount: 500, capturedAt: '2026-07-30',
  sourceUrl: `fixture:model-eval/product/${id}`,
})

const euProduct = (id: string, title: string, brand: string, price: number, rating: number) => ({
  productId: id, title, brand, market: 'EU' as const, currency: 'EUR' as const,
  price, rating, reviewCount: 400, capturedAt: '2026-07-30',
  sourceUrl: `fixture:model-eval/product/${id}`,
})

const review = (id: string, productId: string, rating: number, title: string, body: string, locale = 'en-US') => ({
  reviewId: id, productId, locale, rating, title, body,
  reviewedAt: '2026-07-20', verifiedPurchase: true,
  sourceUrl: `fixture:model-eval/review/${id}`,
})

const usFccPolicy = {
  policyId: 'pol-fcc', market: 'US' as const, authority: 'FCC',
  topic: 'labeling', effectiveAt: '2026-01-01',
  summary: 'External AC adapters sold in the US must carry FCC Part 15 labeling.',
  sourceUrl: 'https://example.com/fcc',
}

const usDoePolicy = {
  policyId: 'pol-doe', market: 'US' as const, authority: 'DOE',
  topic: 'efficiency', effectiveAt: '2026-03-01',
  summary: 'External power supplies must meet DOE Level VI efficiency requirements.',
  sourceUrl: 'https://example.com/doe',
}

const euChargerPolicy = {
  policyId: 'pol-eu-usb', market: 'EU' as const, authority: 'European Commission',
  topic: 'common-charger', effectiveAt: '2024-12-28',
  summary: 'EU common-charger rules apply to specified radio equipment categories; verify USB-C and USB PD compliance scope.',
  sourceUrl: 'https://example.com/eu-charger',
}

const cases: ModelCase[] = [
  {
    id: 'C1-thermal-strong',
    label: '3/6 条评论明确提及发热，信号清晰',
    difficulty: 'clear',
    expectedKeywords: ['hot', 'heat', 'thermal', 'overheat', 'warm'],
    dataset: {
      products: [usProduct('p1-a', '65W GaN Charger', 'BrandA', 39.99, 4.1), usProduct('p1-b', '45W Charger', 'BrandB', 25.99, 4.3)],
      reviews: [
        review('r1-1', 'p1-a', 2, 'Runs too hot', 'The charger becomes very hot while powering a laptop and phone together.'),
        review('r1-2', 'p1-a', 1, 'Overheating concern', 'Gets uncomfortably hot during sustained 65W charging, worried about safety.'),
        review('r1-3', 'p1-a', 2, 'Heat issue', 'Noticeable heat buildup when charging two devices simultaneously.'),
        review('r1-4', 'p1-b', 5, 'Compact and fast', 'Small form factor, charges my phone very quickly.'),
        review('r1-5', 'p1-b', 4, 'Good value', 'Half the price of competitors and works reliably.'),
        review('r1-6', 'p1-b', 4, 'Solid build', 'No complaints, does what it says on the tin.'),
      ],
      policies: [usFccPolicy],
    },
  },
  {
    id: 'C2-port-reset',
    label: '3/5 条评论提及端口切换中断',
    difficulty: 'clear',
    expectedKeywords: ['reset', 'interrupt', 'port', 'switch', 'second'],
    dataset: {
      products: [usProduct('p2-a', '100W Triple-port Charger', 'BrandC', 49.99, 4.0)],
      reviews: [
        review('r2-1', 'p2-a', 2, 'Ports reset', 'Connecting a second device briefly interrupts charging on the first port.'),
        review('r2-2', 'p2-a', 2, 'Interruption', 'Charging stops for a moment when I plug in another cable.'),
        review('r2-3', 'p2-a', 3, 'Second device issue', 'The port resets when a second device is connected, then resumes.'),
        review('r2-4', 'p2-a', 5, 'Fast charging', 'Great speed when using a single port.'),
        review('r2-5', 'p2-a', 4, 'Sturdy cable', 'The build quality of the cable is excellent.'),
      ],
      policies: [usFccPolicy, usDoePolicy],
    },
  },
  {
    id: 'C3-mixed-signals',
    label: '8 条评论，发热+端口中断+噪声混在一起',
    difficulty: 'moderate',
    expectedKeywords: ['hot', 'heat', 'reset', 'port', 'interrupt'],
    dataset: {
      products: [usProduct('p3-a', '65W GaN Charger', 'BrandA', 39.99, 4.1), usProduct('p3-b', '100W Charger', 'BrandC', 49.99, 4.0), usProduct('p3-c', '45W Charger', 'BrandB', 25.99, 4.3)],
      reviews: [
        review('r3-1', 'p3-a', 2, 'Gets hot', 'Very hot when charging laptop at full power.'),
        review('r3-2', 'p3-a', 2, 'Port reset', 'Second device causes the first port to reset briefly.'),
        review('r3-3', 'p3-b', 1, 'Both issues', 'Overheats and the port resets when I connect two devices.'),
        review('r3-4', 'p3-b', 5, 'Great charger', 'No issues at all, charges everything fast.'),
        review('r3-5', 'p3-c', 4, 'Good price', 'Affordable and reliable for phone charging.'),
        review('r3-6', 'p3-a', 3, 'Decent but warm', 'Slightly warm but not dangerously hot.'),
        review('r3-7', 'p3-b', 2, 'Interrupts', 'Charging interrupts when switching ports.'),
        review('r3-8', 'p3-c', 5, 'Perfect', 'Exactly what I needed, compact and fast.'),
      ],
      policies: [usFccPolicy, usDoePolicy],
    },
  },
  {
    id: 'C4-all-positive',
    label: '5 条正面评论，无明确痛点（负样本）',
    difficulty: 'negative',
    expectedKeywords: [],
    dataset: {
      products: [usProduct('p4-a', '65W GaN Charger', 'BrandA', 39.99, 4.6)],
      reviews: [
        review('r4-1', 'p4-a', 5, 'Excellent', 'Best charger I have owned, compact and powerful.'),
        review('r4-2', 'p4-a', 5, 'Highly recommend', 'Charges my laptop and phone simultaneously with no issues.'),
        review('r4-3', 'p4-a', 4, 'Very good', 'Solid build quality and fast charging speeds.'),
        review('r4-4', 'p4-a', 5, 'Perfect for travel', 'Lightweight and charges everything I need on the go.'),
        review('r4-5', 'p4-a', 4, 'Great value', 'Worth every penny, no complaints at all.'),
      ],
      policies: [usFccPolicy],
    },
  },
  {
    id: 'C5-price-complaints',
    label: '3/5 条评论吐槽价格贵',
    difficulty: 'clear',
    expectedKeywords: ['price', 'expensive', 'cost', 'value', 'money'],
    dataset: {
      products: [usProduct('p5-a', '65W GaN Charger', 'BrandA', 39.99, 3.8)],
      reviews: [
        review('r5-1', 'p5-a', 2, 'Too expensive', 'Works fine but costs almost double compared to similar chargers.'),
        review('r5-2', 'p5-a', 3, 'Overpriced', 'Good charger but the price is hard to justify.'),
        review('r5-3', 'p5-a', 2, 'Not worth it', 'Decent performance but too expensive for what you get.'),
        review('r5-4', 'p5-a', 5, 'Worth it', 'Premium price but premium quality, lasts forever.'),
        review('r5-5', 'p5-a', 4, 'Fair deal', 'Got it on sale, good value for the performance.'),
      ],
      policies: [usFccPolicy],
    },
  },
  {
    id: 'C6-weak-thermal',
    label: '仅 1 条评论附带提及"微温"，弱信号',
    difficulty: 'hard',
    expectedKeywords: ['warm', 'hot', 'heat'],
    dataset: {
      products: [usProduct('p6-a', '65W GaN Charger', 'BrandA', 39.99, 4.2)],
      reviews: [
        review('r6-1', 'p6-a', 4, 'Good but warm', 'Works well overall, gets slightly warm during extended use.'),
        review('r6-2', 'p6-a', 5, 'No issues', 'Charges fast and stays cool, very happy with it.'),
        review('r6-3', 'p6-a', 5, 'Compact', 'Perfect size for travel, no problems at all.'),
        review('r6-4', 'p6-a', 4, 'Reliable', 'Has been working great for three months now.'),
        review('r6-5', 'p6-a', 5, 'Recommended', 'Solid charger, would buy again.'),
      ],
      policies: [usFccPolicy],
    },
  },
  {
    id: 'C7-eu-market',
    label: '纯欧盟市场，欧盟政策合规检查',
    difficulty: 'moderate',
    expectedKeywords: ['hot', 'heat', 'warm'],
    dataset: {
      products: [euProduct('p7-a', '65W USB-C PD Charger EU', 'EuroBrand', 37.99, 4.2)],
      reviews: [
        review('r7-1', 'p7-a', 2, 'Wird heiß', 'Das Ladegerät wird sehr heiß bei voller Last.', 'de-DE'),
        review('r7-2', 'p7-a', 2, 'Too hot', 'The charger gets hot when charging my laptop at full speed.', 'en-IE'),
        review('r7-3', 'p7-a', 5, 'Schnell und kompakt', 'Sehr kompakt und lädt mein Notebook schnell.', 'de-DE'),
        review('r7-4', 'p7-a', 4, 'Bon produit', 'Bon chargeur mais un peu cher.', 'fr-FR'),
        review('r7-5', 'p7-a', 5, 'Perfect', 'Exactly what I needed for my EU devices.', 'en-IE'),
      ],
      policies: [euChargerPolicy],
    },
  },
  {
    id: 'C8-mixed-market',
    label: '美国+欧盟混合市场，合规风险应正确归属',
    difficulty: 'moderate',
    expectedKeywords: ['hot', 'heat', 'port', 'reset'],
    dataset: {
      products: [usProduct('p8-a', '65W GaN Charger', 'BrandA', 39.99, 4.1), euProduct('p8-b', '65W PD Charger EU', 'EuroBrand', 37.99, 4.2)],
      reviews: [
        review('r8-1', 'p8-a', 2, 'Runs hot', 'Gets very hot when charging at full 65W.'),
        review('r8-2', 'p8-a', 4, 'Good value', 'Decent charger for the price.'),
        review('r8-3', 'p8-a', 5, 'Fast charging', 'No issues, charges quickly.'),
        review('r8-4', 'p8-b', 2, 'Port issue', 'Second port causes reset on the first.'),
        review('r8-5', 'p8-b', 5, 'Great EU charger', 'Works perfectly with my EU devices.'),
        review('r8-6', 'p8-b', 3, 'Warm but OK', 'Gets warm but not dangerously hot.'),
      ],
      policies: [usFccPolicy, euChargerPolicy],
    },
  },
  {
    id: 'C9-no-policies',
    label: '无政策数据，模型应返回 0 合规风险（负样本）',
    difficulty: 'negative',
    expectedKeywords: [],
    dataset: {
      products: [usProduct('p9-a', '65W GaN Charger', 'BrandA', 39.99, 4.0)],
      reviews: [
        review('r9-1', 'p9-a', 2, 'Too hot', 'Overheats during fast charging.'),
        review('r9-2', 'p9-a', 4, 'OK product', 'Works fine for normal use.'),
        review('r9-3', 'p9-a', 3, 'Average', 'Neither great nor terrible.'),
        review('r9-4', 'p9-a', 5, 'Love it', 'Perfect for my needs.'),
      ],
      policies: [],
    },
  },
  {
    id: 'C10-adversarial-ids',
    label: 'ID 形似交叉（reviewId 含 policy 字样），防混淆',
    difficulty: 'hard',
    expectedKeywords: ['hot', 'heat'],
    dataset: {
      products: [usProduct('p10-a', '65W Charger', 'BrandA', 39.99, 4.0)],
      reviews: [
        review('review-policy-like-1', 'p10-a', 2, 'Hot', 'Gets hot during use.'),
        review('review-policy-like-2', 'p10-a', 4, 'Good', 'Works well overall.'),
        review('review-normal-3', 'p10-a', 5, 'Great', 'No issues, very satisfied.'),
      ],
      policies: [{
        policyId: 'policy-review-like-1', market: 'US' as const, authority: 'FCC',
        topic: 'labeling', effectiveAt: '2026-01-01',
        summary: 'FCC labeling requirements for external power supplies.',
        sourceUrl: 'https://example.com/fcc',
      }],
    },
  },
  {
    id: 'C11-large-dataset',
    label: '10 条评论 × 4 产品，测试延迟与接地',
    difficulty: 'moderate',
    expectedKeywords: ['hot', 'heat', 'port', 'reset', 'price', 'expensive'],
    dataset: {
      products: [
        usProduct('p11-a', '65W GaN', 'BrandA', 39.99, 4.1),
        usProduct('p11-b', '100W Triple', 'BrandC', 49.99, 4.0),
        usProduct('p11-c', '45W Compact', 'BrandB', 25.99, 4.3),
        usProduct('p11-d', '30W Mini', 'BrandD', 19.99, 4.5),
      ],
      reviews: [
        review('r11-1', 'p11-a', 2, 'Overheats', 'Very hot at full power.'),
        review('r11-2', 'p11-a', 4, 'Good', 'Works fine for daily use.'),
        review('r11-3', 'p11-b', 2, 'Port reset', 'First port resets when second device connects.'),
        review('r11-4', 'p11-b', 5, 'Excellent', 'No problems at all, very fast.'),
        review('r11-5', 'p11-c', 3, 'Overpriced', 'Decent but costs too much for 45W.'),
        review('r11-6', 'p11-c', 5, 'Great value', 'Affordable and reliable.'),
        review('r11-7', 'p11-d', 4, 'Good mini', 'Small and charges phone fast.'),
        review('r11-8', 'p11-d', 5, 'Perfect', 'Exactly what I needed.'),
        review('r11-9', 'p11-a', 2, 'Heat again', 'Still overheating after a month.'),
        review('r11-10', 'p11-b', 3, 'Warm and resets', 'Gets warm and ports sometimes reset.'),
      ],
      policies: [usFccPolicy, usDoePolicy],
    },
  },
  {
    id: 'C12-ambiguous',
    label: '情感混杂评论，模型需区分正面与负面主题',
    difficulty: 'hard',
    expectedKeywords: ['hot', 'warm', 'price', 'value'],
    dataset: {
      products: [usProduct('p12-a', '65W GaN Charger', 'BrandA', 39.99, 3.9)],
      reviews: [
        review('r12-1', 'p12-a', 3, 'Mixed feelings', 'Charges fast but gets warm and the price is a bit steep.'),
        review('r12-2', 'p12-a', 4, 'Mostly good', 'Good charger overall, slight warmth during heavy use.'),
        review('r12-3', 'p12-a', 2, 'Not worth it', 'Overpriced and runs hotter than expected.'),
        review('r12-4', 'p12-a', 5, 'Love it', 'Worth every penny despite minor warmth.'),
        review('r12-5', 'p12-a', 3, 'It is OK', 'Average product, gets warm but not dangerous, price is fair.'),
      ],
      policies: [usFccPolicy],
    },
  },
]

// ─── Evaluation ──────────────────────────────────────────────────────────

interface CaseResult {
  id: string
  label: string
  difficulty: string
  status: 'pass' | 'contract-fail' | 'hallucination' | 'error' | 'timeout'
  latencyMs: number
  themeCount: number
  riskCount: number
  hallucinatedReviewIds: string[]
  hallucinatedPolicyIds: string[]
  groundedThemes: number
  totalThemes: number
  retries: number
  error?: string
}

function checkContract(content: unknown): { ok: boolean; themes?: unknown[]; risks?: unknown[]; error?: string } {
  if (typeof content !== 'object' || content === null) return { ok: false, error: 'content is not an object' }
  const obj = content as Record<string, unknown>
  if (!Array.isArray(obj.themes)) return { ok: false, error: 'themes is not an array' }
  if (!Array.isArray(obj.complianceRisks)) return { ok: false, error: 'complianceRisks is not an array' }
  if (obj.themes.length > 20) return { ok: false, error: `themes array too large (${obj.themes.length})` }
  if (obj.complianceRisks.length > 20) return { ok: false, error: `risks array too large (${obj.complianceRisks.length})` }
  for (const t of obj.themes) {
    if (typeof t !== 'object' || t === null) return { ok: false, error: 'theme is not an object' }
    const tt = t as Record<string, unknown>
    if (typeof tt.id !== 'string' || !tt.id) return { ok: false, error: 'theme.id missing' }
    if (typeof tt.label !== 'string' || !tt.label) return { ok: false, error: 'theme.label missing' }
    if (!['positive', 'negative'].includes(tt.sentiment as string)) return { ok: false, error: 'theme.sentiment invalid' }
    if (!Array.isArray(tt.reviewIds) || tt.reviewIds.length < 1) return { ok: false, error: 'theme.reviewIds missing' }
  }
  for (const r of obj.complianceRisks) {
    if (typeof r !== 'object' || r === null) return { ok: false, error: 'risk is not an object' }
    const rr = r as Record<string, unknown>
    if (typeof rr.id !== 'string' || !rr.id) return { ok: false, error: 'risk.id missing' }
    if (typeof rr.label !== 'string' || !rr.label) return { ok: false, error: 'risk.label missing' }
    if (!['low', 'medium', 'high'].includes(rr.severity as string)) return { ok: false, error: 'risk.severity invalid' }
    if (!Array.isArray(rr.policyIds) || rr.policyIds.length < 1) return { ok: false, error: 'risk.policyIds missing' }
  }
  return { ok: true, themes: obj.themes, risks: obj.complianceRisks }
}

function checkHallucination(content: { themes?: Array<{ reviewIds?: string[] }>; complianceRisks?: Array<{ policyIds?: string[] }> }, dataset: DatasetBundle) {
  const reviewIds = new Set(dataset.reviews.map((r) => r.reviewId))
  const policyIds = new Set(dataset.policies.map((p) => p.policyId))
  const hallucinatedReviewIds = (content.themes ?? []).flatMap((t) => (t.reviewIds ?? []).filter((id) => !reviewIds.has(id)))
  const hallucinatedPolicyIds = (content.complianceRisks ?? []).flatMap((r) => (r.policyIds ?? []).filter((id) => !policyIds.has(id)))
  return { hallucinatedReviewIds, hallucinatedPolicyIds }
}

function checkGrounding(content: { themes?: Array<{ label?: string; reviewIds?: string[] }> }, dataset: DatasetBundle) {
  const reviewMap = new Map(dataset.reviews.map((r) => [r.reviewId, r]))
  let grounded = 0
  let total = 0
  for (const theme of content.themes ?? []) {
    total++
    const label = (theme.label ?? '').toLowerCase()
    const citedReviews = (theme.reviewIds ?? []).map((id) => reviewMap.get(id)).filter(Boolean)
    if (citedReviews.length === 0) continue
    // Check if any cited review's body overlaps with the theme label keywords
    const reviewText = citedReviews.map((r) => `${r!.title} ${r!.body}`.toLowerCase()).join(' ')
    const labelWords = label.split(/[\s,，、]+/).filter((w) => w.length > 2)
    const hasOverlap = labelWords.some((w) => reviewText.includes(w)) || label.split('').some((ch) => reviewText.includes(ch) && ch.trim())
    if (hasOverlap) grounded++
  }
  return { grounded, total }
}

async function callAnalyze(dataset: DatasetBundle): Promise<{ ok: boolean; content?: unknown; latencyMs: number; status?: number; error?: string }> {
  const started = Date.now()
  try {
    const response = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataset),
      signal: AbortSignal.timeout(70_000),
    })
    const latencyMs = Date.now() - started
    if (!response.ok) return { ok: false, latencyMs, status: response.status, error: `HTTP ${response.status}` }
    const envelope = await response.json()
    const content = JSON.parse(envelope.choices?.[0]?.message?.content ?? '')
    return { ok: true, content, latencyMs }
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

console.log('Model Contract Evaluation')
console.log('='.repeat(60))
console.log(`Proxy: ${base}`)
console.log(`Cases: ${cases.length} | Budget: ${maxCalls} calls max\n`)

// Health check
const health = await fetch(`${base}/health`)
const healthBody = await health.json() as { providerConfigured?: boolean }
if (health.status !== 200 || !healthBody.providerConfigured) {
  console.error('FAIL: API proxy not configured. Start dev:api with a real BAILIAN_API_KEY.')
  process.exit(1)
}
console.log('Health: OK (provider configured)\n')

let totalCalls = 0
const results: CaseResult[] = []

for (const modelCase of cases) {
  if (totalCalls >= maxCalls) {
    console.log(`\n⚠ Budget exhausted (${totalCalls}/${maxCalls}), skipping remaining cases.`)
    break
  }

  process.stdout.write(`[${totalCalls + 1}/${maxCalls}] ${modelCase.id} (${modelCase.difficulty})... `)

  let attempt = 0
  let maxAttempts = 2 // 1 initial + 1 retry
  let result: CaseResult | null = null

  while (attempt < maxAttempts && totalCalls < maxCalls) {
    attempt++
    totalCalls++

    const response = await callAnalyze(modelCase.dataset)

    if (!response.ok) {
      // Retry on transient errors (timeout, 5xx, network)
      const isTransient = response.error?.includes('timeout') || (response.status && response.status >= 500)
      if (isTransient && attempt < maxAttempts && totalCalls < maxCalls) {
        process.stdout.write(`retry (transient: ${response.error})... `)
        continue
      }
      result = {
        id: modelCase.id, label: modelCase.label, difficulty: modelCase.difficulty,
        status: response.error?.includes('timeout') ? 'timeout' : 'error',
        latencyMs: response.latencyMs, themeCount: 0, riskCount: 0,
        hallucinatedReviewIds: [], hallucinatedPolicyIds: [],
        groundedThemes: 0, totalThemes: 0, retries: attempt - 1,
        error: response.error,
      }
      break
    }

    // Contract check
    const contract = checkContract(response.content)
    if (!contract.ok) {
      result = {
        id: modelCase.id, label: modelCase.label, difficulty: modelCase.difficulty,
        status: 'contract-fail', latencyMs: response.latencyMs,
        themeCount: 0, riskCount: 0, hallucinatedReviewIds: [], hallucinatedPolicyIds: [],
        groundedThemes: 0, totalThemes: 0, retries: attempt - 1,
        error: contract.error,
      }
      break // Don't retry contract failures
    }

    // Hallucination check
    const hallucination = checkHallucination(
      { themes: contract.themes as Array<{ reviewIds?: string[] }>, complianceRisks: contract.risks as Array<{ policyIds?: string[] }> },
      modelCase.dataset,
    )
    if (hallucination.hallucinatedReviewIds.length > 0 || hallucination.hallucinatedPolicyIds.length > 0) {
      result = {
        id: modelCase.id, label: modelCase.label, difficulty: modelCase.difficulty,
        status: 'hallucination', latencyMs: response.latencyMs,
        themeCount: (contract.themes ?? []).length, riskCount: (contract.risks ?? []).length,
        hallucinatedReviewIds: hallucination.hallucinatedReviewIds,
        hallucinatedPolicyIds: hallucination.hallucinatedPolicyIds,
        groundedThemes: 0, totalThemes: 0, retries: attempt - 1,
      }
      break // Don't retry hallucination
    }

    // Grounding check
    const grounding = checkGrounding(
      { themes: contract.themes as Array<{ label?: string; reviewIds?: string[] }> },
      modelCase.dataset,
    )

    result = {
      id: modelCase.id, label: modelCase.label, difficulty: modelCase.difficulty,
      status: 'pass', latencyMs: response.latencyMs,
      themeCount: (contract.themes ?? []).length, riskCount: (contract.risks ?? []).length,
      hallucinatedReviewIds: [], hallucinatedPolicyIds: [],
      groundedThemes: grounding.grounded, totalThemes: grounding.total, retries: attempt - 1,
    }
    break
  }

  if (!result) {
    result = {
      id: modelCase.id, label: modelCase.label, difficulty: modelCase.difficulty,
      status: 'error', latencyMs: 0, themeCount: 0, riskCount: 0,
      hallucinatedReviewIds: [], hallucinatedPolicyIds: [],
      groundedThemes: 0, totalThemes: 0, retries: attempt - 1,
      error: 'exhausted retries',
    }
  }

  results.push(result)
  const icon = result.status === 'pass' ? '✓' : result.status === 'contract-fail' ? '⨯' : result.status === 'hallucination' ? '⚠' : '⨯'
  console.log(`${icon} ${result.status} (${result.latencyMs}ms, ${result.themeCount} themes, ${result.riskCount} risks${result.retries ? `, ${result.retries} retry` : ''})`)
}

// ─── Summary ─────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.status === 'pass')
const contractFailed = results.filter((r) => r.status === 'contract-fail')
const hallucinated = results.filter((r) => r.status === 'hallucination')
const errors = results.filter((r) => r.status === 'error' || r.status === 'timeout')

const latencies = passed.map((r) => r.latencyMs).sort((a, b) => a - b)
const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0
const p95 = latencies.length ? latencies[Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)] : 0
const totalGrounded = passed.reduce((sum, r) => sum + r.groundedThemes, 0)
const totalThemes = passed.reduce((sum, r) => sum + r.totalThemes, 0)

const summary = {
  generatedAt: new Date().toISOString(),
  evaluationKind: 'model-contract-and-grounding-check',
  disclaimer: 'This is a contract and grounding check, not a human-annotated accuracy evaluation. Cases are synthetic; do not infer real-world precision.',
  proxyEndpoint: base,
  totalCalls,
  budgetCalls: maxCalls,
  caseCount: results.length,
  passed: passed.length,
  contractFailed: contractFailed.length,
  hallucinationDetected: hallucinated.length,
  errors: errors.length,
  zeroHallucinationRate: passed.length ? (passed.filter((r) => r.hallucinatedReviewIds.length === 0 && r.hallucinatedPolicyIds.length === 0).length / passed.length) : 0,
  contractPassRate: results.length ? (passed.length / results.length) : 0,
  groundingRate: totalThemes ? (totalGrounded / totalThemes) : 0,
  latency: {
    minMs: latencies[0] ?? 0,
    medianMs: median,
    p95Ms: p95,
    maxMs: latencies[latencies.length - 1] ?? 0,
  },
  results,
}

// Write detailed results (gitignored)
const detailPath = resolve(root, 'artifacts/evaluation/model-contract-eval/results.json')
await mkdir(dirname(detailPath), { recursive: true })
await writeFile(detailPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

// Console summary
console.log('\n' + '='.repeat(60))
console.log('SUMMARY')
console.log('-'.repeat(60))
console.log(`Cases:       ${results.length} (${passed.length} pass, ${contractFailed.length} contract-fail, ${hallucinated.length} hallucination, ${errors.length} error)`)
console.log(`Calls:       ${totalCalls}/${maxCalls}`)
console.log(`Contract:    ${(summary.contractPassRate * 100).toFixed(0)}% pass rate`)
console.log(`Hallucination: ${passed.length ? '0 hallucinated IDs in all passing cases' : 'n/a'}`)
console.log(`Grounding:   ${totalThemes ? `${totalGrounded}/${totalThemes} themes cite reviews with keyword overlap (${(summary.groundingRate * 100).toFixed(0)}%)` : 'n/a'}`)
console.log(`Latency:     min ${summary.latency.minMs}ms | median ${median}ms | p95 ${p95}ms | max ${summary.latency.maxMs}ms`)
console.log(`\nDetailed results: ${detailPath}`)

if (contractFailed.length > 0 || hallucinated.length > 0 || errors.length > 0) {
  console.log('\nFailures:')
  for (const r of [...contractFailed, ...hallucinated, ...errors]) {
    console.log(`  ${r.id}: ${r.status}${r.error ? ` — ${r.error}` : ''}${r.hallucinatedReviewIds.length ? ` — hallucinated reviews: ${r.hallucinatedReviewIds.join(', ')}` : ''}${r.hallucinatedPolicyIds.length ? ` — hallucinated policies: ${r.hallucinatedPolicyIds.join(', ')}` : ''}`)
  }
}
