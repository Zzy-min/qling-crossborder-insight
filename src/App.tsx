import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildInsightReport, buildInsightReportFromAnalysis } from './domain/analysis'
import { CsvValidationError, parseReviewCsvDetailed } from './domain/csv'
import type { AnalysisStage, DatasetBundle, EvidenceRef, InsightReport } from './domain/types'
import { buildCompetitorSnapshot, simulatePricing } from './domain/market'
import { sampleDataset } from './fixtures/usbCChargers'
import { ProxyProvider } from './providers/provider'
import { scopeDataset, type MarketScope } from './domain/scope'
import { marketLabel } from './domain/labels'
import { WorkspaceShell, type WorkspaceStep } from './components/WorkspaceShell'
import { DataPreparation, type ImportErrorDetail } from './components/DataPreparation'
import { DecisionOverview } from './components/DecisionOverview'
import { EvidenceDrawer, type EvidenceSelection } from './components/EvidenceDrawer'
import { EvidenceWorkspace } from './components/EvidenceWorkspace'
import { ReportView } from './components/ReportView'

const analysisStages: Array<{ id: AnalysisStage; label: string }> = [
  { id: 'validation', label: '数据校验' },
  { id: 'themes', label: '主题识别' },
  { id: 'binding', label: '证据绑定' },
  { id: 'scoring', label: '机会评分' },
  { id: 'compliance', label: '合规检查' },
  { id: 'report', label: '报告生成' },
]

function evidenceMarket(evidence: EvidenceRef, dataset: DatasetBundle) {
  if (evidence.evidenceType === 'policy') return dataset.policies.find((item) => item.policyId === evidence.recordId)?.market
  const productId = evidence.evidenceType === 'product'
    ? evidence.recordId
    : dataset.reviews.find((item) => item.reviewId === evidence.recordId)?.productId
  return dataset.products.find((item) => item.productId === productId)?.market
}

