import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildInsightReport, buildInsightReportFromAnalysis } from './domain/analysis'
import { CsvValidationError, parseReviewCsvDetailed } from './domain/csv'
import type { AnalysisStage, DatasetBundle, EvidenceRef, InsightReport } from './domain/types'
import { buildCompetitorSnapshot, buildPricingScenario, pricingSeed } from './domain/market'
import { sampleDataset } from './fixtures/usbCChargers'
import { CATEGORY_PRESETS, type CategoryPreset } from './fixtures/categories'
import { EvidenceContractError, ProxyProvider } from './providers/provider'
import { scopeDataset, type MarketScope } from './domain/scope'
import { currencyForMarket, marketLabel } from './domain/labels'
import { buildReportExport, reportSchemaVersion } from './domain/report-export'
import { buildComplianceSummary, complianceReviewBackup, type ComplianceReview } from './domain/compliance-review'
import { ComplianceReviewPanel } from './components/ComplianceReviewPanel'
import { WorkspaceUtilityPanel } from './components/WorkspaceUtilityPanel'
import { evidenceBindingNote, provenanceSummary } from './domain/provenance'
import { WorkspaceShell, type WorkspaceStep } from './components/WorkspaceShell'
import { DataPreparation, type ImportErrorDetail } from './components/DataPreparation'
import { DecisionOverview } from './components/DecisionOverview'
import { EvidenceDrawer, type EvidenceSelection } from './components/EvidenceDrawer'
import { EvidenceWorkspace } from './components/EvidenceWorkspace'
import { ReportView } from './components/ReportView'
import type { DatasetImportResult } from './components/DatasetImport'
import { workspaceDatabase, workspaceBackup, readWorkspaceBackup } from './domain/workspace'
import type { WorkspaceSnapshot } from './domain/workspace'
import type { PricingAssumptions } from './domain/market'
import { initialProductPricing, pricingForProduct, productScenarioKey } from './domain/product-pricing'
import type { ProductRow } from './domain/types'
import { createAnalysisRun, analysisRunBackup, validateAnalysisRun } from './domain/analysis-run'
import type { AnalysisRun } from './domain/analysis-run'
import { AnalysisHistory } from './components/AnalysisHistory'
const SavedConceptImages = lazy(() => import('./components/SavedConceptImages').then(module => ({ default: module.SavedConceptImages })))
import type { HistoryEntry } from './components/AnalysisHistory'
import { buildReviewSummary, createHumanReview } from './domain/human-review'
import type { HumanReview } from './domain/human-review'
import type { QuoteAnchor, ReviewSentiment } from './domain/types'
import { ReviewPanel } from './components/ReviewPanel'
import { AnalysisBatchCache, analyzeBatches, completedBatchDataset, BatchPlanError } from './domain/analysis-batch'
import type { BatchRun } from './domain/types'
import { BatchRunNotice } from './components/BatchRunNotice'
import { CostScenarioPanel } from './components/CostScenarioPanel'
import { initialCostSet, type CostSet } from './domain/cost-scenario'
import { buildValidationTaskSummary, type ValidationTask, type TaskAttachment } from './domain/validation-task'
import { ValidationTaskPanel } from './components/ValidationTaskPanel'
import { AnalysisComparisonPanel } from './components/AnalysisComparisonPanel'

const analysisStages: Array<{ id: AnalysisStage; label: string }> = [
  { id: 'validation', label: '数据校验' },
  { id: 'themes', label: '主题识别' },
  { id: 'binding', label: '证据绑定' },
  { id: 'scoring', label: '机会评分' },
  { id: 'compliance', label: '合规检查' },
  { id: 'report', label: '报告生成' },
]

const conceptImageStorageKey = 'qling-concept-images'

function readStoredConceptImages(apiBase: string) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(conceptImageStorageKey) || '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).flatMap(([conceptId, imageId]) => (
      typeof imageId === 'string' && /^[a-f0-9]{16}$/.test(imageId)
        ? [[conceptId, { status: 'ready' as const, url: `${apiBase}/api/images/${imageId}`, imageId }]]
        : []
    )))
  } catch {
    return {}
  }
}

function storeConceptImages(images: Record<string, { imageId?: string }>) {
  const stored = Object.fromEntries(Object.entries(images).flatMap(([conceptId, image]) => (
    image.imageId ? [[conceptId, image.imageId]] : []
  )))
  sessionStorage.setItem(conceptImageStorageKey, JSON.stringify(stored))
}

function evidenceMarket(evidence: EvidenceRef, dataset: DatasetBundle) {
  if (evidence.evidenceType === 'policy') return dataset.policies.find((item) => item.policyId === evidence.recordId)?.market
  const productId = evidence.evidenceType === 'product'
    ? evidence.recordId
    : dataset.reviews.find((item) => item.reviewId === evidence.recordId)?.productId
  return dataset.products.find((item) => item.productId === productId)?.market
}

