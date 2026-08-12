import { useEffect, useMemo, useState } from 'react'
import { buildInsightReport, buildInsightReportFromAnalysis } from './domain/analysis'
import { parseReviewCsv } from './domain/csv'
import type { DatasetBundle, InsightReport } from './domain/types'
import { buildCompetitorSnapshot, simulatePricing } from './domain/market'
import { sampleDataset } from './fixtures/usbCChargers'
import { ProxyProvider } from './providers/provider'

const scoreLabels = {
  painIntensity: '痛点强度',
  improvementSpace: '可改进空间',
  competitionAndMargin: '竞争与利润空间',
  dataConfidence: '数据可信度',
  compliancePenalty: '合规风险扣分',
}

function EvidenceSource({ sourceUrl }: { sourceUrl: string }) {
  if (sourceUrl.startsWith('fixture:')) return <span className="fixture-source">本地演示证据</span>
  return <a href={sourceUrl} target="_blank" rel="noreferrer">查看来源 ↗</a>
}

export function App() {
  const [dataset, setDataset] = useState<DatasetBundle>(sampleDataset)
  const [sourceLabel, setSourceLabel] = useState('内置公开演示样例')
  const [error, setError] = useState('')
  const fixtureReport = useMemo(() => buildInsightReport(dataset), [dataset])
  const [report, setReport] = useState<InsightReport>(fixtureReport)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiStatus, setAiStatus] = useState<'checking' | 'offline' | 'ready' | 'running' | 'fallback'>('checking')
  const proxyProvider = useMemo(() => new ProxyProvider({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787' }), [])
  const competitors = useMemo(() => buildCompetitorSnapshot(dataset.products), [dataset.products])
  const [price, setPrice] = useState(39.99)
  const [landedCost, setLandedCost] = useState(18)
  const pricing = useMemo(() => {
    try {
      return simulatePricing({ price, landedCost, platformRate: 0.15, adRate: 0.12, fixedLaunchCost: 2500 })
    } catch {
      return null
    }
  }, [price, landedCost])

  useEffect(() => {
    setReport(fixtureReport)
    setAiStatus(aiConfigured ? 'ready' : 'offline')
  }, [fixtureReport, aiConfigured])

  useEffect(() => {
    let active = true
    void proxyProvider.isConfigured().then((configured) => {
      if (!active) return
      setAiConfigured(configured)
      setAiStatus(configured ? 'ready' : 'offline')
    })
    return () => { active = false }
  }, [proxyProvider])

  async function handleCsvFile(file: File | undefined) {
    if (!file) return
    try {
      const reviews = parseReviewCsv(await file.text())
      setDataset({ ...sampleDataset, reviews })
      setSourceLabel(`本地 CSV · ${file.name}`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CSV 解析失败')
    }
  }

  async function runAiAnalysis() {
    setAiStatus('running')
    setError('')
    try {
      const analysis = await proxyProvider.analyze(dataset)
      setReport(buildInsightReportFromAnalysis(dataset, analysis, proxyProvider.mode))
      setAiStatus('ready')
    } catch {
      setReport(fixtureReport)
      setAiStatus('fallback')
      setError('AI 增强暂不可用，已安全回退到本地确定性分析。')
    }
  }

  function exportReport() {
    const payload = {
      schemaVersion: '1.0',
      sourceLabel,
      report,
      competitorSnapshot: competitors,
      pricingScenario: pricing,
      disclaimer: '本报告为信息辅助，不构成法律、财务或销量预测。',
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-insight-${report.generatedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main>
      <header className="hero">
        <nav>
          <div className="brand"><span>QL</span> Qling 出海智察</div>
          <div className="prototype-pill">{report.providerMode === 'bailian' ? '百炼增强 · 证据约束' : 'FIXTURE 原型 · 数据不上传'}</div>
        </nav>
        <div className="hero-grid">
          <section>
            <p className="eyebrow">AI 市场洞察 / 欧美 USB-C 充电器</p>
            <h1>把分散信息，变成<br /><em>可追溯的进入决策</em></h1>
            <p className="hero-copy">评论痛点、机会评分与合规预警形成一个证据闭环。AI 负责理解，确定性规则负责把关。</p>
            <label className="upload-button">
              导入评论 CSV
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event.target.files?.[0])} />
            </label>
            <button className="export-button" type="button" onClick={exportReport}>导出证据报告</button>
            <a className="template-link" href="./samples/reviews-template.csv" download>下载 CSV 模板</a>
            <div className="ai-control">
              <button type="button" disabled={!aiConfigured || aiStatus === 'running'} onClick={() => void runAiAnalysis()}>{aiStatus === 'running' ? 'AI 分析中…' : '运行百炼增强'}</button>
              <span className={`ai-state ${aiStatus}`}>{aiStatus === 'checking' ? '正在检测本地代理' : aiStatus === 'ready' ? '服务端已配置' : aiStatus === 'fallback' ? '已回退本地分析' : '未配置，保持离线模式'}</span>
            </div>
            <span className="source-note">当前：{sourceLabel}</span>
            {error && <p className="error" role="alert">{error}</p>}
          </section>
          <aside className="decision-card">
            <p>市场机会指数</p>
            <div className="score-ring"><strong>{report.opportunityScore}</strong><span>/ 100</span></div>
            <h2>{report.opportunityScore >= 60 ? '建议进入验证阶段' : '建议补充证据后再决策'}</h2>
            <p>{report.recommendation}</p>
          </aside>
        </div>
      </header>

      <section className="dashboard">
        <div className="section-heading">
          <div><p className="eyebrow">DECISION EVIDENCE</p><h2>结论不是黑箱，每一步都有依据</h2></div>
          <p>生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>

        <div className="grid three">
          <article className="panel themes">
            <span className="number">01</span><h3>评论痛点</h3>
            {report.themes.map((theme) => (
              <div className="theme" key={theme.id}>
                <div><strong>{theme.label}</strong><small>{theme.mentions} 条关键证据</small></div>
                <p>“{theme.evidence[0]?.excerpt}”</p>
                <EvidenceSource sourceUrl={theme.evidence[0]?.sourceUrl ?? 'fixture:missing'} />
              </div>
            ))}
          </article>

          <article className="panel breakdown">
            <span className="number">02</span><h3>评分拆解</h3>
            {Object.entries(report.scoreBreakdown).map(([key, value]) => (
              <div className="metric" key={key}>
                <div><span>{scoreLabels[key as keyof typeof scoreLabels]}</span><strong>{value}</strong></div>
                <div className="bar"><i style={{ width: `${value}%` }} /></div>
              </div>
            ))}
            <small>最终分数由固定权重计算，模型不能直接修改。</small>
          </article>

          <article className="panel compliance">
            <span className="number">03</span><h3>合规预警</h3>
            {report.complianceRisks.map((risk) => (
              <div className="risk" key={risk.id}>
                <span>{risk.severity.toUpperCase()}</span>
                <strong>{risk.label}</strong>
                <p>{risk.evidence[0]?.excerpt}</p>
                <EvidenceSource sourceUrl={risk.evidence[0]?.sourceUrl ?? 'fixture:missing'} />
              </div>
            ))}
            <small>信息辅助，不构成法律意见；所有风险需人工复核。</small>
          </article>
        </div>

        <div className="grid two auxiliary">
          <article className="panel competitor-panel">
            <span className="number">04</span><h3>竞品快照</h3>
            <div className="snapshot-summary"><div><small>价格中位数</small><strong>${competitors.medianPrice}</strong></div><div><small>评分中位数</small><strong>{competitors.medianRating}</strong></div></div>
            <div className="competitor-list">
              {competitors.products.map((product) => <div key={product.productId}><span><strong>{product.brand}</strong><small>{product.title}</small></span><b>${product.price}</b></div>)}
            </div>
            <small>快照时间 {competitors.capturedAt}；当前为本地演示数据，不代表实时市场。</small>
          </article>

          <article className="panel pricing-panel">
            <span className="number">05</span><h3>定价情景</h3>
            <div className="pricing-inputs">
              <label>售价（USD）<input aria-label="售价" type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(Math.max(0.01, Number(event.target.value)))} /></label>
              <label>到岸成本（USD）<input aria-label="到岸成本" type="number" min="0" step="0.01" value={landedCost} onChange={(event) => setLandedCost(Math.max(0, Number(event.target.value)))} /></label>
            </div>
            {pricing ? <div className="pricing-result"><div><small>单件贡献</small><strong>${pricing.contributionPerUnit}</strong></div><div><small>贡献率</small><strong>{(pricing.contributionMarginRate * 100).toFixed(2)}%</strong></div><div><small>保本销量</small><strong>{pricing.breakEvenUnits} 件</strong></div></div> : <p className="scenario-error" role="status">当前售价不足以覆盖成本和费率，请调整参数。</p>}
            <small>假设：平台费 15%、广告费 12%、固定启动成本 $2,500；仅为情景计算，不预测真实销量。</small>
          </article>
        </div>
      </section>
    </main>
  )
}
