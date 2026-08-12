const identityKey = /^(name|fullName|email|phone|mobile|employer|company)$/i
const allowedDecision = new Set(['accept', 'revise'])

function containsIdentityKey(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsIdentityKey)
  return Object.entries(value).some(([key, child]) => identityKey.test(key) || containsIdentityKey(child))
}

export function buildBlindReviewPackets(cases) {
  const blindCases = cases.map((item) => ({
    id: item.id,
    family: item.family,
    input: {
      reviewTitle: item.dataset.reviews[0]?.title ?? '',
      reviewBody: item.dataset.reviews[0]?.body ?? '',
      policyIds: item.dataset.policies.map((policy) => policy.policyId),
    },
    decision: '',
    themeIds: [],
    riskIds: [],
    notes: '',
  }))
  const packet = () => ({ schemaVersion: '2.0', reviewerId: '', cases: structuredClone(blindCases) })
  return {
    reviewerA: packet(),
    reviewerB: packet(),
    resolution: {
      schemaVersion: '2.0',
      cases: cases.map((item) => ({
        id: item.id,
        machineExpectation: item.expected,
        status: 'pending',
        themeIds: [],
        riskIds: [],
        notes: '',
      })),
    },
  }
}

export function auditHumanReview(reviewerA, reviewerB, resolution, expectedCount = 200) {
  const reviewerIds = [reviewerA.reviewerId?.trim(), reviewerB.reviewerId?.trim()]
  const independentReviewers = reviewerIds.every(Boolean) && reviewerIds[0] !== reviewerIds[1]
  const byId = (document) => new Map((document.cases ?? []).map((item) => [item.id, item]))
  const aCases = byId(reviewerA)
  const bCases = byId(reviewerB)
  const resolutions = byId(resolution)
  const allIds = new Set([...aCases.keys(), ...bCases.keys(), ...resolutions.keys()])
  const completed = []
  const partiallyFilledOrInvalidCases = []

  for (const id of allIds) {
    const a = aCases.get(id)
    const b = bCases.get(id)
    const resolved = resolutions.get(id)
    const reviewsValid = [a, b].every((item) => item && allowedDecision.has(item.decision))
    const resolutionValid = resolved?.status === 'agreed'
      || (resolved?.status === 'resolved' && Boolean(resolved.notes?.trim()))
    if (reviewsValid && resolutionValid && independentReviewers) completed.push(id)
    else if ([a, b].some((item) => item?.decision || item?.notes?.trim()) || resolved?.status !== 'pending') partiallyFilledOrInvalidCases.push(id)
  }

  const containsDirectIdentityFields = [reviewerA, reviewerB, resolution].some(containsIdentityKey)
  return {
    totalCases: allIds.size,
    doubleReviewedCases: completed.length,
    remainingCases: Math.max(0, expectedCount - completed.length),
    independentReviewers,
    partiallyFilledOrInvalidCases,
    containsDirectIdentityFields,
    complete: allIds.size === expectedCount
      && completed.length === expectedCount
      && partiallyFilledOrInvalidCases.length === 0
      && independentReviewers
      && !containsDirectIdentityFields,
  }
}
