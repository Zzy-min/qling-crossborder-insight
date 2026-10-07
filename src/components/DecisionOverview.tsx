import type { InsightReport, ReviewTheme } from '../domain/types'
import type { CompetitorSnapshot, PricingResult } from '../domain/market'
import { marketLabel, severityLabel, currencySymbol } from '../domain/labels'
import { sampleStatisticsLabel } from '../domain/sample-statistics'

function quadrantBadge(theme: ReviewTheme) {
  if (theme.evidenceLevel === 'quote-anchored/2' && !theme.quadrant) return <span className="quadrant-chip opp">{{ positive: '正向', negative: '负向', neutral: '中性', mixed: '混合' }[theme.sentiment]} · 语义待复核</span>
  if (theme.quadrant === 'urgent_fix') return <span className="quadrant-chip urgent">致命短板</span>
  if (theme.quadrant === 'emerging_risk') return <span className="quadrant-chip risk">隐性痛点</span>
  if (theme.quadrant === 'core_strength') return <span className="quadrant-chip strength">核心卖点</span>
  return <span className="quadrant-chip opp">差异机会</span>
}

function snapshotTitle(currency: string) {
  if (currency === 'USD') return '美国市场'
  if (currency === 'EUR') return '欧盟市场'
  if (currency === 'JPY') return '日本市场'
  if (currency === 'GBP') return '英国市场'
  return currency
}

