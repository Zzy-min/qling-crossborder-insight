// P0-2 real-link smoke test. Requires dev:api running with a real BAILIAN_API_KEY.
// Usage: node scripts/smoke-real.mjs [baseUrl]
// Sends one minimal /api/analyze request and validates the model output against
// the evidence contract: JSON shape + zero hallucinated reviewIds/policyIds.

const base = process.argv[2] || 'http://127.0.0.1:8787'

const dataset = {
  products: [
    { productId: 'p-anker-65w', title: 'Anker 65W USB-C Charger', brand: 'Anker', market: 'US', currency: 'USD', price: 39.99, rating: 4.5, reviewCount: 1820, capturedAt: '2026-08-01', sourceUrl: 'https://example.com/anker-65w' },
    { productId: 'p-ugreen-45w', title: 'UGREEN 45W GaN Charger', brand: 'UGREEN', market: 'US', currency: 'USD', price: 25.99, rating: 4.3, reviewCount: 940, capturedAt: '2026-08-01', sourceUrl: 'https://example.com/ugreen-45w' },
  ],
  reviews: [
    { reviewId: 'r-001', productId: 'p-anker-65w', locale: 'en-US', rating: 5, title: 'Fast and reliable', body: 'Charges my laptop fully in about an hour, very compact for travel.', reviewedAt: '2026-07-15', verifiedPurchase: true, sourceUrl: 'https://example.com/r/001' },
    { reviewId: 'r-002', productId: 'p-anker-65w', locale: 'en-US', rating: 2, title: 'Runs hot', body: 'Gets noticeably hot when charging at full 65W, worried about safety.', reviewedAt: '2026-07-18', verifiedPurchase: true, sourceUrl: 'https://example.com/r/002' },
    { reviewId: 'r-003', productId: 'p-anker-65w', locale: 'en-US', rating: 4, title: 'Good but pricy', body: 'Works great with USB-C PD but costs more than comparable GaN chargers.', reviewedAt: '2026-07-20', verifiedPurchase: false, sourceUrl: 'https://example.com/r/003' },
    { reviewId: 'r-004', productId: 'p-ugreen-45w', locale: 'en-US', rating: 1, title: 'Stopped working after 2 weeks', body: 'Dead after two weeks of light use. Support sent a replacement.', reviewedAt: '2026-07-10', verifiedPurchase: true, sourceUrl: 'https://example.com/r/004' },
    { reviewId: 'r-005', productId: 'p-ugreen-45w', locale: 'en-US', rating: 5, title: 'Great value', body: 'Half the price of big brands and charges my phone super fast.', reviewedAt: '2026-07-22', verifiedPurchase: true, sourceUrl: 'https://example.com/r/005' },
    { reviewId: 'r-006', productId: 'p-ugreen-45w', locale: 'en-US', rating: 3, title: 'Cable included is short', body: 'The bundled USB-C cable is only 1m, too short for desk use.', reviewedAt: '2026-07-25', verifiedPurchase: true, sourceUrl: 'https://example.com/r/006' },
  ],
  policies: [
    { policyId: 'pol-fcc-2026', market: 'US', authority: 'FCC', topic: 'FCC Part 15 labeling for external power supplies', effectiveAt: '2026-01-01', summary: 'External AC adapters sold in the US must carry FCC Part 15 consumer alert labeling and updated supplier Declaration of Conformity documentation.', sourceUrl: 'https://example.com/policy/fcc-2026' },
    { policyId: 'pol-doe-vi', market: 'US', authority: 'DOE', topic: 'Level VI energy efficiency standard', effectiveAt: '2026-03-01', summary: 'External power supplies must meet DOE Level VI efficiency requirements; non-compliant listings risk removal from major US marketplaces.', sourceUrl: 'https://example.com/policy/doe-vi' },
  ],
}

const reviewIds = new Set(dataset.reviews.map((r) => r.reviewId))
const policyIds = new Set(dataset.policies.map((p) => p.policyId))

const health = await fetch(`${base}/health`)
const healthBody = await health.json()
console.log('[1] /health ->', health.status, JSON.stringify(healthBody))
if (health.status !== 200 || !healthBody.ok || !healthBody.providerConfigured) {
  console.error('FAIL: health check did not report a configured provider')
  process.exit(1)
}

const started = Date.now()
const response = await fetch(`${base}/api/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(dataset),
})
console.log('[2] /api/analyze ->', response.status, `(${((Date.now() - started) / 1000).toFixed(1)}s)`)
if (!response.ok) {
  console.error('FAIL: upstream error body =', await response.text())
  process.exit(1)
}
const envelope = await response.json()

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

let content = null
try {
  content = JSON.parse(envelope.choices?.[0]?.message?.content ?? '')
} catch (error) {
  check('model content parses as JSON', false, String(error))
}
if (content) {
  check('choices envelope present', Array.isArray(envelope.choices) && envelope.choices.length > 0)
  check('model = ' + (envelope.model || 'unknown'), true)

  const themes = content.themes
  check('themes is an array (<=20)', Array.isArray(themes) && themes.length <= 20, `${themes?.length ?? 'n/a'} themes`)
  const themeOk = Array.isArray(themes) && themes.every((t) =>
    typeof t.id === 'string' && t.id.length >= 1 && t.id.length <= 80 &&
    typeof t.label === 'string' && t.label.length >= 1 && t.label.length <= 200 &&
    ['positive', 'negative'].includes(t.sentiment) &&
    Array.isArray(t.reviewIds) && t.reviewIds.length >= 1 && t.reviewIds.length <= 100)
  check('theme shape matches zod contract', themeOk)

  const unknownReviews = (themes ?? []).flatMap((t) => (t.reviewIds ?? []).filter((id) => !reviewIds.has(id)))
  check('zero hallucinated reviewIds', unknownReviews.length === 0, unknownReviews.length ? `unknown: ${unknownReviews.join(', ')}` : 'all cited IDs exist')

  const risks = content.complianceRisks
  check('complianceRisks is an array (<=20)', Array.isArray(risks) && risks.length <= 20, `${risks?.length ?? 'n/a'} risks`)
  const riskOk = Array.isArray(risks) && risks.every((r) =>
    typeof r.id === 'string' && r.id.length >= 1 && r.id.length <= 80 &&
    typeof r.label === 'string' && r.label.length >= 1 && r.label.length <= 200 &&
    ['low', 'medium', 'high'].includes(r.severity) &&
    Array.isArray(r.policyIds) && r.policyIds.length >= 1 && r.policyIds.length <= 50)
  check('risk shape matches zod contract', riskOk)

  const unknownPolicies = (risks ?? []).flatMap((r) => (r.policyIds ?? []).filter((id) => !policyIds.has(id)))
  check('zero hallucinated policyIds', unknownPolicies.length === 0, unknownPolicies.length ? `unknown: ${unknownPolicies.join(', ')}` : 'all cited IDs exist')

  const thermal = JSON.stringify(themes ?? []).toLowerCase()
  check('output is grounded in the data', thermal.includes('hot') || thermal.includes('heat') || thermal.includes('cable') || thermal.includes('price') || thermal.includes('value'), 'mentions an actual review theme')
}

const failed = checks.filter((c) => !c.ok)
console.log(`\nResult: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0 || checks.length === 0) process.exit(1)
console.log('SMOKE OK — real Bailian link is live and contract-compliant.')
