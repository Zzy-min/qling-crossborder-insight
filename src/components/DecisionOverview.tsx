import type { InsightReport, ReviewTheme } from '../domain/types'
import type { CompetitorSnapshot, PricingResult } from '../domain/market'
import type { MarketScope } from '../domain/scope'
import { marketLabel, severityLabel, currencySymbol } from '../domain/labels'

function quadrantBadge(theme: ReviewTheme) {
  if (theme.quadrant === 'urgent_fix') return <span className="quadrant-chip urgent">🚨 致命短板</span>
  if (theme.quadrant === 'emerging_risk') return <span className="quadrant-chip risk">⚠️ 隐性痛点</span>
  if (theme.quadrant === 'core_strength') return <span className="quadrant-chip strength">💎 核心卖点</span>
  return <span className="quadrant-chip opp">💡 差异机会</span>
}

export function DecisionOverview({
  report,
  marketScope,
  snapshots,
  price,
  landedCost,
  pricing,
  onPrice,
  onCost,
  onOpenTheme,
  onOpenScore,
  onOpenRisk,
}: {
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
  const defaultCurrency = snapshots[0]?.currency ?? (marketScope === 'EU' ? 'EUR' : marketScope === 'JP' ? 'JPY' : marketScope === 'UK' ? 'GBP' : 'USD')
  const symbol = currencySymbol(defaultCurrency)
  const highRisks = report.complianceRisks.filter((risk) => risk.severity === 'high').length
  const visualConcepts = report.visualConcepts ?? []

  return (
    <section className="workspace-page opportunity-page">
      <header className="page-heading compact">
        <div>
          <span className="page-index">02 / OPPORTUNITY</span>
          <h1>市场机会，不止一个分数。</h1>
        </div>
        <p>先看证据是否完整，再看痛点四象限、竞品矩阵与合规门槛如何共同影响进入决策。</p>
      </header>

      {/* KPI 卡片栏 */}
      <div className="kpi-ledger" aria-label="核心指标">
        <div className="primary-kpi">
          <span>机会指数</span>
          <strong>{report.opportunityScore}</strong>
          <small>确定性加权 / 100</small>
        </div>
        <div>
          <span>证据覆盖率</span>
          <strong>{Math.round(report.evidenceCoverage.coverageRate * 100)}%</strong>
          <small>{report.evidenceCoverage.claimsWithEvidence}/{report.evidenceCoverage.totalClaims} 项结论有依据</small>
        </div>
        <div>
          <span>关键痛点</span>
          <strong>{report.themes.length}</strong>
          <small>{report.evidenceCoverage.reviewEvidenceCount} 条评论证据</small>
        </div>
        <div>
          <span>高风险事项</span>
          <strong>{highRisks}</strong>
          <small>{report.complianceRisks.length} 项需人工复核</small>
        </div>
      </div>

      {/* 第一行：评分贡献 + 评论痛点（四象限分类） */}
      <div className="overview-grid">
        <section className="ledger-section score-section">
          <div className="section-title">
            <div>
              <span>SCORE LEDGER</span>
              <h2>评分贡献</h2>
            </div>
            <span className="trust-chip">规则计算 · 模型不可改分</span>
          </div>
          <div className="score-table">
            <div className="table-head"><span>维度</span><span>原始分</span><span>权重</span><span>贡献</span></div>
            {report.scoreContributions.map((item, index) => (
              <button type="button" key={item.key} onClick={() => onOpenScore(index)}>
                <span>
                  <strong>{item.label}</strong>
                  <i><b style={{ width: `${item.rawScore}%` }} /></i>
                </span>
                <span>{item.rawScore}</span>
                <span>{item.direction === 'subtract' ? '−' : '+'}{Math.round(item.weight * 100)}%</span>
                <span className={item.weightedContribution < 0 ? 'negative' : ''}>
                  {item.weightedContribution > 0 ? '+' : ''}{item.weightedContribution}
                </span>
              </button>
            ))}
          </div>
          <p className="formula">机会指数 = 痛点×30% + 改进空间×25% + 竞争利润×20% + 可信度×10% − 合规×15%</p>
        </section>

        <section className="ledger-section pain-section">
          <div className="section-title">
            <div>
              <span>REVIEW SIGNALS</span>
              <h2>评论痛点与四象限</h2>
            </div>
            <small>点击查看原始证据</small>
          </div>
          <div className="signal-list">
            {report.themes.map((theme, index) => (
              <button type="button" key={theme.id} onClick={() => onOpenTheme(index)}>
                <span className="signal-rank">0{index + 1}</span>
                <span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong>{theme.label}</strong>
                    {quadrantBadge(theme)}
                  </div>
                  <small>“{theme.evidence[0]?.excerpt}”</small>
                </span>
                <span className="evidence-count">{theme.evidence.length} 条依据 →</span>
              </button>
            ))}
            {!report.themes.length && <p className="empty-state">当前样本未形成有证据支持的关键痛点。</p>}
          </div>
        </section>
      </div>

      {/* 第二行：百炼多模态/视觉改良概念 (Visual Improvement Concepts) */}
      {visualConcepts.length > 0 && (
        <section className="ledger-section visual-concept-section">
          <div className="section-title">
            <div>
              <span>AI VISUAL CONCEPTS</span>
              <h2>痛点改良设计方案与视觉概念 (通义万相 Prompt)</h2>
            </div>
            <span className="trust-chip">证据锚定 · 零凭空捏造</span>
          </div>
          <div className="concept-grid">
            {visualConcepts.map((concept, index) => (
              <div key={concept.id} className="concept-card">
                <div className="concept-header">
                  <span className="concept-tag">设计改良方案 #{index + 1}</span>
                  <span className="feasibility-badge">可行性: {concept.feasibility === 'high' ? '高' : '中'}</span>
                </div>
                <h3>{concept.conceptTitle}</h3>
                <p className="concept-desc"><strong>改良架构：</strong>{concept.designSolution}</p>
                <div className="concept-meta">
                  <span>成本影响：{concept.estimatedCost}</span>
                  <span>关联证据：{concept.citableReviewIds.length} 条评论</span>
                </div>
                <div className="concept-prompt-box">
                  <small>通义万相生图提示词：</small>
                  <code>{concept.imagePrompt}</code>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 第三行：竞品与价格带快照 */}
      <section className="ledger-section competitor-section">
        <div className="section-title">
          <div>
            <span>COMPETITOR SNAPSHOT</span>
            <h2>竞品与价格带</h2>
          </div>
          <small>本地演示快照，不代表实时市场</small>
        </div>
        {snapshots.map((snapshot) => (
          <div className="snapshot-block" key={snapshot.currency}>
            <div className="snapshot-caption">
              <strong>{snapshot.currency === 'USD' ? '美国市场' : snapshot.currency === 'EUR' ? '欧盟市场' : snapshot.currency === 'JPY' ? '日本市场' : '英国市场'} · {snapshot.currency}</strong>
              <span>价格中位数 {currencySymbol(snapshot.currency)}{snapshot.medianPrice} · 评分中位数 {snapshot.medianRating}</span>
            </div>
            <div className="competitor-table">
              <div className="table-head">
                <span>竞品</span><span>售价</span><span>评分</span><span>评论量</span><span>相对中位价</span>
              </div>
              {snapshot.products.map((product) => (
                <div key={product.productId}>
                  <span><strong>{product.brand}</strong><small>{product.title}</small></span>
                  <span>{currencySymbol(product.currency)}{product.price}</span>
                  <span>{product.rating}</span>
                  <span>{product.reviewCount.toLocaleString()}</span>
                  <span className={product.price <= snapshot.medianPrice ? 'positive' : ''}>
                    {product.price <= snapshot.medianPrice ? '低' : '高'} {currencySymbol(product.currency)}{Math.abs(product.price - snapshot.medianPrice).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 第四行：定价情景 + 多市场合规准入雷达 */}
      <div className="overview-grid lower-grid">
        <section className="ledger-section pricing-section">
          <div className="section-title">
            <div>
              <span>PRICING SCENARIO</span>
              <h2>定价与毛利敏感性模拟</h2>
            </div>
            <span className="assumption-chip">平台 15% · 广告 12% · 启动 {symbol}2,500</span>
          </div>
          <div className="pricing-form">
            <label>
              售价（{defaultCurrency}）
              <input aria-label="售价" type="number" min="0.01" step="0.01" value={price} onChange={(event) => onPrice(Number(event.target.value))} />
            </label>
            <label>
              到岸成本（{defaultCurrency}）
              <input aria-label="到岸成本" type="number" min="0" step="0.01" value={landedCost} onChange={(event) => onCost(Number(event.target.value))} />
            </label>
          </div>
          {pricing ? (
            <div className="pricing-ledger">
              <div><span>单件边际贡献</span><strong>{symbol}{pricing.contributionPerUnit}</strong></div>
              <div><span>贡献毛利率</span><strong>{(pricing.contributionMarginRate * 100).toFixed(2)}%</strong></div>
              <div><span>保本销量</span><strong>{pricing.breakEvenUnits} 件</strong></div>
              <p className="profit-state">✓ 当前情景单件边际贡献为正，可覆盖固定投入</p>
            </div>
          ) : (
            <p className="scenario-error" role="status">当前售价不足以覆盖成本和费率，请调整参数。</p>
          )}
        </section>

        <section className="ledger-section risk-preview">
          <div className="section-title">
            <div>
              <span>COMPLIANCE RADAR</span>
              <h2>多市场合规准入待办</h2>
            </div>
            <small>US / EU / JP / UK 官方来源核验</small>
          </div>
          {report.complianceRisks.map((risk, index) => (
            <button type="button" key={risk.id} onClick={() => onOpenRisk(index)}>
              <span className={`severity ${risk.severity}`}>{marketLabel(risk.market)} · {severityLabel(risk.severity)}</span>
              <strong>{risk.label}</strong>
              <small>{risk.evidence.length} 条官方依据 · 需人工复核 →</small>
            </button>
          ))}
        </section>
      </div>
    </section>
  )
}