export function DecisionOverview({
  report,
  snapshots,
  price,
  landedCost,
  pricing,
  fixedLaunchCost,
  onLaunchCost,
  pricingCurrency,
  onPricingCurrency,
  onPrice,
  onCost,
  onOpenTheme,
  onOpenScore,
  onOpenRisk,
  conceptImages = {},
  onGenerateImage,
  onImageError,
  imageGenerationEnabled = false,
  platformRate = 0.15,
  adRate = 0.12,
  onPlatformRate,
  onAdRate,
  realWorkspace = false,
  pricingProductId,
  onPricingProduct,
}: {
  report: InsightReport
  snapshots: CompetitorSnapshot[]
  price: number
  landedCost: number | null
  pricing: PricingResult | null
  fixedLaunchCost: number | null
  onLaunchCost: (value: number | null) => void
  pricingCurrency: 'USD' | 'EUR' | 'JPY' | 'GBP'
  onPricingCurrency: (currency: 'USD' | 'EUR' | 'JPY' | 'GBP') => void
  onPrice: (value: number) => void
  onCost: (value: number | null) => void
  platformRate?: number | null
  adRate?: number | null
  onPlatformRate?: (value: number | null) => void
  onAdRate?: (value: number | null) => void
  realWorkspace?: boolean
  pricingProductId?: string | null
  onPricingProduct?: (productId: string) => void
  onOpenTheme: (index: number) => void
  onOpenScore: (index: number) => void
  onOpenRisk: (index: number) => void
  conceptImages?: Record<string, { status: 'running' | 'ready' | 'error'; url?: string; message?: string }>
  onGenerateImage?: (conceptId: string) => void
  onImageError?: (conceptId: string) => void
  imageGenerationEnabled?: boolean
}) {
  const symbol = currencySymbol(pricingCurrency)
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
          <span>当前分析样本</span>
          <strong>{report.dataQuality.totalReviews}</strong>
          <small>采样评论，非平台总体</small>
        </div>
        <div>
          <span>关联商品</span>
          <strong>{report.dataQuality.linkedProducts}</strong>
          <small>当前采样范围，非完整市场</small>
        </div>
        <div>
          <span>被引用的评论样本</span>
          <strong>{report.evidenceCoverage.reviewEvidenceCount}</strong>
          <small>唯一评论计数，语义待复核</small>
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
                  <small className="score-detail">{item.detail}</small>
                </span>
                <span>{item.rawScore}</span>
                <span>{item.direction === 'subtract' ? '−' : '+'}{Math.round(item.weight * 100)}%</span>
                <span className={item.weightedContribution < 0 ? 'negative' : ''}>
                  {item.weightedContribution > 0 ? '+' : ''}{item.weightedContribution}
                </span>
              </button>
            ))}
          </div>
          <p className="formula">机会指数 = 预测负向样本覆盖×30% + 改进空间×25% + 竞争利润×20% + 购买标记×10% − 合规×15%</p>
        </section>

        <section className="ledger-section pain-section">
          <div className="section-title">
            <div>
              <span>REVIEW SIGNALS</span>
              <h2>评论痛点与四象限</h2>
            </div>
            <small>点击查看原始证据</small>
          </div>
          <p className="formula">样本提及率 × 预测负向占比；20% / 60% 为产品启发式，非行业标准。至少 20 条有效样本、3 条方面证据才判断象限。不是平台总体占比，不代表严重度，语义待复核。</p>
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
                  {theme.sampleStats?.map((sample) => <small className="sample-stat" key={`${sample.productId}-${sample.market}`}>{sampleStatisticsLabel(sample)}</small>)}
                </span>
                <span className="evidence-count">{theme.evidence.length} 条依据 →</span>
              </button>
            ))}
            {!report.themes.length && <p className="empty-state">当前分析未识别主题，不等于没有痛点；请人工检查未覆盖评论。</p>}
          </div>
        </section>
      </div>

      {/* 第二行：百炼多模态/视觉改良概念 (Visual Improvement Concepts) */}
      {visualConcepts.length > 0 && (
        <details className="ledger-section visual-concept-section"><summary>痛点改良概念（实验性辅助）</summary>
          <div className="section-title">
            <div>
              <span>AI VISUAL CONCEPTS</span>
              <h2>痛点改良概念</h2>
            </div>
            <span className="trust-chip">评论引用绑定 · 方案待验证</span>
          </div>
          <div className="concept-grid">
            {visualConcepts.map((concept, index) => (
              <div key={concept.id} className="concept-card">
                <div className="concept-header">
                  <span className="concept-tag">设计改良方案 #{index + 1}</span>
                  <span className="feasibility-badge">效果待验证</span>
                </div>
                <h3>{concept.conceptTitle}</h3>
                <p className="concept-desc"><strong>改良架构：</strong>{concept.designSolution}</p>
                <div className="concept-meta">
                  <span>成本：{concept.estimatedCost}</span>
                  <span>关联证据：{concept.citableReviewIds.length} 条评论</span>
                </div>
                {(conceptImages[concept.id]?.status === 'running' || conceptImages[concept.id]?.url) && (
                  <div className="concept-preview">
                    {conceptImages[concept.id]?.url
                      ? <img src={conceptImages[concept.id]?.url} alt={`${concept.conceptTitle}的参考图`} onError={() => onImageError?.(concept.id)} />
                      : <span>正在生成参考图</span>}
                  </div>
                )}
                {conceptImages[concept.id]?.status === 'error' && <p className="concept-image-error">{conceptImages[concept.id]?.message}</p>}
                <button
                  type="button"
                  className="concept-generate"
                  disabled={!imageGenerationEnabled || concept.citableReviewIds.length === 0 || conceptImages[concept.id]?.status === 'running'}
                  onClick={() => onGenerateImage?.(concept.id)}
                >
                  {conceptImages[concept.id]?.status === 'running' ? '正在生成参考图' : conceptImages[concept.id]?.url ? '重新生成参考图' : '生成参考图'}
                </button>
                <div className="concept-prompt-box">
                  <small>{conceptImages[concept.id]?.url ? '参考图已生成，仍须人工判断，不是实拍商品。' : '概念提示词，尚未生成图片：'}</small>
                  <code>{concept.imagePrompt}</code>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 第三行：竞品与价格带快照 */}
      <section className="ledger-section competitor-section">
        <div className="section-title">
          <div>
            <span>COMPETITOR SNAPSHOT</span>
            <h2>竞品与价格带</h2>
          </div>
          <small>{realWorkspace ? '用户提供快照，未经独立验证，不代表实时市场' : '本地演示快照，不代表实时市场'}</small>
        </div>
        {snapshots.map((snapshot) => (
          <div className="snapshot-block" key={snapshot.currency}>
            <div className="snapshot-caption">
              <strong>{snapshotTitle(snapshot.currency)} · {snapshot.currency}</strong>
              <span>价格中位数 {currencySymbol(snapshot.currency)}{snapshot.medianPrice} · 已知评分中位数 {snapshot.medianRating ?? '未知'}</span>
            </div>
            <div className="competitor-table">
              <div className="table-head">
                <span>竞品</span><span>售价</span><span>评分</span><span>评论量</span><span>相对中位价</span>
              </div>
              {snapshot.products.map((product) => (
                <div key={product.productId}>
                  <span><strong>{product.brand}</strong><small>{product.title}</small></span>
                  <span>{currencySymbol(product.currency)}{product.price}</span>
                  <span>{product.rating ?? '未知'}</span>
                  <span>{product.reviewCount?.toLocaleString() ?? '未知'}</span>
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
            <span className="assumption-chip">{realWorkspace ? '用户成本草稿' : '演示成本假设'} · 平台 {platformRate === null ? '待填写' : `${platformRate * 100}%`} · 广告 {adRate === null ? '待填写' : `${adRate * 100}%`}{fixedLaunchCost == null ? ' · 启动成本待填写' : ` · 启动 ${symbol}${fixedLaunchCost.toLocaleString('zh-CN')}`}</span>
          </div>
          <div className="pricing-form">
            {realWorkspace && <label className="pricing-product-select">测算商品（市场与币种固定）<select aria-label="测算商品" value={pricingProductId ?? ''} onChange={(event) => onPricingProduct?.(event.target.value)}>
              {snapshots.flatMap((snapshot) => snapshot.products).map((product) => <option key={product.productId} value={product.productId}>{product.productId} · {product.title} · {product.market} / {product.currency}</option>)}
            </select></label>}
            {!realWorkspace && snapshots.length > 1 && (
              <div className="currency-switch" role="group" aria-label="定价币种">
                {snapshots.map((snapshot) => (
                  <button key={snapshot.currency} type="button" aria-pressed={pricingCurrency === snapshot.currency} onClick={() => onPricingCurrency(snapshot.currency)}>
                    {snapshotTitle(snapshot.currency)}
                  </button>
                ))}
              </div>
            )}
            <label>
              售价（{pricingCurrency}）
              <input aria-label="售价" type="number" min="0.01" step="0.01" value={price} onChange={(event) => onPrice(Number(event.target.value))} />
            </label>
            <label>
              到岸成本（{pricingCurrency}）
              <input aria-label="到岸成本" type="number" min="0" step="0.01" value={landedCost ?? ''} onChange={(event) => onCost(event.target.value === '' ? null : Number(event.target.value))} />
            </label>
            <label>
              固定启动成本（{pricingCurrency}）
              <input aria-label="固定启动成本" type="number" min="0" step="0.01" value={fixedLaunchCost ?? ''} onChange={(event) => onLaunchCost(event.target.value === '' ? null : Number(event.target.value))} />
            </label>
            {onPlatformRate && <label>平台费率（%）<input aria-label="平台费率" type="number" min="0" max="100" step="0.01" value={platformRate === null ? '' : platformRate * 100} onChange={(event) => onPlatformRate(event.target.value === '' ? null : Number(event.target.value) / 100)} /></label>}
            {onAdRate && <label>广告费率（%）<input aria-label="广告费率" type="number" min="0" max="100" step="0.01" value={adRate === null ? '' : adRate * 100} onChange={(event) => onAdRate(event.target.value === '' ? null : Number(event.target.value) / 100)} /></label>}
          </div>
          {realWorkspace ? <p className="formula">仅测算当前选定商品，市场与币种来自商品数据；切换商品不复用其他成本。上方评论洞察仍覆盖选定市场的数据集合。售价初值来自用户商品；成本和费率未知时不计算。仅保存简化贡献草稿，不是净利润；尚未扣除履约、仓储、退货等明细。</p> : pricingCurrency !== 'USD' && <p className="formula">售价取该币种竞品中位数，到岸成本按 45% 预填。2,500 只作为美元演示值，换币后需要另填启动成本。</p>}
          {landedCost === null || platformRate === null || adRate === null ? <p className="scenario-error" role="status">请填写到岸成本、平台与广告费率；未知不按零扣减。</p> : fixedLaunchCost == null ? (
            <p className="scenario-error" role="status">请填写该币种的固定启动成本后再看保本销量。</p>
          ) : pricing ? (
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
            <small>US / EU / JP / UK 来源资料与适用性待复核</small>
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
