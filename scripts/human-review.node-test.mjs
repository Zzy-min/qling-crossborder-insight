import test from 'node:test'
import assert from 'node:assert/strict'
import { auditHumanReview, buildBlindReviewPackets } from './human-review.mjs'

const cases = [{
  id: 'golden-001',
  family: 'thermal',
  dataset: { reviews: [{ title: 'hot', body: 'Gets hot.' }], policies: [{ policyId: 'policy-1' }] },
  expected: { themeIds: ['thermal'], riskIds: ['policy-1'] },
}]

test('blind packets do not expose machine expectations or the other reviewer', () => {
  const packets = buildBlindReviewPackets(cases)
  for (const packet of [packets.reviewerA, packets.reviewerB]) {
    const serialized = JSON.stringify(packet)
    assert.equal(serialized.includes('machineExpectation'), false)
    assert.equal(serialized.includes('expected'), false)
    assert.equal(serialized.includes('reviewer1'), false)
    assert.equal(serialized.includes('reviewer2'), false)
  }
  assert.deepEqual(packets.resolution.cases[0].machineExpectation, cases[0].expected)
})

test('audit detects direct identity keys recursively', () => {
  const audit = auditHumanReview({ cases: [] }, { cases: [] }, { cases: [], metadata: { email: 'x@example.com' } })
  assert.equal(audit.containsDirectIdentityFields, true)
  assert.equal(audit.complete, false)
})

test('audit requires different reviewers and a resolved decision', () => {
  const reviewerA = { reviewerId: 'reviewer-a', cases: [{ id: 'golden-001', decision: 'accept', themeIds: ['thermal'], riskIds: ['policy-1'], notes: '' }] }
  const reviewerB = { reviewerId: 'reviewer-b', cases: [{ id: 'golden-001', decision: 'accept', themeIds: ['thermal'], riskIds: ['policy-1'], notes: '' }] }
  const resolution = { cases: [{ id: 'golden-001', status: 'agreed', themeIds: ['thermal'], riskIds: ['policy-1'], notes: '' }] }
  assert.equal(auditHumanReview(reviewerA, reviewerB, resolution, 1).complete, true)
  reviewerB.reviewerId = 'reviewer-a'
  assert.equal(auditHumanReview(reviewerA, reviewerB, resolution, 1).complete, false)
})
