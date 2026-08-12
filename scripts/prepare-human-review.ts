import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenCases } from '../src/evaluation/goldenSet'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputPath = resolve(root, 'artifacts/evaluation/human-review.json')
const review = {
  schemaVersion: '1.0',
  instructions: {
    reviewerIds: 'Use stable pseudonymous IDs; do not record names, emails or phone numbers.',
    independentReview: 'Reviewer 2 must decide before reading reviewer 1 notes.',
    decision: 'Set decision to accept or revise and enter observed theme/risk IDs.',
    resolution: 'Disagreements require a resolution note before a case counts as complete.',
  },
  cases: goldenCases.map((item) => ({
    id: item.id,
    family: item.family,
    input: {
      reviewTitle: item.dataset.reviews[0]?.title,
      reviewBody: item.dataset.reviews[0]?.body,
      policyIds: item.dataset.policies.map((policy) => policy.policyId),
    },
    machineExpectation: item.expected,
    reviewer1: { reviewerId: '', decision: '', themeIds: [], riskIds: [], notes: '' },
    reviewer2: { reviewerId: '', decision: '', themeIds: [], riskIds: [], notes: '' },
    resolution: { status: 'pending', themeIds: [], riskIds: [], notes: '' },
  })),
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'EEXIST') throw new Error(`Review file already exists and was not overwritten: ${outputPath}`)
  throw error
})
console.log(JSON.stringify({ outputPath, cases: review.cases.length, status: 'awaiting-independent-review' }, null, 2))
