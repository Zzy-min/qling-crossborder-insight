import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInsightReport } from '../src/domain/analysis'
import { evaluateReport, summarizeEvaluation } from '../src/evaluation/evaluate'
import { goldenCases } from '../src/evaluation/goldenSet'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const results = goldenCases.map((goldenCase) => {
  const report = buildInsightReport(goldenCase.dataset, '2026-08-12T00:00:00.000Z')
  const knownIds = new Set([
    ...goldenCase.dataset.products.map((row) => row.productId),
    ...goldenCase.dataset.reviews.map((row) => row.reviewId),
    ...goldenCase.dataset.policies.map((row) => row.policyId),
  ])
  return { id: goldenCase.id, family: goldenCase.family, reviewStatus: goldenCase.reviewStatus, ...evaluateReport(report, goldenCase.expected, knownIds) }
})
const summary = summarizeEvaluation(results)
const output = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  datasetKind: 'machine-seeded-fixture',
  humanReviewedCases: results.filter((result) => result.reviewStatus === 'human-reviewed').length,
  summary,
  results,
}
const outputPath = resolve(root, 'artifacts/evaluation/golden-report.json')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, datasetKind: output.datasetKind, humanReviewedCases: output.humanReviewedCases, ...summary }, null, 2))
if (!summary.passed) process.exitCode = 1
