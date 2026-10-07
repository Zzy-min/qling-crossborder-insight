import { describe, expect, it } from 'vitest'
import { buildInsightReport } from './analysis'
import { buildEvidenceIntegrity, buildEvidencePayload, sha256Hex, shortDigest } from './integrity'
import { sampleDataset } from '../fixtures/usbCChargers'
import type { InsightReport } from './types'

const generatedAt = '2026-08-27T00:00:00.000Z'

describe('sha256Hex', () => {
  it('covers anchor coordinates, aspect identity and evidence protocol in the new digest', () => {
    const report = buildInsightReport(sampleDataset)
    const digest = () => buildEvidenceIntegrity(report, 'test', { version: 2, dataset: sampleDataset }).digest
    const original = digest()
    report.themes[0].evidence[0].quoteAnchor!.start += 1
    expect(digest()).not.toBe(original)
    report.themes[0].evidence[0].quoteAnchor!.start -= 1
    report.themes[0].aspectId = 'other'
    expect(digest()).not.toBe(original)
  })
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('The quick brown fox jumps over the lazy dog'))
      .toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592')
  })

  it('matches the platform implementation across padding and multi-byte boundaries', async () => {
    const { createHash } = await import('node:crypto')
    const samples = [
      'a',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      '智能宠物喂食器 漏粮卡粮',
      '中文 emoji 🐈 \ud800',
      'x'.repeat(1000),
    ]
    for (const sample of samples) {
      expect(sha256Hex(sample)).toBe(createHash('sha256').update(sample, 'utf8').digest('hex'))
    }
  })

  it('returns a 64 character lowercase hex digest', () => {
    expect(sha256Hex('qling')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildEvidenceIntegrity', () => {
  const report = buildInsightReport(sampleDataset, generatedAt)

  it('covers every clustered theme and evidence reference in the report', () => {
    const integrity = buildEvidenceIntegrity(report, 'USB-C|US')
    const expectedEvidence = [...report.themes, ...report.complianceRisks]
      .reduce((total, item) => total + item.evidence.length, 0)

    expect(integrity.algorithm).toBe('SHA-256')
    expect(integrity.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(integrity.coveredThemes).toBe(report.themes.length)
    expect(integrity.coveredEvidence).toBe(expectedEvidence)
    expect(integrity.coveredClaims).toBe(report.evidenceCoverage.totalClaims)
  })

  it('is stable across exports of the same evidence chain', () => {
    const later = buildInsightReport(sampleDataset, '2026-09-30T11:22:33.000Z')
    expect(buildEvidenceIntegrity(later, 'USB-C|US').digest)
      .toBe(buildEvidenceIntegrity(report, 'USB-C|US').digest)
  })

  it('changes when a single evidence reference is replaced', () => {
    const before = buildEvidenceIntegrity(report, 'USB-C|US').digest
    const tampered: InsightReport = {
      ...report,
      themes: report.themes.map((theme, index) => (index === 0
        ? {
            ...theme,
            evidence: theme.evidence.map((reference, referenceIndex) => (referenceIndex === 0
              ? { ...reference, recordId: `${reference.recordId}-tampered` }
              : reference)),
          }
        : theme)),
    }

    expect(buildEvidenceIntegrity(tampered, 'USB-C|US').digest).not.toBe(before)
  })

  it('changes when the declared scope changes', () => {
    expect(buildEvidenceIntegrity(report, 'USB-C|EU').digest)
      .not.toBe(buildEvidenceIntegrity(report, 'USB-C|US').digest)
  })

  it('keeps the payload free of export timestamps', () => {
    expect(buildEvidencePayload(report, 'USB-C|US')).not.toContain(generatedAt)
  })
})

describe('shortDigest', () => {
  it('keeps the prefix readable in the interface', () => {
    expect(shortDigest('abcdef0123456789feed', 16)).toBe('ABCDEF0123456789')
  })
})
