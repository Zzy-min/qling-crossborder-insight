const marketLabels: Record<string, string> = { US: '美国', EU: '欧盟' }
const severityLabels: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' }

/** 内部市场枚举（US/EU）→ 用户可读的中文名称。未知值原样返回。 */
export function marketLabel(market: string): string {
  return marketLabels[market] ?? market
}

/** 内部严重度枚举（low/medium/high）→ 用户可读的中文标签。未知值原样返回。 */
export function severityLabel(severity: string): string {
  return severityLabels[severity] ?? severity
}
