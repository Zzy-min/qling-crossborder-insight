import type { DatasetBundle, EvidenceRef, InsightReport } from './types'
import type { PricingScenario } from './market'

/**
 * 证据链指纹：把报告里所有可引用的事实做一次确定性序列化后取 SHA-256。
 * 同一份数据重复导出得到同一指纹；替换任意一条引用、改一次提及数，指纹都会变。
 * 时间戳和文字措辞不参与计算，避免同一份证据因为导出时间不同而换指纹。
 */
export interface EvidenceIntegrity {
  schemaVersion?: 'qling-evidence-chain/1' | 'qling-evidence-chain/2'
  coverage?: 'report-references' | 'scoped-dataset'
  algorithm: 'SHA-256'
  digest: string
  coveredThemes: number
  coveredEvidence: number
  coveredClaims: number
  context: string
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 手写 UTF-8 编码，浏览器、Node 与 jsdom 下行为一致，不依赖 TextEncoder。 */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = []
  for (const char of input) {
    const point = char.codePointAt(0) as number
    const code = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(bytes)
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input
  const bitLength = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const schedule = new Uint32Array(64)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const first = rotr(schedule[index - 15], 7) ^ rotr(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)
      const second = rotr(schedule[index - 2], 17) ^ rotr(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)
      schedule[index] = (schedule[index - 16] + first + schedule[index - 7] + second) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + sum1 + choose + K[index] + schedule[index]) >>> 0
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    state[0] = (state[0] + a) >>> 0
    state[1] = (state[1] + b) >>> 0
    state[2] = (state[2] + c) >>> 0
    state[3] = (state[3] + d) >>> 0
    state[4] = (state[4] + e) >>> 0
    state[5] = (state[5] + f) >>> 0
    state[6] = (state[6] + g) >>> 0
    state[7] = (state[7] + h) >>> 0
  }

  return [...state].map((value) => value.toString(16).padStart(8, '0')).join('')
}

function evidenceKey(reference: EvidenceRef): string {
  return [reference.evidenceType, reference.recordId, reference.capturedAt, reference.sourceUrl].join('|')
}

export function buildEvidencePayload(report: InsightReport, context: string): string {
  const themes = [...report.themes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((theme) => ({
      id: theme.id,
      label: theme.label,
      sentiment: theme.sentiment,
      mentions: theme.mentions,
      quadrant: theme.quadrant ?? null,
      evidence: theme.evidence.map(evidenceKey).sort(),
    }))

  const risks = [...report.complianceRisks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((risk) => ({
      id: risk.id,
      market: risk.market,
      label: risk.label,
      severity: risk.severity,
      evidence: risk.evidence.map(evidenceKey).sort(),
    }))

  return JSON.stringify({
    schema: 'qling-evidence-chain/1',
    context,
    providerMode: report.providerMode,
    ...(report.batchRun ? { batchRun: report.batchRun } : {}),
    opportunityScore: report.opportunityScore,
    scoreBreakdown: report.scoreBreakdown,
    dataQuality: {
      totalReviews: report.dataQuality.totalReviews,
      verifiedPurchaseRate: report.dataQuality.verifiedPurchaseRate,
      linkedProducts: report.dataQuality.linkedProducts,
      deduplicatedCount: report.dataQuality.deduplicatedCount,
      marketCoverage: [...report.dataQuality.marketCoverage].sort(),
    },
    evidenceCoverage: {
      totalClaims: report.evidenceCoverage.totalClaims,
      claimsWithEvidence: report.evidenceCoverage.claimsWithEvidence,
      reviewEvidenceCount: report.evidenceCoverage.reviewEvidenceCount,
      productEvidenceCount: report.evidenceCoverage.productEvidenceCount,
      policyEvidenceCount: report.evidenceCoverage.policyEvidenceCount,
      missingClaimIds: [...report.evidenceCoverage.missingClaimIds].sort(),
    },
    themes,
    risks,
  })
}

export interface IntegrityOptions {
  version: 2
  dataset?: DatasetBundle
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) return { nonFiniteNumber: String(item) }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    }
    return item
  })
}

export function buildEvidencePayloadV2(report: InsightReport, context: string, dataset?: DatasetBundle): string {
  const sorted = <Item,>(items: Item[]) => items.map((item) => canonicalJson(item)).sort()
  const references = (items: EvidenceRef[]) => sorted(items)
  return canonicalJson({
    schema: 'qling-evidence-chain/2',
    ...(report.evidenceProtocol ? { evidenceProtocol: report.evidenceProtocol } : {}),
    context,
    coverage: dataset ? 'scoped-dataset' : 'report-references',
    provenance: report.provenance ?? null,
    analysisVersion: report.analysisVersion ?? { rules: 'unknown', prompt: 'unknown', model: 'unknown' },
    providerMode: report.providerMode,
    ...(report.batchRun ? { batchRun: report.batchRun } : {}),
    opportunityScore: report.opportunityScore,
    scoreBreakdown: report.scoreBreakdown,
    dataQuality: report.dataQuality,
    evidenceCoverage: report.evidenceCoverage,
    themes: sorted(report.themes.map((theme) => ({ ...theme, evidence: references(theme.evidence) }))),
    risks: sorted(report.complianceRisks.map((risk) => ({ ...risk, evidence: references(risk.evidence) }))),
    dataset: dataset ? {
      provenance: dataset.provenance ?? null,
      products: sorted(dataset.products),
      reviews: sorted(dataset.reviews),
      policies: sorted(dataset.policies),
    } : null,
  })
}

export interface ScenarioIntegrity {
  schemaVersion: 'qling-pricing-scenario/1' | 'qling-pricing-scenario/2'
  formulaVersion: 'qling-contribution/1'
  algorithm: 'SHA-256'
  digest: string
}

export function buildScenarioIntegrity(scenario: PricingScenario): ScenarioIntegrity {
  const identity = { schemaVersion: scenario.target ? 'qling-pricing-scenario/2' as const : 'qling-pricing-scenario/1' as const, formulaVersion: 'qling-contribution/1' as const }
  return { ...identity, algorithm: 'SHA-256', digest: sha256Hex(canonicalJson({ ...identity, ...scenario })) }
}

export function buildEvidenceIntegrity(report: InsightReport, context: string, options?: IntegrityOptions): EvidenceIntegrity {
  const coveredEvidence = [...report.themes, ...report.complianceRisks]
    .reduce((total, item) => total + item.evidence.length, 0)
  return {
    schemaVersion: options ? 'qling-evidence-chain/2' : 'qling-evidence-chain/1',
    coverage: options?.dataset ? 'scoped-dataset' : 'report-references',
    algorithm: 'SHA-256',
    digest: sha256Hex(options ? buildEvidencePayloadV2(report, context, options.dataset) : buildEvidencePayload(report, context)),
    coveredThemes: report.themes.length,
    coveredEvidence,
    coveredClaims: report.evidenceCoverage.totalClaims,
    context,
  }
}

/** 界面与备忘录里显示指纹前缀，完整值仍然保留在导出产物中。 */
export function shortDigest(digest: string, length = 16): string {
  return digest.slice(0, length).toUpperCase()
}
