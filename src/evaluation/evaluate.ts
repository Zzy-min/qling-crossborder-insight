import type { InsightReport } from '../domain/types'

export interface GoldenExpectation {
  themeIds: string[]
  riskIds: string[]
}

export interface EvaluationResult {
  themePrecision: number
  themeRecall: number
  riskPrecision: number
  riskRecall: number
  evidenceCoverage: number
  unknownEvidenceCount: number
  passed: boolean
}

export interface EvaluationSummary {
  caseCount: number
  passedCases: number
  passRate: number
  meanThemeRecall: number
  meanThemePrecision: number
  meanRiskRecall: number
  meanRiskPrecision: number
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
  const precision = (actual: string[], wanted: string[]) => actual.length === 0
    ? 1
    : actual.filter((id) => wanted.includes(id)).length / actual.length
  const findings = [...report.themes, ...report.complianceRisks]
  const evidence = findings.flatMap((finding) => finding.evidence)
  const evidenceCoverage = findings.length === 0
    ? 1
    : findings.filter((finding) => finding.evidence.length > 0).length / findings.length
  const unknownEvidenceCount = evidence.filter((item) => !knownRecordIds.has(item.recordId)).length
  const actualThemeIds = report.themes.map((theme) => theme.id)
  const actualRiskIds = report.complianceRisks.map((risk) => risk.id)
  const themePrecision = precision(actualThemeIds, expected.themeIds)
  const themeRecall = recall(actualThemeIds, expected.themeIds)
  const riskPrecision = precision(actualRiskIds, expected.riskIds)
  const riskRecall = recall(actualRiskIds, expected.riskIds)

  return {
    themePrecision,
    themeRecall,
    riskPrecision,
    riskRecall,
    evidenceCoverage,
    unknownEvidenceCount,
    passed: themePrecision >= 0.8 && themeRecall >= 0.8 && riskPrecision >= 0.8 && riskRecall >= 0.8 && evidenceCoverage === 1 && unknownEvidenceCount === 0,
  }
}

export function summarizeEvaluation(results: EvaluationResult[]): EvaluationSummary {
  if (results.length === 0) throw new Error('At least one evaluation result is required')
  const average = (select: (result: EvaluationResult) => number) => results.reduce((sum, result) => sum + select(result), 0) / results.length
  const passedCases = results.filter((result) => result.passed).length
  const unknownEvidenceCount = results.reduce((sum, result) => sum + result.unknownEvidenceCount, 0)
  const summary = {
    caseCount: results.length,
    passedCases,
    passRate: average((result) => result.passed ? 1 : 0),
    meanThemePrecision: average((result) => result.themePrecision),
    meanThemeRecall: average((result) => result.themeRecall),
    meanRiskPrecision: average((result) => result.riskPrecision),
    meanRiskRecall: average((result) => result.riskRecall),
    evidenceCoverage: average((result) => result.evidenceCoverage),
    unknownEvidenceCount,
  }
  return { ...summary, passed: summary.passRate >= 0.95 && summary.meanThemePrecision >= 0.8 && summary.meanRiskPrecision >= 0.8 && summary.evidenceCoverage === 1 && unknownEvidenceCount === 0 }
}
