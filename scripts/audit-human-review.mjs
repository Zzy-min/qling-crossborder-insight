import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../artifacts/evaluation/human-review.json')
const document = JSON.parse(await readFile(path, 'utf8'))
const allowedDecisions = new Set(['accept', 'revise'])
const completed = []
const invalid = []

for (const item of document.cases ?? []) {
  const reviewers = [item.reviewer1, item.reviewer2]
  const ids = reviewers.map((reviewer) => reviewer?.reviewerId?.trim()).filter(Boolean)
  const decisionsValid = reviewers.every((reviewer) => allowedDecisions.has(reviewer?.decision))
  const independent = ids.length === 2 && ids[0] !== ids[1]
  const resolutionComplete = item.resolution?.status === 'agreed'
    || (item.resolution?.status === 'resolved' && item.resolution?.notes?.trim())
  if (decisionsValid && independent && resolutionComplete) completed.push(item.id)
  else if (ids.length > 0 || reviewers.some((reviewer) => reviewer?.decision)) invalid.push(item.id)
}

const total = document.cases?.length ?? 0
const result = {
  totalCases: total,
  doubleReviewedCases: completed.length,
  remainingCases: total - completed.length,
  partiallyFilledOrInvalidCases: invalid,
  containsDirectIdentityFields: false,
  complete: total === 200 && completed.length === total && invalid.length === 0,
}
console.log(JSON.stringify(result, null, 2))
if (invalid.length > 0) process.exitCode = 1
