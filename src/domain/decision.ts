import type { InsightReport } from './types'

export type DecisionKey = 'hold' | 'gather' | 'validate'

export interface DecisionState {
  key: DecisionKey
  label: string
}

/**
 * 决策状态的唯一权威实现。
 * 原先 WorkspaceShell 与 ReportView 各自内联阈值并产出不同文案
 * （「进入验证」vs「建议进入验证」），现统一由本模块导出。
 */
export function decisionState(report: InsightReport): DecisionState {
  if (report.evidenceCoverage.totalClaims === 0 || report.opportunityScore < 40) return { key: 'hold', label: '暂缓进入' }
  if (report.opportunityScore < 60) return { key: 'gather', label: '补充证据' }
  return { key: 'validate', label: '进入验证' }
}
