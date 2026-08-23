import type { InsightReport } from '../domain/types'
import type { CompetitorSnapshot, PricingResult } from '../domain/market'
import type { MarketScope } from '../domain/scope'
import { marketLabel, severityLabel } from '../domain/labels'

export function DecisionOverview({ report, marketScope, snapshots, price, landedCost, pricing, onPrice, onCost, onOpenTheme, onOpenScore, onOpenRisk }: {
  report: InsightReport
  marketScope: MarketScope
  snapshots: CompetitorSnapshot[]
  price: number
  landedCost: number
  pricing: PricingResult | null
  onPrice: (value: number) => void
  onCost: (value: number) => void
  onOpenTheme: (index: number) => void
  onOpenScore: (index: number) => void
  onOpenRisk: (index: number) => void
}) {
  const currency = marketScope === 'EU' ? 'EUR' : 'USD'
  const symbol = currency === 'EUR' ? '€' : '$'
  const highRisks = report.complianceRisks.filter((risk) => risk.severity === 'high').length
  return <section className="workspace-page opportunity-page">
    <header className="page-heading compact"><div><span className="page-index">02 / OPPORTUNITY</span><h1>市场机会，不止一个分数。</h1></div><p>先看证据是否完整，再看痛点、竞争与合规如何共同影响进入决策。</p></header>

    <div className="kpi-ledger" aria-label="核心指标">
      <div className="primary-kpi"><span>机会指数</span><strong>{report.opportunityScore}</strong><small>确定性加权 / 100</small></div>
      <div><span>证据覆盖率</span><strong>{Math.round(report.evidenceCoverage.coverageRate * 100)}%</strong><small>{report.evidenceCoverage.claimsWithEvidence}/{report.evidenceCoverage.totalClaims} 项结论有依据</small></div>
      <div><span>关键痛点</span><strong>{report.themes.length}</strong><small>{report.evidenceCoverage.reviewEvidenceCount} 条评论证据</small></div>
      <div><span>高风险事项</span><strong>{highRisks}</strong><small>{report.complianceRisks.length} 项需人工复核</small></div>
    </div>

    <div className="overview-grid">
      <section className="ledger-section score-section">
        <div className="section-title"><div><span>SCORE LEDGER</span><h2>评分贡献</h2></div><span className="trust-chip">规则计算 · 模型不可改分</span></div>
        <div className="score-table">
          <div className="table-head"><span>维度</span><span>原始分</span><span>权重</span><span>贡献</span></div>
          {report.scoreContributions.map((item, index) => <button type="button" key={item.key} onClick={() => onOpenScore(index)}>
            <span><strong>{item.label}</strong><i><b style={{ width: `${item.rawScore}%` }} /></i></span><span>{item.rawScore}</span><span>{item.direction === 'subtract' ? '−' : '+'}{Math.round(item.weight * 100)}%</span><span className={item.weightedContribution < 0 ? 'negative' : ''}>{item.weightedContribution > 0 ? '+' : ''}{item.weightedContribution}</span>
          </button>)}
        </div>
        <p className="formula">机会指数 = 痛点×30% + 改进空间×25% + 竞争利润×20% + 可信度×10% − 合规×15%</p>
      </section>

      <section className="ledger-section pain-section">
        <div className="section-title"><div><span>REVIEW SIGNALS</span><h2>评论痛点</h2></div><small>点击查看原始证据</small></div>
        <div className="signal-list">
          {report.themes.map((theme, index) => <button type="button" key={theme.id} onClick={() => onOpenTheme(index)}><span className="signal-rank">0{index + 1}</span><span><strong>{theme.label}</strong><small>“{theme.evidence[0]?.excerpt}”</small></span><span className="evidence-count">{theme.evidence.length} 条依据 →</span></button>)}
          {!report.themes.length && <p className="empty-state">当前样本未形成有证据支持的关键痛点。</p>}
        </div>
      </section>
    </div>

    <section className="ledger-section competitor-section">
      <div className="section-title"><div><span>COMPETITOR SNAPSHOT</span><h2>竞品与价格带</h2></div><small>本地演示快照，不代表实时市场</small></div>
      {snapshots.map((snapshot) => <div className="snapshot-block" key={snapshot.currency}><div className="snapshot-caption"><strong>{snapshot.currency === 'USD' ? '美国市场' : '欧盟市场'} · {snapshot.currency}</strong><span>价格中位数 {snapshot.currency === 'USD' ? '$' : '€'}{snapshot.medianPrice} · 评分中位数 {snapshot.medianRating}</span></div><div className="competitor-table"><div className="table-head"><span>竞品</span><span>售价</span><span>评分</span><span>评论量</span><span>相对中位价</span></div>{snapshot.products.map((product) => <div key={product.productId}><span><strong>{product.brand}</strong><small>{product.title}</small></span><span>{snapshot.currency === 'USD' ? '$' : '€'}{product.price}</span><span>{product.rating}</span><span>{product.reviewCount.toLocaleString()}</span><span className={product.price <= snapshot.medianPrice ? 'positive' : ''}>{product.price <= snapshot.medianPrice ? '低' : '高'} {snapshot.currency === 'USD' ? '$' : '€'}{Math.abs(product.price - snapshot.medianPrice).toFixed(2)}</span></div>)}</div></div>)}
    </section>

    <div className="overview-grid lower-grid">
      <section className="ledger-section pricing-section">
        <div className="section-title"><div><span>PRICING SCENARIO</span><h2>定价情景</h2></div><span className="assumption-chip">平台 15% · 广告 12% · 启动 {symbol}2,500</span></div>
        <div className="pricing-form"><label>售价（{currency}）<input aria-label="售价" type="number" min="0.01" step="0.01" value={price} onChange={(event) => onPrice(Number(event.target.value))} /></label><label>到岸成本（{currency}）<input aria-label="到岸成本" type="number" min="0" step="0.01" value={landedCost} onChange={(event) => onCost(Number(event.target.value))} /></label></div>
        {pricing ? <div className="pricing-ledger"><div><span>单件贡献</span><strong>{symbol}{pricing.contributionPerUnit}</strong></div><div><span>贡献率</span><strong>{(pricing.contributionMarginRate * 100).toFixed(2)}%</strong></div><div><span>保本销量</span><strong>{pricing.breakEvenUnits} 件</strong></div><p className="profit-state">✓ 当前情景可覆盖单位成本</p></div> : <p className="scenario-error" role="status">当前售价不足以覆盖成本和费率，请调整参数。</p>}
      </section>
      <section className="ledger-section risk-preview">
        <div className="section-title"><div><span>COMPLIANCE CHECK</span><h2>合规待办</h2></div><small>仅作信息辅助</small></div>
        {report.complianceRisks.map((risk, index) => <button type="button" key={risk.id} onClick={() => onOpenRisk(index)}><span className={`severity ${risk.severity}`}>{marketLabel(risk.market)} · {severityLabel(risk.severity)}</span><strong>{risk.label}</strong><small>{risk.evidence.length} 条官方依据 · 需人工复核 →</small></button>)}
      </section>
    </div>
  </section>
}