export function App() {
  const [dataset, setDataset] = useState<DatasetBundle>(sampleDataset)
  const [marketScope, setMarketScope] = useState<MarketScope>('BOTH')
  const [sourceLabel, setSourceLabel] = useState('内置演示样例')
  const [deduplicatedCount, setDeduplicatedCount] = useState(0)
  const [importError, setImportError] = useState<ImportErrorDetail | null>(null)
  const [activeStep, setActiveStep] = useState<WorkspaceStep>('data')
  const [selection, setSelection] = useState<EvidenceSelection | null>(null)
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage | null>(null)
  const scopedDataset = useMemo(() => scopeDataset(dataset, marketScope), [dataset, marketScope])
  const fixtureReport = useMemo(() => buildInsightReport(scopedDataset, undefined, { deduplicatedCount }), [scopedDataset, deduplicatedCount])
  const [report, setReport] = useState<InsightReport>(fixtureReport)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiStatus, setAiStatus] = useState<'checking' | 'offline' | 'ready' | 'running' | 'fallback'>('checking')
  const [analysisError, setAnalysisError] = useState('')
  const analysisVersion = useRef(0)
  const stageTimers = useRef<number[]>([])
  const proxyProvider = useMemo(() => new ProxyProvider({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787' }), [])
  const competitorSnapshots = useMemo(() => {
    const groups = scopedDataset.products.reduce((result, product) => {
      const group = result.get(product.currency) ?? []
      group.push(product)
      result.set(product.currency, group)
      return result
    }, new Map<string, typeof scopedDataset.products>())
    return [...groups.values()].map(buildCompetitorSnapshot)
  }, [scopedDataset.products])
  const [price, setPrice] = useState(39.99)
  const [landedCost, setLandedCost] = useState(18)
  const pricing = useMemo(() => {
    try { return simulatePricing({ price, landedCost, platformRate: 0.15, adRate: 0.12, fixedLaunchCost: 2500 }) }
    catch { return null }
  }, [price, landedCost])
  const canAnalyze = scopedDataset.products.length > 0 && scopedDataset.reviews.length > 0 && scopedDataset.policies.length > 0

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach(window.clearTimeout)
    stageTimers.current = []
  }, [])

  useEffect(() => () => clearStageTimers(), [clearStageTimers])

  useEffect(() => {
    analysisVersion.current += 1
    clearStageTimers()
    setAnalysisStage(null)
    setReport(fixtureReport)
    setAiStatus(aiConfigured ? 'ready' : 'offline')
    setAnalysisError('')
    setSelection(null)
  }, [fixtureReport, aiConfigured, clearStageTimers])

  useEffect(() => {
    let active = true
    void proxyProvider.isConfigured().then((configured) => {
      if (!active) return
      setAiConfigured(configured)
      setAiStatus(configured ? 'ready' : 'offline')
    })
    return () => { active = false }
  }, [proxyProvider])

  async function handleCsvFile(file?: File) {
    if (!file) return
    try {
      const parsed = parseReviewCsvDetailed(await file.text(), new Set(sampleDataset.products.map((product) => product.productId)))
      setDataset({ ...sampleDataset, reviews: parsed.reviews })
      setDeduplicatedCount(parsed.deduplicatedCount)
      setSourceLabel(`本地 CSV · ${file.name}`)
      setImportError(null)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'CSV 解析失败'
      setImportError({
        summary: caught instanceof CsvValidationError ? `第 ${caught.row} 行的 ${caught.field} 未通过校验` : '文件未通过数据门禁',
        detail: message,
      })
    }
  }

  function resetDemo() {
    setDataset(sampleDataset)
    setDeduplicatedCount(0)
    setSourceLabel('内置演示样例')
    setImportError(null)
    setMarketScope('BOTH')
  }

  /** 本地确定性分析的舞台式进度：纯视觉演示，播完即进入 02 页。 */
  function startLocalAnalysisProgress() {
    clearStageTimers()
    analysisStages.forEach((stage, index) => {
      stageTimers.current.push(window.setTimeout(() => setAnalysisStage(stage.id), index * 150))
    })
    stageTimers.current.push(window.setTimeout(() => {
      setAnalysisStage(null)
      setActiveStep('opportunity')
    }, analysisStages.length * 150 + 120))
  }

  /**
   * 真实百炼请求的进度：阶段轮播只为提示流程位置，
   * 不做完成判定——完成/失败由真实请求的生命周期驱动（见 runAiAnalysis）。
   */
  function startAiProgress() {
    clearStageTimers()
    analysisStages.forEach((stage, index) => {
      stageTimers.current.push(window.setTimeout(() => setAnalysisStage(stage.id), index * 4000))
    })
  }

  async function runAiAnalysis() {
    const requestVersion = analysisVersion.current + 1
    analysisVersion.current = requestVersion
    setAiStatus('running')
    setAnalysisError('')
    startAiProgress()
    try {
      const analysis = await proxyProvider.analyze(scopedDataset)
      if (analysisVersion.current !== requestVersion) return
      clearStageTimers()
      setAnalysisStage(null)
      setReport(buildInsightReportFromAnalysis(scopedDataset, analysis, proxyProvider.mode, undefined, { deduplicatedCount }))
      setAiStatus('ready')
      setActiveStep('opportunity')
    } catch (caught) {
      if (analysisVersion.current !== requestVersion) return
      clearStageTimers()
      setAnalysisStage(null)
      setReport(fixtureReport)
      setAiStatus('fallback')
      const message = caught instanceof Error ? caught.message : ''
      setAnalysisError(/timeout|超时/i.test(message) ? '百炼请求超时，已安全回退到本地确定性分析。' : '百炼服务暂不可用，已安全回退到本地确定性分析。')
    }
  }

  function exportReport() {
    const payload = {
      schemaVersion: '1.1', sourceLabel, marketScope, report, competitorSnapshots,
      pricingScenario: pricing ? { currency: marketScope === 'EU' ? 'EUR' : 'USD', ...pricing } : null,
      disclaimer: '本报告为信息辅助，不构成法律、财务或销量预测。',
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-insight-${report.generatedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function openTheme(index: number) {
    const theme = report.themes[index]
    if (!theme) return
    setSelection({ title: theme.label, kind: '评论痛点', confidence: theme.evidence.length ? '有原始评论支持' : '证据不足', explanation: `${theme.mentions} 条关键证据指向该体验问题。`, evidence: theme.evidence.map((item) => ({ ...item, excerpt: `${item.excerpt} · 市场 ${evidenceMarket(item, scopedDataset) ?? '未知'}` })) })
  }

  function openRisk(index: number) {
    const risk = report.complianceRisks[index]
    if (!risk) return
    setSelection({ title: risk.label, kind: `${marketLabel(risk.market)}合规预警`, confidence: '官方来源已绑定 · 需人工复核', explanation: '系统只提示适用范围与措辞风险，不自动作出法律判断。', evidence: risk.evidence })
  }

  function openMarketEvidence() {
    setSelection({
      title: '竞品价格带与市场验证',
      kind: '商品快照',
      confidence: scopedDataset.products.length ? '有商品快照支持 · 需补充实时验证' : '证据不足',
      explanation: '当前快照用于确定价格带和竞争位置，不代表实时市场，也不预测销量。',
      evidence: scopedDataset.products.map((product) => ({
        recordId: product.productId,
        evidenceType: 'product',
        capturedAt: product.capturedAt,
        sourceUrl: product.sourceUrl,
        excerpt: `${product.brand} · ${product.title} · ${product.currency} ${product.price} · 评分 ${product.rating} · ${product.reviewCount} 条评论`,
      })),
    })
  }

  function openScore(index: number) {
    const item = report.scoreContributions[index]
    if (!item) return
    const evidence = item.key === 'painIntensity' || item.key === 'improvementSpace'
      ? report.themes.flatMap((theme) => theme.evidence)
      : item.key === 'compliancePenalty' ? report.complianceRisks.flatMap((risk) => risk.evidence) : []
    setSelection({ title: item.label, kind: '评分解释', confidence: evidence.length ? '确定性计算 · 有关联证据' : '确定性计算 · 间接数据', explanation: `原始分 ${item.rawScore}，${item.direction === 'subtract' ? '扣减' : '增加'}权重 ${Math.round(item.weight * 100)}%，加权贡献 ${item.weightedContribution}。模型不能直接修改该分项。`, evidence })
  }

  const providerLabel = report.providerMode === 'bailian' ? '百炼增强' : aiStatus === 'fallback' ? '本地回退' : '本地规则'

  return <WorkspaceShell activeStep={activeStep} onStepChange={setActiveStep} sourceLabel={sourceLabel} marketScope={marketScope} providerLabel={providerLabel} report={report}>
    <div className="surface-toolbar no-print">
      <div className="market-control" role="group" aria-label="目标市场"><span>目标市场</span>{([['US', '美国'], ['EU', '欧盟'], ['BOTH', '美国 + 欧盟']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={marketScope === value} onClick={() => setMarketScope(value)}>{label}</button>)}</div>
      <div className="ai-control"><span className={`ai-state ${aiStatus}`}>{aiStatus === 'checking' ? '检测代理…' : aiStatus === 'running' ? '百炼分析中' : aiStatus === 'ready' ? '百炼可用' : aiStatus === 'fallback' ? '已回退本地规则' : '离线可用'}</span><button type="button" disabled={!aiConfigured || aiStatus === 'running' || !canAnalyze} onClick={() => void runAiAnalysis()}>{aiStatus === 'running' ? '分析中…' : '运行百炼增强'}</button></div>
    </div>
    {analysisStage && (() => {
      const stageLabel = analysisStages.find((item) => item.id === analysisStage)?.label
      const aiRunning = aiStatus === 'running'
      return <div className="analysis-progress" role="status" aria-live="polite"><div><strong>{aiRunning ? '真实模型推理中' : '正在构建证据化报告'}</strong><span>{aiRunning ? `${stageLabel} · 通常需 10–60 秒，完成后自动进入市场机会` : stageLabel}</span></div><ol>{analysisStages.map((stage) => <li key={stage.id} className={analysisStages.findIndex((item) => item.id === stage.id) <= analysisStages.findIndex((item) => item.id === analysisStage) ? 'complete' : ''}><i />{stage.label}</li>)}</ol></div>
    })()}
    {analysisError && <div className="analysis-notice" role="alert"><p>{analysisError}</p>{aiStatus === 'fallback' && aiConfigured && canAnalyze && <button type="button" onClick={() => void runAiAnalysis()}>重试百炼分析</button>}</div>}
    {activeStep === 'data' && <DataPreparation quality={report.dataQuality} sourceLabel={sourceLabel} error={importError} canAnalyze={canAnalyze} onFile={(file) => void handleCsvFile(file)} onReset={resetDemo} onAnalyze={startLocalAnalysisProgress} />}
    {activeStep === 'opportunity' && <DecisionOverview report={report} marketScope={marketScope} snapshots={competitorSnapshots} price={price} landedCost={landedCost} pricing={pricing} onPrice={(value) => setPrice(Math.max(0.01, value || 0.01))} onCost={(value) => setLandedCost(Math.max(0, value || 0))} onOpenTheme={openTheme} onOpenScore={openScore} onOpenRisk={openRisk} />}
    {activeStep === 'evidence' && <EvidenceWorkspace report={report} onOpenTheme={openTheme} onOpenMarket={openMarketEvidence} onOpenRisk={openRisk} />}
    {activeStep === 'report' && <ReportView report={report} sourceLabel={sourceLabel} onExport={exportReport} onPrint={() => window.print()} onBack={() => setActiveStep('data')} />}
    <EvidenceDrawer selection={selection} onClose={() => setSelection(null)} />
  </WorkspaceShell>
}
