import { describe, expect, it } from 'vitest'
import { decisionState } from './decision'
import type { InsightReport } from './types'

function reportWith(score: number, totalClaims = 10): InsightReport {
  return { opportunityScore: score, evidenceCoverage: { totalClaims, claimsWithEvidence: totalClaims, coverageRate: 1, reviewEvidenceCount: 1, productEvidenceCount: 1, policyEvidenceCount: 1, missingClaimIds: [] } } as unknown as InsightReport
}

describe('decisionState', () => {
  it('recommends hold when there are no claims at all', () => {
    expect(decisionState(reportWith(90, 0))).toEqual({ key: 'hold', label: '暂缓进入' })
  })

  it('recommends hold below score 40', () => {
    expect(decisionState(reportWith(39))).toEqual({ key: 'hold', label: '暂缓进入' })
  })

  it('recommends gathering between 40 and 60', () => {
    expect(decisionState(reportWith(59))).toEqual({ key: 'gather', label: '补充证据' })
  })

  it('recommends validation at 60 and above', () => {
    expect(decisionState(reportWith(60))).toEqual({ key: 'validate', label: '进入验证' })
  })
})