export function App() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryPreset>(CATEGORY_PRESETS[0])
  const [dataset, setDataset] = useState<DatasetBundle>(sampleDataset)
  const [marketScope, setMarketScope] = useState<MarketScope>('BOTH')
  const [sourceLabel, setSourceLabel] = useState('内置演示样例')
  const [deduplicatedCount, setDeduplicatedCount] = useState(0)
  const [importError, setImportError] = useState<ImportErrorDetail | null>(null)
  const [activeStep, setActiveStep] = useState<WorkspaceStep>('data')
  const [selection, setSelection] = useState<EvidenceSelection | null>(null)
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [storageStatus, setStorageStatus] = useState('正在恢复本地工作区…')
  const [storageReady, setStorageReady] = useState(false)
  const [backupInProgress, setBackupInProgress] = useState(false)
  const backupBusy = useRef(false)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const saveRevision = useRef(0)
  const scenarioHistory = useRef<Record<string, PricingAssumptions>>({})
  const [costSets, setCostSets] = useState<Record<string, CostSet>>({})
  const lastRealWorkspace = useRef<WorkspaceSnapshot | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyStatus, setHistoryStatus] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historicalRun, setHistoricalRun] = useState<AnalysisRun | null>(null)
  const [humanReviews, setHumanReviews] = useState<HumanReview[]>([])
  const [reviewStatus, setReviewStatus] = useState('')
  const [reviewSaving, setReviewSaving] = useState(false)
  const [failedReviews, setFailedReviews] = useState<Record<string, HumanReview>>({})
  const reviewBusy = useRef(false)
  const [validationTasks, setValidationTasks] = useState<ValidationTask[]>([])
  const [taskFiles, setTaskFiles] = useState<TaskAttachment[]>([])
  const [taskStatus, setTaskStatus] = useState('')
  const [taskSaving, setTaskSaving] = useState(false)
  const taskBusy = useRef(false)
  const [complianceReviews, setComplianceReviews] = useState<ComplianceReview[]>([])
  const [complianceStatus, setComplianceStatus] = useState('')
  const [complianceLoaded, setComplianceLoaded] = useState(false)
  const [complianceSaving, setComplianceSaving] = useState(false)
  const [failedComplianceReviews, setFailedComplianceReviews] = useState<Record<string, ComplianceReview>>({})
  const complianceBusy = useRef(false)
  const [failedTasks, setFailedTasks] = useState<Record<string, { record: ValidationTask; files: TaskAttachment[] }>>({})
  const workspaceIdentity = useRef<string | null>(null)
  const scopedDataset = useMemo(() => scopeDataset(dataset, marketScope), [dataset, marketScope])
  const fixtureReport = useMemo(() => buildInsightReport(scopedDataset, undefined, { deduplicatedCount }), [scopedDataset, deduplicatedCount])
  const [report, setReport] = useState<InsightReport>(fixtureReport)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [onlineEnabled, setOnlineEnabled] = useState(false)
  const [imageIncomplete, setImageIncomplete] = useState(false)
  const imageIncompleteRef = useRef(false)
  imageIncompleteRef.current = imageIncomplete
  const reportSelection = useRef<string | null>(null)
  reportSelection.current = historicalRun?.id ?? null
  const [providerOrigin, setProviderOrigin] = useState('提供商地址未知')
  const [aiStatus, setAiStatus] = useState<'checking' | 'offline' | 'ready' | 'running' | 'fallback'>('checking')
  const [analysisError, setAnalysisError] = useState('')
  const [conceptImages, setConceptImages] = useState<Record<string, { status: 'running' | 'ready' | 'error'; url?: string; message?: string; imageId?: string }>>({})
  const analysisVersion = useRef(0)
  const analysisController = useRef<AbortController | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchRun | null>(null)
  const batchCache = useMemo(() => new AnalysisBatchCache(), [])
  const stageTimers = useRef<number[]>([])
  const proxyProvider = useMemo(() => new ProxyProvider({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787' }), [])
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
  const conceptImagesRestored = useRef(false)
  
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
  const [landedCost, setLandedCost] = useState<number | null>(18)
  const [platformRate, setPlatformRate] = useState<number | null>(0.15)
  const [adRate, setAdRate] = useState<number | null>(0.12)
  const [pricingCurrency, setPricingCurrency] = useState<'USD' | 'EUR' | 'JPY' | 'GBP'>('USD')
  const [fixedLaunchCost, setFixedLaunchCost] = useState<number | null>(2500)
  const [pricingProductId, setPricingProductId] = useState<string | null>(null)
  const pricingProduct = workspace ? dataset.products.find((product) => product.productId === pricingProductId) : undefined
  const pricingScenario = useMemo(() => buildPricingScenario({
    currency: pricingCurrency, price, landedCost, platformRate, adRate, fixedLaunchCost,
  }, pricingProduct ? { productId: pricingProduct.productId, market: pricingProduct.market, currency: pricingProduct.currency } : undefined), [pricingCurrency, price, landedCost, platformRate, adRate, fixedLaunchCost, pricingProduct])
  const pricing = pricingScenario.result
  const costSet = pricingProduct ? costSets[productScenarioKey(pricingProduct)] : undefined

  useEffect(() => {
    let active = true
    workspaceIdentity.current = workspace?.id ?? null
    setHistory([])
    setHumanReviews([])
    setValidationTasks([])
    setTaskFiles([])
    setComplianceReviews([]); setComplianceLoaded(false); setComplianceStatus('正在读取合规复核…')
    setTaskStatus('正在读取验证任务…')
    setReviewStatus('正在读取复核记录…')
    setHistoryLoaded(false)
    setHistoricalRun(null)
    if (!workspace) { setHistoryStatus(''); return }
    setHistoryStatus('正在读取本机分析历史…')
    void workspaceDatabase.listAnalysisRuns(workspace.id).then(async (runs) => {
      const reviews = await workspaceDatabase.listHumanReviews(workspace.id, runs)
      const tasks = await workspaceDatabase.listValidationTasks(workspace.id, runs)
      const compliance = await workspaceDatabase.listComplianceReviews(workspace.id, runs)
      if (!active) return
      setHistory((current) => [...current, ...runs.filter((run) => !current.some((entry) => entry.run.id === run.id)).map((run) => ({ run, status: 'saved' as const }))])
      setHistoryStatus('分析历史已读取；当前报告仍按当前规则重建')
      setHistoryLoaded(true)
      setHumanReviews((current) => [...reviews, ...current.filter((record) => !reviews.some((existing) => existing.id === record.id))])
      setReviewStatus('复核记录已读取；只有成功保存的决定参与确认统计')
      setValidationTasks(tasks.tasks)
      setTaskFiles(tasks.attachments)
      setTaskStatus('验证任务已读取；状态为用户记录，未经独立核验')
      setComplianceReviews(compliance); setComplianceLoaded(true); setComplianceStatus('合规复核已读取；仅已保存记录参与统计')
    }).catch(() => { if (active) { setHistoryStatus('历史或复核读取失败；未删除已有存档，请勿清除浏览器数据'); setComplianceStatus('合规复核未就绪；完整备份与历史报告导出已阻止') } })
    return () => { active = false }
  }, [workspace?.id])

  const selectedReviews = useMemo(() => historicalRun ? humanReviews.filter((record) => record.runId === historicalRun.id) : [], [historicalRun, humanReviews])
  const reviewSummary = useMemo(() => historicalRun ? buildReviewSummary(historicalRun, selectedReviews) : undefined, [historicalRun, selectedReviews])
  const failedReview = historicalRun ? failedReviews[historicalRun.id] : undefined
  const selectedTasks = useMemo(() => historicalRun ? validationTasks.filter(task => task.runId === historicalRun.id) : [], [historicalRun, validationTasks])
  const taskSummary = useMemo(() => historicalRun ? buildValidationTaskSummary(historicalRun, selectedTasks) : undefined, [historicalRun, selectedTasks])
  const failedTask = historicalRun ? failedTasks[historicalRun.id] : undefined
  const selectedComplianceReviews = useMemo(() => historicalRun ? complianceReviews.filter(record => record.runId === historicalRun.id) : [], [historicalRun, complianceReviews])
  const complianceSummary = useMemo(() => historicalRun && complianceLoaded ? buildComplianceSummary(historicalRun, selectedComplianceReviews) : undefined, [historicalRun, complianceLoaded, selectedComplianceReviews])
  const failedComplianceReview = historicalRun ? failedComplianceReviews[historicalRun.id] : undefined
  const complianceGate = useMemo(() => ({ blocked: !!workspace && (!complianceLoaded || complianceSaving || Object.values(failedComplianceReviews).some(record => record.workspaceId === workspace.id)), records: complianceReviews }), [workspace?.id, complianceLoaded, complianceSaving, failedComplianceReviews, complianceReviews])
  const complianceGateRef = useRef(complianceGate)
  complianceGateRef.current = complianceGate

  async function persistCompliance(record: ComplianceReview) {
    if (complianceBusy.current || workspaceIdentity.current !== record.workspaceId) return
    complianceBusy.current = true; setComplianceSaving(true); setComplianceStatus('合规复核保存中，尚未计入统计')
    try {
      await workspaceDatabase.saveComplianceReview(record)
      if (workspaceIdentity.current !== record.workspaceId) return
      setFailedComplianceReviews(current => { const next = { ...current }; delete next[record.runId]; return next })
      setComplianceReviews(current => [...current.filter(entry => entry.id !== record.id), record])
      setComplianceStatus('合规复核已保存到本机；原分析、评分与建议未改写')
    } catch {
      setFailedComplianceReviews(current => ({ ...current, [record.runId]: record }))
      if (workspaceIdentity.current === record.workspaceId) setComplianceStatus('合规复核未保存：存储失败、额度不足或修订冲突。尚未计入统计；可重试或下载未保存备份。')
    } finally { complianceBusy.current = false; setComplianceSaving(false) }
  }

  function backupFailedCompliance() {
    if (!failedComplianceReview || !historicalRun) return
    try {
      const content = complianceReviewBackup(historicalRun, [...selectedComplianceReviews, failedComplianceReview])
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'qling-unsaved-compliance-backup-v1.json'; link.click(); URL.revokeObjectURL(url)
      setComplianceStatus('已发起未保存合规复核备份下载；不表示已写入数据库，含私有资料')
    } catch { setComplianceStatus('未保存合规备份未导出：修订链或内容校验失败，请保留当前数据并核对') }
  }

  async function persistTask(record: ValidationTask, files: TaskAttachment[] = []) {
    if (taskBusy.current) return
    taskBusy.current = true; setTaskSaving(true); setTaskStatus('任务保存中，尚未更新已保存状态')
    try {
      await workspaceDatabase.saveValidationTask(record, files)
      setFailedTasks(current => { const next = { ...current }; delete next[record.runId]; return next })
      if (workspaceIdentity.current !== record.workspaceId) return
      setValidationTasks(current => [...current.filter(saved => saved.id !== record.id), record])
      setTaskFiles(current => [...current, ...files.filter(file => !current.some(saved => saved.id === file.id))])
      setTaskStatus('验证任务已保存到本机；原分析、假设及成本快照未改写')
    } catch {
      setFailedTasks(current => ({ ...current, [record.runId]: { record, files } }))
      if (workspaceIdentity.current === record.workspaceId) setTaskStatus('任务未保存：存储失败、额度不足或修订冲突；已保存状态未改变。可重试或下载未保存备份，冲突需刷新核对。')
    } finally { taskBusy.current = false; setTaskSaving(false) }
  }

  function backupFailedTask() {
    if (!failedTask || !historicalRun) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 'qling-unsaved-task/1', saved: false, analysisRun: historicalRun, previousRecords: selectedTasks, previousFiles: taskFiles.filter(file => file.taskId === failedTask.record.taskId), ...failedTask }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'qling-unsaved-task.json'; link.click(); URL.revokeObjectURL(url)
  }

  async function persistReview(record: HumanReview) {
    if (reviewBusy.current) return
    reviewBusy.current = true
    setReviewSaving(true)
    setReviewStatus('保存中，尚未确认；原预测保持不变')
    try {
      await workspaceDatabase.saveHumanReview(record)
      setFailedReviews((current) => { const next = { ...current }; delete next[record.runId]; return next })
      if (workspaceIdentity.current !== record.workspaceId) return
      setHumanReviews((current) => [...current.filter((existing) => existing.id !== record.id), record])
      setReviewStatus('复核已保存到本机；确认统计已更新，原预测与评分未改写')
    } catch {
      setFailedReviews((current) => ({ ...current, [record.runId]: record }))
      if (workspaceIdentity.current === record.workspaceId) setReviewStatus('复核未保存：存储失败或修订冲突。尚未计入确认统计；可重试或下载备份，冲突需刷新后重试。')
    } finally { reviewBusy.current = false; setReviewSaving(false) }
  }

  function saveReview(themeId: string, anchor: QuoteAnchor, decision: HumanReview['decision'], sentiment: ReviewSentiment | null, reason: string) {
    if (!historicalRun || !historyLoaded || reviewBusy.current || failedReview || !history.some((entry) => entry.run.id === historicalRun.id && entry.status === 'saved')) return
    try {
      const revision = Math.max(0, ...selectedReviews.map((record) => record.revision)) + 1
      void persistReview(createHumanReview(historicalRun, themeId, anchor, decision, sentiment, reason, revision))
    } catch { setReviewStatus('复核未保存：理由或引用格式不正确，原预测未改动') }
  }

  function backupFailedReview() {
    if (!failedReview || !historicalRun) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 'qling-unsaved-review/1', saved: false, analysisRun: historicalRun, record: failedReview }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'qling-unsaved-review.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function persistRun(run: AnalysisRun) {
    if (workspaceIdentity.current === run.workspaceId) setHistory((entries) => entries.map((entry) => entry.run.id === run.id ? { ...entry, status: 'saving' } : entry))
    try {
      await workspaceDatabase.saveAnalysisRun(run)
      if (workspaceIdentity.current !== run.workspaceId) return
      setHistory((entries) => entries.map((entry) => entry.run.id === run.id ? { ...entry, status: 'saved' } : entry))
      setHistoryStatus('分析存档已保存到本机')
    } catch {
      if (workspaceIdentity.current !== run.workspaceId) return
      setHistory((entries) => entries.map((entry) => entry.run.id === run.id ? { ...entry, status: 'error' } : entry))
      setHistoryStatus('历史未保存：存储失败或额度不足，内存报告可单独下载备份')
    }
  }

  function recordAnalysis(savedReport: InsightReport, outcome: AnalysisRun['outcome']) {
    if (!workspace) return
    try {
      const run = createAnalysisRun(workspace.id, savedReport, { category: '用户商品集合', sourceLabel, marketScope, dataset: scopedDataset, pricingScenario, ...(costSet ? { costSet } : {}) }, outcome)
      setHistory((entries) => [{ run, status: 'saving' }, ...entries])
      void persistRun(run)
    } catch { setHistoryStatus('历史未保存：当前输入或报告未通过存档校验，当前报告仍可查看') }
  }

  function downloadRun(run: AnalysisRun) {
    const url = URL.createObjectURL(new Blob([analysisRunBackup(run)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-analysis-${run.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  
  const canAnalyze = scopedDataset.products.length > 0 && scopedDataset.reviews.length > 0
  const onlineScopeSupported = !!workspace || (scopedDataset.reviews.length <= 1000 && new Blob([JSON.stringify(scopedDataset)]).size < 900_000)

  function applyWorkspace(snapshot: WorkspaceSnapshot) {
    saveRevision.current += 1
    setWorkspace(snapshot)
    setDataset(snapshot.dataset)
    setSourceLabel(`用户工作区 · ${snapshot.name}`)
    setDeduplicatedCount(snapshot.deduplicatedCount)
    setMarketScope(snapshot.marketScope)
    scenarioHistory.current = { ...snapshot.productScenarios }
    setCostSets(snapshot.costSets ?? {})
    setPricingProductId(snapshot.pricingProductId)
    setPrice(snapshot.pricing.price)
    setLandedCost(snapshot.pricing.landedCost)
    setPlatformRate(snapshot.pricing.platformRate)
    setAdRate(snapshot.pricing.adRate)
    setPricingCurrency(snapshot.pricing.currency)
    setFixedLaunchCost(snapshot.pricing.fixedLaunchCost)
    setImportError(null)
    setActiveStep('data')
  }

  useEffect(() => {
    let active = true
    void workspaceDatabase.restore().then((snapshot) => {
      if (!active) return
      if (snapshot) applyWorkspace(snapshot)
      setStorageStatus(snapshot ? '已从本机恢复；报告按当前本地规则重新计算' : '演示模式；真实工作区独立保存')
    }).catch(() => {
      if (active) setStorageStatus('未保存：本地存储不可用，导入后请导出 JSON 备份')
    }).finally(() => { if (active) setStorageReady(true) })
    return () => { active = false }
  }, [])

  function currentSnapshot(): WorkspaceSnapshot | null {
    if (!workspace || !pricingProduct) return null
    return { ...workspace, updatedAt: new Date().toISOString(), dataset, deduplicatedCount, marketScope,
      pricing: pricingScenario.assumptions,
      pricingProductId: pricingProduct.productId,
      productScenarios: { ...scenarioHistory.current, [productScenarioKey(pricingProduct)]: pricingScenario.assumptions }, ...(Object.keys(costSets).length ? { costSets } : {}) }
  }

  useEffect(() => {
    if (!workspace || !storageReady) return
    const snapshot = currentSnapshot()!
    const revision = ++saveRevision.current
    setStorageStatus('未保存：等待本地保存…')
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
        if (revision !== saveRevision.current) return
        try {
          await workspaceDatabase.save(snapshot)
          if (revision === saveRevision.current) setStorageStatus('已保存到本机；不会上传或包含 API 密钥')
        } catch {
          if (revision === saveRevision.current) setStorageStatus('未保存：存储失败或额度不足，请导出 JSON 备份；内存数据仍可使用')
        }
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [workspace, storageReady, dataset, deduplicatedCount, marketScope, pricingScenario, costSets])

  function importDataset(result: DatasetImportResult) {
    const product = result.dataset.products[0]
    applyWorkspace({ version: 2, id: crypto.randomUUID(), name: result.name, updatedAt: new Date().toISOString(),
      dataset: result.dataset, deduplicatedCount: result.deduplicatedCount, productMapping: result.productMapping, reviewMapping: result.reviewMapping,
      marketScope: 'ALL', pricing: initialProductPricing(product), scenarios: {}, pricingProductId: product.productId, productScenarios: {} })
  }

  async function exportWorkspace() {
    if (complianceGateRef.current.blocked || complianceBusy.current) { setStorageStatus('完整备份未导出：合规复核读取/保存未完成或存在未保存记录，请重试或单独下载备份。'); return }
    const complianceContext = complianceGateRef.current
    if (imageIncomplete) { setStorageStatus('完整备份未导出：图片操作未完成或图片尚未保存，请先取消、重试保存或下载未保存图片备份。'); return }
    const snapshot = currentSnapshot()
    if (!snapshot || backupBusy.current) return
    if (!historyLoaded) { setStorageStatus('备份未导出：历史尚未读取完成或读取失败，避免缺失历史'); return }
    if (reviewSaving || Object.values(failedReviews).some((record) => record.workspaceId === snapshot.id)) { setStorageStatus('备份未导出：存在尚未保存的复核，请等待保存或单独下载未保存复核'); return }
    if (taskSaving || Object.values(failedTasks).some(entry => entry.record.workspaceId === snapshot.id)) { setStorageStatus('完整备份未导出：存在未保存验证任务，请先重试或下载该任务备份'); return }
    const version = analysisVersion.current
    backupBusy.current = true; setBackupInProgress(true)
    try {
      const { workspaceArchiveBackupWithImages } = await import('./domain/workspace-images')
      const images = await workspaceDatabase.listConceptImages(snapshot.id)
      const content = await workspaceArchiveBackupWithImages(snapshot, history.map(entry => entry.run), humanReviews, validationTasks, taskFiles, images, complianceReviews)
      if (workspaceIdentity.current !== snapshot.id || analysisVersion.current !== version || complianceGateRef.current !== complianceContext || complianceBusy.current) return
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = complianceReviews.length ? 'qling-workspace-backup-v7.json' : images.length ? 'qling-workspace-backup-v6.json' : validationTasks.length ? 'qling-workspace-backup-v5.json' : 'qling-workspace-backup-v4.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      if (workspaceIdentity.current === snapshot.id) setStorageStatus(`完整备份未导出：${caught instanceof Error ? caught.message : '读取或校验失败'}；未遗漏图片或删除数据，可分别下载分析和单张图片备份`)
    } finally { backupBusy.current = false; setBackupInProgress(false) }
  }

  async function restoreBackup(file?: File) {
    if (!file) return
    const revision = saveRevision.current
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份不得超过 20 MB')
      const { readWorkspaceArchiveWithImages } = await import('./domain/workspace-images')
      const archive = await readWorkspaceArchiveWithImages(await file.text())
      if (revision !== saveRevision.current) return
      const snapshot = { ...archive.workspace, id: crypto.randomUUID() }
      const restore = saveQueue.current.catch(() => {}).then(() => workspaceDatabase.restoreArchive(snapshot, archive.analysisRuns, () => revision === saveRevision.current, archive.humanReviews, archive.validationTasks, archive.taskAttachments, archive.conceptImages, archive.complianceReviews))
      saveQueue.current = restore.catch(() => {})
      await restore
      if (revision !== saveRevision.current) return
      applyWorkspace(snapshot)
    } catch (caught) {
      if (revision !== saveRevision.current) return
      setImportError({ summary: '备份恢复未生效，原工作区保持不变', detail: caught instanceof Error ? caught.message : '备份格式错误' })
    }
  }

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach(window.clearTimeout)
    stageTimers.current = []
  }, [])

  useEffect(() => () => { clearStageTimers(); analysisController.current?.abort() }, [clearStageTimers])

  useEffect(() => {
    analysisVersion.current += 1
    analysisController.current?.abort()
    setBatchProgress(null)
    clearStageTimers()
    setAnalysisStage(null)
    setReport(fixtureReport)
    setAiStatus(aiConfigured ? 'ready' : 'offline')
    setAnalysisError('')
    setSelection(null)
    setOnlineEnabled(false)
  }, [fixtureReport, aiConfigured, clearStageTimers])

  useEffect(() => {
    if (!conceptImagesRestored.current) {
      conceptImagesRestored.current = true
      setConceptImages(readStoredConceptImages(apiBase))
      return
    }
    setConceptImages({})
    sessionStorage.removeItem(conceptImageStorageKey)
  }, [fixtureReport, apiBase])

  useEffect(() => {
    let active = true
    void proxyProvider.isConfigured().then((configured) => {
      if (!active) return
      setAiConfigured(configured)
      setProviderOrigin(proxyProvider.providerOrigin ?? '提供商地址未知')
      setAiStatus(configured ? 'ready' : 'offline')
    })
    return () => { active = false }
  }, [proxyProvider])

  function handleSelectCategory(cat: CategoryPreset) {
    if (!storageReady) return
    const realSnapshot = currentSnapshot()
    if (realSnapshot) lastRealWorkspace.current = realSnapshot
    saveRevision.current += 1
    setWorkspace(null)
    setPricingProductId(null)
    scenarioHistory.current = {}
    setPlatformRate(0.15)
    setAdRate(0.12)
    setStorageStatus('演示模式；已保存的真实工作区未删除')
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (realSnapshot) await workspaceDatabase.save(realSnapshot)
      await workspaceDatabase.useDemo()
    }).catch(() => setStorageStatus('未保存：切换前草稿保存失败；可恢复本次真实工作区并导出备份，重启可能恢复旧内容'))
    setSelectedCategory(cat)
    setDataset(cat.dataset)
    setSourceLabel(cat.id === 'usb-c-chargers' ? '内置演示样例' : cat.name)
    setPrice(cat.defaultPrice)
    setLandedCost(cat.defaultLandedCost)
    setPricingCurrency('USD')
    setFixedLaunchCost(2500)
    setDeduplicatedCount(0)
    setImportError(null)
    setMarketScope(cat.id === 'usb-c-chargers' ? 'BOTH' : 'ALL')
  }

  async function handleCsvFile(file?: File) {
    if (!file || !storageReady) return
    const version = analysisVersion.current
    try {
      const parsed = parseReviewCsvDetailed(await file.text(), new Set(dataset.products.map((product) => product.productId)))
      if (version !== analysisVersion.current) return
      setDataset({ ...dataset, reviews: parsed.reviews, provenance: { products: dataset.provenance?.products ?? 'unknown', reviews: 'user-provided', policies: dataset.provenance?.policies ?? 'unknown' } })
      setDeduplicatedCount(parsed.deduplicatedCount)
      setSourceLabel(`本地 CSV · ${file.name}`)
      setImportError(null)
    } catch (caught) {
      if (version !== analysisVersion.current) return
      const message = caught instanceof Error ? caught.message : 'CSV 解析失败'
      setImportError({
        summary: caught instanceof CsvValidationError ? `第 ${caught.row} 行的 ${caught.field} 未通过校验` : '文件未通过数据门禁',
        detail: message,
      })
    }
  }

  function resetDemo() {
    handleSelectCategory(CATEGORY_PRESETS[0])
  }

  function selectPricingProduct(product: ProductRow) {
    if (pricingProduct) scenarioHistory.current[productScenarioKey(pricingProduct)] = pricingScenario.assumptions
    const draft = pricingForProduct(product, scenarioHistory.current)
    setPricingProductId(product.productId)
    setPricingCurrency(draft.currency)
    setPrice(draft.price)
    setLandedCost(draft.landedCost)
    setFixedLaunchCost(draft.fixedLaunchCost)
    setPlatformRate(draft.platformRate)
    setAdRate(draft.adRate)
  }

  function selectPricingCurrency(currency: 'USD' | 'EUR' | 'JPY' | 'GBP', source = dataset, scope = marketScope) {
    if (workspace) return
    setPricingCurrency(currency)
    if (currency === 'USD') {
      setPrice(selectedCategory.defaultPrice)
      setLandedCost(selectedCategory.defaultLandedCost)
      setFixedLaunchCost(2500)
      return
    }
    setFixedLaunchCost(null)
    const seed = pricingSeed(scopeDataset(source, scope).products, currency)
    if (!seed) return
    setPrice(seed.price)
    setLandedCost(seed.landedCost)
  }

  function handleMarketScope(scope: MarketScope) {
    if (!storageReady) return
    if (workspace) {
      const eligible = scopeDataset(dataset, scope).products
      const target = eligible.find((product) => product.productId === pricingProductId) ?? eligible[0]
      if (!target) return
      if (target.productId !== pricingProductId) selectPricingProduct(target)
      setMarketScope(scope)
      return
    }
    setMarketScope(scope)
    const currency = scope === 'EU' || scope === 'JP' || scope === 'UK' ? currencyForMarket(scope) : 'USD'
    if (currency !== pricingCurrency || workspace) selectPricingCurrency(currency, dataset, scope)
  }

  async function generateConceptImage(conceptId: string) {
    const concept = report.visualConcepts?.find((item) => item.id === conceptId)
    if (!concept || workspace || !aiConfigured || !onlineEnabled || concept.citableReviewIds.length === 0) return
    const version = analysisVersion.current
    setConceptImages((current) => ({ ...current, [conceptId]: { status: 'running' } }))
    try {
      const result = await proxyProvider.generateConceptImage({ prompt: concept.imagePrompt, reviewIds: concept.citableReviewIds })
      if (analysisVersion.current !== version) return
      setConceptImages((current) => {
        const next = { ...current, [conceptId]: { status: 'ready' as const, url: result.imageUrl, imageId: result.imageId } }
        storeConceptImages(next)
        return next
      })
    } catch {
      if (analysisVersion.current !== version) return
      setConceptImages((current) => ({ ...current, [conceptId]: { status: 'error', message: '参考图生成失败，文字概念仍可使用。' } }))
    }
  }

  function forgetConceptImage(conceptId: string) {
    setConceptImages((current) => {
      const next = { ...current }
      delete next[conceptId]
      storeConceptImages(next)
      return next
    })
  }

  /** 本地确定性分析的舞台式进度：纯视觉演示，播完即进入 02 页。 */
  function startLocalAnalysisProgress() {
    if (!canAnalyze) return
    const requestVersion = ++analysisVersion.current
    analysisController.current?.abort()
    setBatchProgress(null)
    const localReport = buildInsightReport(scopedDataset, undefined, { deduplicatedCount })
    setHistoricalRun(null)
    clearStageTimers()
    analysisStages.forEach((stage, index) => {
      stageTimers.current.push(window.setTimeout(() => setAnalysisStage(stage.id), index * 150))
    })
    stageTimers.current.push(window.setTimeout(() => {
      if (analysisVersion.current !== requestVersion) return
      setAnalysisStage(null)
      setReport(localReport)
      recordAnalysis(localReport, 'local')
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
    if (!onlineEnabled || !aiConfigured || !canAnalyze || !onlineScopeSupported) return
    const requestVersion = analysisVersion.current + 1
    analysisVersion.current = requestVersion
    analysisController.current?.abort()
    const controller = new AbortController()
    analysisController.current = controller
    setBatchProgress(null)
    setHistoricalRun(null)
    setAiStatus('running')
    setAnalysisError('')
    if (!workspace) startAiProgress()
    try {
      if (workspace) {
        await proxyProvider.isConfigured()
        if (analysisVersion.current !== requestVersion) return
        const cacheIdentity = proxyProvider.model && proxyProvider.promptVersion && proxyProvider.providerOrigin ? { model: proxyProvider.model, promptVersion: proxyProvider.promptVersion, providerOrigin: proxyProvider.providerOrigin } : undefined
        const result = await analyzeBatches(scopedDataset, proxyProvider, { signal: controller.signal, cache: batchCache, cacheIdentity, onProgress: (progress) => { if (analysisVersion.current === requestVersion) setBatchProgress(progress) } })
        if (analysisVersion.current !== requestVersion) return
        clearStageTimers()
        setAnalysisStage(null)
        if (result.analysis) {
          const completed = completedBatchDataset(scopedDataset, result.run)
          const enhanced = { ...buildInsightReportFromAnalysis(completed, result.analysis, 'bailian', undefined, { deduplicatedCount }), batchRun: result.run }
          setReport(enhanced)
          recordAnalysis(enhanced, 'online')
          setAiStatus('ready')
          setAnalysisError(result.run.status !== 'completed' ? '在线运行未完整完成：仅展示成功批次，未完成范围保留在批次明细；没有混入本地规则。' : '')
          setActiveStep('opportunity')
        } else if (result.run.status === 'cancelled') {
          setAiStatus('ready')
          setAnalysisError('已取消：没有成功批次，原报告未改写；已发送的数据无法撤回。')
        } else {
          const fallback = { ...buildInsightReport(scopedDataset, undefined, { deduplicatedCount }), batchRun: result.run }
          setReport(fallback)
          recordAnalysis(fallback, 'offline-fallback')
          setAiStatus('fallback')
          setAnalysisError(result.run.batches.some((batch) => batch.error === 'evidence-contract') ? '模型引用未通过原文锚点校验，已回退本地规则；无效在线结论未保存。' : '全部在线批次失败，当前为明确标识的全范围本地回退；批次失败范围保留在报告。')
        }
        return
      }
      const analysis = await proxyProvider.analyze(scopedDataset, { protocolVersion: 1, signal: controller.signal })
      if (analysisVersion.current !== requestVersion) return
      clearStageTimers()
      setAnalysisStage(null)
      const enhancedReport = buildInsightReportFromAnalysis(scopedDataset, analysis, proxyProvider.mode, undefined, { deduplicatedCount })
      setReport(enhancedReport)
      recordAnalysis(enhancedReport, 'online')
      setAiStatus('ready')
      setActiveStep('opportunity')
    } catch (caught) {
      if (analysisVersion.current !== requestVersion) return
      clearStageTimers()
      setAnalysisStage(null)
      if (caught instanceof BatchPlanError || controller.signal.aborted) {
        setAiStatus('ready')
        setAnalysisError(caught instanceof BatchPlanError ? caught.message : '已取消在线请求，原报告未改写。')
        return
      }
      const fallbackReport = buildInsightReport(scopedDataset, undefined, { deduplicatedCount })
      setReport(fallbackReport)
      recordAnalysis(fallbackReport, 'offline-fallback')
      setAiStatus('fallback')
      const message = caught instanceof Error ? caught.message : ''
      setAnalysisError(caught instanceof EvidenceContractError ? '模型引用未通过原文锚点校验，已回退本地规则；无效在线结论未保存。' : /timeout|超时/i.test(message) ? '百炼请求超时，已安全回退到本地确定性分析。' : '百炼服务暂不可用，已安全回退到本地确定性分析。')
    } finally { if (analysisController.current === controller) analysisController.current = null }
  }

  async function exportReport() {
    if (historicalRun && (complianceGateRef.current.blocked || complianceBusy.current)) { setComplianceStatus('报告未导出：合规复核尚未读取/保存完成或存在未保存记录'); return }
    const complianceContext = complianceGateRef.current
    if (imageIncomplete) { setReviewStatus('报告未导出：图片操作未完成或尚未保存，请先取消或下载未保存图片备份。'); return }
    const saved = historicalRun
    const version = analysisVersion.current
    if (saved && (!historyLoaded || reviewSaving || failedReview || taskSaving || failedTask)) { setReviewStatus('报告未导出：复核或任务读取/保存未完成，避免导出缺失决定；未保存记录可单独下载'); return }
    const payload = {
      ...buildReportExport(saved?.report ?? report, saved?.input ?? { category: workspace ? '用户商品集合' : selectedCategory.name, sourceLabel, marketScope, dataset: scopedDataset, pricingScenario, ...(costSet ? { costSet } : {}) }),
      competitorSnapshots: saved ? [...new Set(saved.input.dataset.products.map((product) => product.currency))].map((currency) => buildCompetitorSnapshot(saved.input.dataset.products.filter((product) => product.currency === currency))) : competitorSnapshots,
      ...(saved ? { analysisRunId: saved.id, archiveDigest: saved.archiveDigest, archivedAt: saved.createdAt, analysisOutcome: saved.outcome } : {}),
      ...(reviewSummary ? { humanReview: reviewSummary } : {}),
      ...(taskSummary?.records.length ? { validationTasks: taskSummary } : {}),
      ...(complianceSummary?.records.length ? { complianceReview: complianceSummary } : {}),
    }
    try {
    let imageReport: import('./domain/concept-image-report').ConceptImageReport | undefined
    if (saved) {
      const { loadConceptImageReport } = await import('./domain/concept-image-report')
      imageReport = await loadConceptImageReport(saved)
      if (workspaceIdentity.current !== saved.workspaceId || analysisVersion.current !== version || imageIncompleteRef.current || reportSelection.current !== saved.id || complianceGateRef.current !== complianceContext || complianceBusy.current) return
    }
    const output = { ...payload, ...(imageReport?.images.length ? { imageReport } : {}), schemaVersion: reportSchemaVersion(payload.schemaVersion, { humanReview: !!reviewSummary, validationTasks: !!taskSummary?.records.length, imageReport: !!imageReport?.images.length, complianceReview: !!complianceSummary?.records.length }) }
    const content = JSON.stringify(output, null, 2)
    if (new TextEncoder().encode(content).byteLength > 20 * 1024 * 1024) throw new Error('报告超过 20 MiB')
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-insight-${report.generatedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    } catch { setReviewStatus('报告未导出：图片校验失败或整包超过 20 MiB；未悄悄遗漏图片，原数据保留。') }
  }

  function openTheme(index: number) {
    const theme = report.themes[index]
    if (!theme) return
    setSelection({
      title: theme.label,
      kind: '评论痛点',
      confidence: theme.evidenceLevel === 'quote-anchored/2' ? '原文锚点结构通过 · 语义待人工复核' : theme.evidence.length ? '旧版 ID 引用绑定 · 语义待人工复核' : '证据不足',
      explanation: `${theme.mentions} 条关键证据指向该体验问题。`,
      evidence: theme.evidence.map((item) => ({ ...item, excerpt: `${item.excerpt} · 市场 ${evidenceMarket(item, scopedDataset) ?? '未知'}` })),
    })
  }

  function openRisk(index: number) {
    const risk = report.complianceRisks[index]
    if (!risk) return
    setSelection({
      title: risk.label,
      kind: `${marketLabel(risk.market)}合规预警`,
      confidence: '已绑定政策资料 · 来源身份和适用性需人工复核',
      explanation: '系统只提示适用范围与措辞风险，不自动作出法律判断。',
      evidence: risk.evidence,
    })
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
        excerpt: `${product.brand} · ${product.title} · ${product.currency} ${product.price} · 评分 ${product.rating ?? '未知'} · 平台评论总数 ${product.reviewCount ?? '未知'}`,
      })),
    })
  }

  function openScore(index: number) {
    const item = report.scoreContributions[index]
    if (!item) return
    const evidence = item.key === 'painIntensity' || item.key === 'improvementSpace'
      ? report.themes.flatMap((theme) => theme.evidence)
      : item.key === 'compliancePenalty' ? report.complianceRisks.flatMap((risk) => risk.evidence) : []
    setSelection({
      title: item.label,
      kind: '评分解释',
      confidence: evidence.length ? '确定性计算 · 有关联证据' : '确定性计算 · 间接数据',
      explanation: `原始分 ${item.rawScore}，${item.direction === 'subtract' ? '扣减' : '增加'}权重 ${Math.round(item.weight * 100)}%，加权贡献 ${item.weightedContribution}。输入：${item.detail}。模型不能直接修改该分项。`,
      evidence,
    })
  }

  const providerLabel = report.providerMode === 'bailian' ? '百炼增强' : aiStatus === 'fallback' ? '本地回退' : '本地规则'

  // Determine market control options based on dataset markets
  const marketOptions = useMemo(() => {
    const markets = new Set(dataset.products.map((p) => p.market))
    const order: MarketScope[] = workspace || markets.has('JP') || markets.has('UK')
      ? ['ALL', 'US', 'EU', 'JP', 'UK']
      : ['US', 'EU', 'BOTH']
    return order
      .filter((value) => value === 'ALL' || value === 'BOTH' || markets.has(value))
      .map((value) => [value, marketLabel(value)] as const)
  }, [dataset.products, workspace])

  return (
    <WorkspaceShell
      activeStep={activeStep}
      onStepChange={setActiveStep}
      sourceLabel={sourceLabel}
      marketScope={marketScope}
      providerLabel={providerLabel}
      report={report}
    >
      <div className="surface-toolbar no-print">
        <div className="market-control" role="group" aria-label="目标市场">
          <span>目标市场</span>
          {marketOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={marketScope === value}
              onClick={() => handleMarketScope(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ai-control">
          <span className={`ai-state ${aiStatus}`}>
            {aiStatus === 'checking'
              ? '检测代理…'
              : aiStatus === 'running'
                ? '百炼分析中'
                : aiStatus === 'ready'
                  ? '百炼可用'
                  : aiStatus === 'fallback'
                    ? '已回退本地规则'
                    : '离线可用'}
          </span>
          <button
            type="button"
            disabled={!aiConfigured || !onlineEnabled || aiStatus === 'running' || !canAnalyze || !onlineScopeSupported}
            onClick={() => void runAiAnalysis()}
          >
            {aiStatus === 'running' ? '分析中…' : '运行百炼增强'}
          </button>
          {aiStatus === 'running' && <button type="button" onClick={() => analysisController.current?.abort()}>取消在线分析</button>}
        </div>
      </div>

      <WorkspaceUtilityPanel storageStatus={storageStatus} onlineEnabled={onlineEnabled} source={workspace ? '用户提供 · 未独立核验' : '演示 / 来源待核验'}>
      <section className="analysis-notice no-print" aria-label="本地工作区保存">
        {!/未保存|失败|未导出|未就绪/.test(storageStatus) && <p role="status">{storageStatus}</p>}
        <div className="source-actions">
          <button type="button" disabled={!workspace || backupInProgress} onClick={() => void exportWorkspace()}>导出工作区 JSON 备份</button>
          <label>恢复工作区备份<input aria-label="恢复工作区备份" type="file" accept=".json,application/json" disabled={!storageReady} onChange={(event) => void restoreBackup(event.target.files?.[0])} /></label>
          <button type="button" disabled={!storageReady} onClick={() => {
            if (lastRealWorkspace.current) { applyWorkspace(lastRealWorkspace.current); return }
            void workspaceDatabase.workspaces.orderBy('updatedAt').last().then((snapshot) => {
            if (snapshot) applyWorkspace(readWorkspaceBackup(workspaceBackup(snapshot)))
            else setStorageStatus('本机没有保存的真实工作区')
          }).catch(() => setStorageStatus('未保存：本地工作区读取失败，当前数据未修改'))
          }}>恢复最近真实工作区</button>
        </div>
        <p>导入数据、逐商品成本草稿、分析存档与验证任务保存在本机；已保存图片纳入完整工作区备份，映射模板单独备份。任务与实验性参考图绑定已保存的历史报告；生图需分别确认在线处理和本次历史资料发送，提供商兼容性及图像语义尚待验证。刷新后的当前报告按当前规则重建，历史记录保留原报告。</p>
        {workspace?.legacyDraft && <p>旧 v1 范围成本保留在备份的 legacyDraft 中，未自动归给任何商品；新商品成本需单独填写。</p>}
        {workspace && <p>在线分析按商品/市场串行分批，每批最多 50 条并受上下文预算限制；可取消，部分失败不混入本地结论。超长单条资料在发送前明确拒绝，不截断。</p>}
        {!onlineScopeSupported && <p>演示范围超出旧版在线接口预算，仍可本地分析，不截断上传。</p>}
      </section>

      <section className="analysis-notice no-print" aria-label="在线数据发送许可">
        <label>
          <input type="checkbox" checked={onlineEnabled} disabled={!aiConfigured} onChange={(event) => {
            setOnlineEnabled(event.target.checked)
            if (!event.target.checked) {
              analysisVersion.current += 1
              analysisController.current?.abort()
              setBatchProgress(null)
              clearStageTimers()
              setAnalysisStage(null)
              setAiStatus(aiConfigured ? 'ready' : 'offline')
              setConceptImages((current) => Object.fromEntries(Object.entries(current).filter(([, image]) => image.status !== 'running')))
            }
          }} />
          同意本次在线处理（分析或参考图生成）
        </label>
        <p>默认仅本地处理。启用后，点击分析会发送当前范围的商品、评论全文与政策；点击出图会发送概念提示词和评论 ID。经代理 {apiBase} 转发至 {providerOrigin}。不发送密钥到浏览器；健康检查不包含数据。数据或市场切换后需重新同意。取消同意仅阻止后续调用，已发送数据无法撤回。</p>
      </section>
      <div className="analysis-notice" aria-label="数据来源与证据边界">
        <p>{provenanceSummary(report.provenance)}</p>
        <p>{evidenceBindingNote}</p>
      </div>
      </WorkspaceUtilityPanel>
      {workspace && (complianceSaving || Object.values(failedComplianceReviews).some(record => record.workspaceId === workspace.id) || (!complianceLoaded && historyStatus.includes('失败'))) && <p role="alert" className="analysis-notice">{complianceStatus}；请在历史合规工具中处理，未就绪时不导出完整备份与历史报告。</p>}

      {analysisStage && (() => {
        const stageLabel = analysisStages.find((item) => item.id === analysisStage)?.label
        const aiRunning = aiStatus === 'running'
        return (
          <div className="analysis-progress" role="status" aria-live="polite">
            <div>
              <strong>{aiRunning ? '真实模型推理中' : '正在构建证据化报告'}</strong>
              <span>{aiRunning ? `${stageLabel} · 通常需 10–60 秒，完成后自动进入市场机会` : stageLabel}</span>
            </div>
            <ol>
              {analysisStages.map((stage) => (
                <li
                  key={stage.id}
                  className={
                    analysisStages.findIndex((item) => item.id === stage.id) <=
                    analysisStages.findIndex((item) => item.id === analysisStage)
                      ? 'complete'
                      : ''
                  }
                >
                  <i />
                  {stage.label}
                </li>
              ))}
            </ol>
          </div>
        )
      })()}

      {analysisError && (
        <div className="analysis-notice" role="alert">
          <p>{analysisError}</p>
          {aiStatus === 'fallback' && aiConfigured && onlineEnabled && canAnalyze && (
            <button type="button" onClick={() => void runAiAnalysis()}>重试百炼分析</button>
          )}
        </div>
      )}
      {imageIncomplete && <p role="alert" className="analysis-notice">概念图片操作未完成或尚未保存；完整导出已阻止，请在历史图片工具中取消、重试保存或下载单张备份。</p>}
      {batchProgress && <div className="no-print"><BatchRunNotice run={batchProgress} offline={aiStatus === 'fallback'} /></div>}

      {activeStep === 'data' && (
        <DataPreparation
          quality={report.dataQuality}
          sourceLabel={sourceLabel}
          error={importError}
          canAnalyze={canAnalyze}
          selectedCategoryId={workspace ? undefined : selectedCategory.id}
          onSelectCategory={handleSelectCategory}
          onFile={(file) => void handleCsvFile(file)}
          onReset={resetDemo}
          onAnalyze={startLocalAnalysisProgress}
          onDatasetImport={importDataset}
          importDisabled={!storageReady}
        />
      )}

      {activeStep === 'opportunity' && (
        <DecisionOverview
          report={report}
          snapshots={competitorSnapshots}
          price={price}
          landedCost={landedCost}
          pricing={pricing}
          fixedLaunchCost={fixedLaunchCost}
          onLaunchCost={(value) => setFixedLaunchCost(value === null ? null : Math.max(0, value))}
          platformRate={platformRate}
          adRate={adRate}
          onPlatformRate={(value) => setPlatformRate(value === null ? null : Math.max(0, Math.min(1, value)))}
          onAdRate={(value) => setAdRate(value === null ? null : Math.max(0, Math.min(1, value)))}
          realWorkspace={!!workspace}
          pricingProductId={pricingProductId}
          onPricingProduct={(productId) => {
            const product = scopedDataset.products.find((candidate) => candidate.productId === productId)
            if (product) selectPricingProduct(product)
          }}
          pricingCurrency={pricingCurrency}
          onPricingCurrency={selectPricingCurrency}
          onPrice={(value) => setPrice(Math.max(0.01, value || 0.01))}
          onCost={(value) => setLandedCost(value === null ? null : Math.max(0, value))}
          onOpenTheme={openTheme}
          onOpenScore={openScore}
          onOpenRisk={openRisk}
          conceptImages={conceptImages}
          onGenerateImage={(conceptId) => void generateConceptImage(conceptId)}
          onImageError={forgetConceptImage}
          imageGenerationEnabled={!workspace && aiConfigured && onlineEnabled && aiStatus !== 'running'}
        />
      )}

      {activeStep === 'evidence' && (
        <EvidenceWorkspace
          report={report}
          onOpenTheme={openTheme}
          onOpenMarket={openMarketEvidence}
          onOpenRisk={openRisk}
        />
      )}

      {activeStep === 'report' && (
        <ReportView
          report={historicalRun?.report ?? report}
          sourceLabel={historicalRun?.input.sourceLabel ?? sourceLabel}
          categoryName={historicalRun?.input.category ?? (workspace ? '用户商品集合' : selectedCategory.name)}
          marketScope={historicalRun?.input.marketScope ?? marketScope}
          onExport={() => exportReport()}
          onPrint={() => window.print()}
          onBack={() => setActiveStep('data')}
          conceptImages={historicalRun ? {} : conceptImages}
          pricingScenario={historicalRun?.input.pricingScenario ?? pricingScenario}
          costSet={historicalRun ? historicalRun.input.costSet : costSet}
          dataset={historicalRun?.input.dataset ?? scopedDataset}
          archive={historicalRun ? { id: historicalRun.id, digest: historicalRun.archiveDigest, savedAt: historicalRun.createdAt } : undefined}
          analysisRun={historicalRun ?? undefined}
          humanReview={reviewSummary}
          validationTasks={taskSummary}
          tools={<>
      {workspace && <>
        <AnalysisHistory entries={history} status={historyStatus} selectedId={historicalRun?.id} onOpen={(run) => { setHistoricalRun(validateAnalysisRun(run)); setSelection(null) }} onRetry={(run) => void persistRun(run)} onBackup={downloadRun} onCurrent={() => setHistoricalRun(null)} />
        <details className="advanced-section no-print"><summary>比较两个历史版本（高级）</summary><AnalysisComparisonPanel key={`comparison-${workspace.id}`} entries={history} disabled={!historyLoaded} /></details>
        {historicalRun && <div className="analysis-notice" role="status">正在查看历史快照：{historicalRun.report.generatedAt}。原文、成本和版本来自当时输入，不覆盖当前草稿。存档指纹 {historicalRun.archiveDigest.slice(0, 16)}</div>}
        {historicalRun && complianceSummary && history.some(entry => entry.run.id === historicalRun.id && entry.status === 'saved') && <details className="advanced-section no-print" open key={`compliance-${historicalRun.id}`}><summary>合规复核 · 人工适用性记录</summary><ComplianceReviewPanel run={historicalRun} summary={complianceSummary} disabled={complianceSaving || !complianceLoaded} failed={!!failedComplianceReview} status={complianceStatus} onSave={record => { if (!failedComplianceReview) void persistCompliance(record) }} onRetry={() => { if (failedComplianceReview) void persistCompliance(failedComplianceReview) }} onBackup={backupFailedCompliance} /></details>}
        {historicalRun && reviewSummary && <details className="advanced-section no-print"><summary>评论语义人工复核（高级）</summary><ReviewPanel key={historicalRun.id} run={historicalRun} summary={reviewSummary} disabled={reviewSaving || !historyLoaded || !history.some((entry) => entry.run.id === historicalRun.id && entry.status === 'saved')} status={reviewStatus} failed={!!failedReview} onSave={saveReview} onRetry={() => { if (failedReview) void persistReview(failedReview) }} onBackup={backupFailedReview} /></details>}
        {historicalRun && taskSummary && <details className="advanced-section no-print"><summary>验证任务（高级）</summary><ValidationTaskPanel key={`tasks-${historicalRun.id}`} run={historicalRun} summary={taskSummary} files={taskFiles} busy={taskSaving || !historyLoaded || !history.some(entry => entry.run.id === historicalRun.id && entry.status === 'saved')} failed={!!failedTask} status={taskStatus} onSave={(task, files) => { if (workspaceIdentity.current === task.workspaceId && !failedTask) void persistTask(task, files) }} onRetry={() => { if (failedTask) void persistTask(failedTask.record, failedTask.files) }} onBackup={backupFailedTask} /></details>}
        {historicalRun && <details className="advanced-section no-print"><summary>已保存概念图（实验性）</summary><Suspense fallback={<p role="status">正在加载本机图片工具</p>}><SavedConceptImages key={historicalRun.id} run={historicalRun} provider={proxyProvider} enabled={aiConfigured && onlineEnabled && aiStatus !== 'running' && history.some(entry => entry.run.id === historicalRun.id && entry.status === 'saved')} destination={providerOrigin} onIncompleteChange={setImageIncomplete} /></Suspense></details>}
        {!historicalRun && <p className="analysis-notice">分析形成结果后自动存档一次。点击已保存记录的“查看历史报告”开始复核；当前预测报告不套用其他运行的人工决定。</p>}
        {!!workspace && (!complianceLoaded || complianceSaving || !!failedComplianceReview) && <p role="alert" className="analysis-notice">{complianceStatus}；合规未就绪时不导出完整历史报告。</p>}
        {(reviewSaving || failedReview) && <p role="alert" className="analysis-notice">{reviewStatus}</p>}
        {(taskSaving || failedTask) && <p role="alert" className="analysis-notice">{taskStatus}</p>}
      </>}
          </>}
          complianceReview={complianceSummary}
          reviewIncomplete={imageIncomplete || (!!historicalRun && (!historyLoaded || reviewSaving || !!failedReview || taskSaving || !!failedTask || complianceGate.blocked))}
        />
      )}



      {activeStep === 'opportunity' && pricingProduct && <details className="advanced-section"><summary>高级成本模型 · 三情景与敏感性 <small>{pricingProduct.productId} · {costSet ? '基线 / 改良 / 压力草稿已配置，缺项仍未知' : '尚未配置'} · 敏感性{costSet?.sensitivity ? '已启用' : '未启用'}</small></summary><CostScenarioPanel key={productScenarioKey(pricingProduct)} value={costSet ?? initialCostSet({ productId: pricingProduct.productId, market: pricingProduct.market, currency: pricingProduct.currency })} onChange={value => setCostSets(previous => ({ ...previous, [productScenarioKey(pricingProduct)]: value }))} /></details>}



      <EvidenceDrawer selection={selection} onClose={() => setSelection(null)} />
    </WorkspaceShell>
  )
}
