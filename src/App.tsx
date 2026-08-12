import { useMemo, useState } from 'react'
import { buildInsightReport } from './domain/analysis'
import { parseReviewCsv } from './domain/csv'
import type { DatasetBundle } from './domain/types'
import { sampleDataset } from './fixtures/usbCChargers'

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
  const report = useMemo(() => buildInsightReport(dataset), [dataset])

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

  return (
    <main>
      <header className="hero">
        <nav>
          <div className="brand"><span>QL</span> Qling 出海智察</div>
          <div className="prototype-pill">FIXTURE 原型 · 数据不上传</div>
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
      </section>
    </main>
  )
}
