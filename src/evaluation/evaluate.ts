import type { InsightReport } from '../domain/types'

export interface GoldenExpectation {
  themeIds: string[]
  riskIds: string[]
}

export interface EvaluationResult {
  themeRecall: number
  riskRecall: number
  evidenceCoverage: number
  unknownEvidenceCount: number
  passed: boolean
}

export function evaluateReport(
  report: InsightReport,
  expected: GoldenExpectation,
  knownRecordIds: Set<string>,
): EvaluationResult {
  const recall = (actual: string[], wanted: string[]) => wanted.length === 0
    ? 1
    : wanted.filter((id) => actual.includes(id)).length / wanted.length
  const findings = [...report.themes, ...report.complianceRisks]
  const evidence = findings.flatMap((finding) => finding.evidence)
  const evidenceCoverage = findings.length === 0
    ? 1
    : findings.filter((finding) => finding.evidence.length > 0).length / findings.length
  const unknownEvidenceCount = evidence.filter((item) => !knownRecordIds.has(item.recordId)).length
  const themeRecall = recall(report.themes.map((theme) => theme.id), expected.themeIds)
  const riskRecall = recall(report.complianceRisks.map((risk) => risk.id), expected.riskIds)

  return {
    themeRecall,
    riskRecall,
    evidenceCoverage,
    unknownEvidenceCount,
    passed: themeRecall >= 0.8 && riskRecall >= 0.8 && evidenceCoverage === 1 && unknownEvidenceCount === 0,
  }
}
