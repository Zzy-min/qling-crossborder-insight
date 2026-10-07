import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DatasetBundle, InsightReport } from '../domain/types'
import { decisionState } from '../domain/decision'
import { generateExecutiveMemoHtml } from '../domain/memo'
import { buildEvidenceIntegrity, buildScenarioIntegrity } from '../domain/integrity'
import { evidenceBindingNote, provenanceSummary } from '../domain/provenance'
import { pricingScenarioMessage, pricingScenarioNote, pricingScenarioRows, type PricingScenario } from '../domain/market'
import { sampleStatisticsLabel } from '../domain/sample-statistics'
import type { ReviewSummary } from '../domain/human-review'
import { ReviewSummaryView } from './ReviewSummaryView'
import { BatchRunNotice } from './BatchRunNotice'
import type { CostSet } from '../domain/cost-scenario'
import { CostScenarioSummary } from './CostScenarioSummary'
import type { ValidationSummary } from '../domain/validation-task'
import { ValidationSummaryView } from './ValidationSummaryView'
import type { AnalysisRun } from '../domain/analysis-run'
import type { ConceptImageReport } from '../domain/concept-image-report'
import type { ComplianceSummary } from '../domain/compliance-review'
import { ComplianceReviewSummaryView } from './ComplianceReviewSummaryView'

export function ReportView({
  report,
  sourceLabel,
  categoryName = '出海选品',
  marketScope = '全球市场',
  onExport,
  onPrint,
  onBack,
  conceptImages = {},
  pricingScenario,
  costSet,
  dataset,
  archive,
  humanReview,
  validationTasks,
  reviewIncomplete = false,
  analysisRun,
  complianceReview,
  tools,
}: {
  report: InsightReport
  sourceLabel: string
  categoryName?: string
  marketScope?: string
  onExport: () => void | Promise<void>
  onPrint: () => void
  onBack: () => void
  conceptImages?: Record<string, { url?: string }>
  pricingScenario?: PricingScenario
  costSet?: CostSet
  dataset?: DatasetBundle
  archive?: { id: string; digest: string; savedAt: string }
  humanReview?: ReviewSummary
  validationTasks?: ValidationSummary
  reviewIncomplete?: boolean
  analysisRun?: AnalysisRun
  complianceReview?: ComplianceSummary
  tools?: ReactNode
}) {
  const [imageRevision, setImageRevision] = useState(0)
  const [imageState, setImageState] = useState<{ key: string; report?: ConceptImageReport; error?: string }>({ key: '' })
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const busy = useRef(false)
  const printArea = useRef<HTMLElement>(null)
  const runKey = analysisRun ? `${analysisRun.id}/${analysisRun.archiveDigest}` : ''
  const images = imageState.key === runKey ? imageState.report : undefined
  const imageReady = !analysisRun || !!images
  const exportContext = useMemo(() => ({}), [report, pricingScenario, costSet, dataset, conceptImages, humanReview, validationTasks, complianceReview, reviewIncomplete, analysisRun, sourceLabel, categoryName, marketScope, archive?.id, archive?.digest])
  const currentContext = useRef(exportContext)
  currentContext.current = exportContext
  useEffect(() => {
    const controller = new AbortController()
    setImageState({ key: runKey }); setExportError('')
    if (analysisRun && !reviewIncomplete) void (async () => {
      try {
        const { loadConceptImageReport } = await import('../domain/concept-image-report')
        if (controller.signal.aborted) return
        const imageReport = await loadConceptImageReport(analysisRun, controller.signal)
        if (!controller.signal.aborted) setImageState({ key: runKey, report: imageReport })
      } catch { if (!controller.signal.aborted) setImageState({ key: runKey, error: '报告图片读取或校验失败，未遗漏图片生成报告；原数据保留。请重读检查。' }) }
    })()
    return () => controller.abort()
  }, [analysisRun, runKey, imageRevision, reviewIncomplete])
  const decision = decisionState(report)
  const integrity = useMemo(
    () => buildEvidenceIntegrity(report, JSON.stringify({ category: categoryName, marketScope, sourceLabel }), { version: 2, dataset }),
    [report, categoryName, marketScope, sourceLabel, dataset],
  )
  const scenarioIntegrity = useMemo(() => pricingScenario ? buildScenarioIntegrity(pricingScenario) : undefined, [pricingScenario])

  async function exportMemo() {
    if (busy.current || reviewIncomplete || !imageReady) return
    const context = exportContext
    busy.current = true; setExportBusy(true); setExportError('')
    try {
    let imageReport: ConceptImageReport | undefined
    if (analysisRun) {
      const { loadConceptImageReport } = await import('../domain/concept-image-report')
      imageReport = await loadConceptImageReport(analysisRun)
    }
    const embedded: Record<string, string> = {}
    await Promise.all((report.visualConcepts ?? []).map(async (concept) => {
      const url = conceptImages[concept.id]?.url
      if (!url) return
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' })
        if (!response.ok || Number(response.headers.get('content-length')) > 4_000_000) { void response.body?.cancel(); throw new Error('演示参考图读取失败') }
        const bytes = new Uint8Array(await response.arrayBuffer())
        const mediaType = response.headers.get('content-type')?.split(';')[0] ?? ''
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType) || bytes.length === 0 || bytes.length > 4_000_000) throw new Error('演示参考图类型或大小不符合要求')
        let binary = ''
        bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
        embedded[concept.id] = `data:${mediaType};base64,${btoa(binary)}`
      } catch {
        throw new Error('演示参考图未导出，不静默遗漏图片')
      }
    }))
    if (currentContext.current !== context) return
    const html = generateExecutiveMemoHtml(report, { categoryName, marketScope, conceptImages: embedded, integrity, scenarioIntegrity, pricingScenario, costSet, archive, humanReview, validationTasks, imageReport, complianceReview, analysisRun })
    if (new TextEncoder().encode(html).byteLength > 20 * 1024 * 1024) throw new Error('完整 HTML 超过 20 MiB，未截断或遗漏内容')
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html; charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qling-executive-memo-${report.generatedAt.slice(0, 10)}.html`
    link.click()
    URL.revokeObjectURL(url)
    } catch { if (currentContext.current === context) setExportError('备忘录未导出：图片或完整报告校验失败/超过 20 MiB，未悄悄遗漏图片；原数据保留。') }
    finally { busy.current = false; setExportBusy(false) }
  }

  async function printReport() {
    if (busy.current || reviewIncomplete || !imageReady) return
    const context = exportContext
    busy.current = true; setExportBusy(true); setExportError('')
    try {
      if (analysisRun) {
        const { loadConceptImageReport } = await import('../domain/concept-image-report')
        const imageReport = await loadConceptImageReport(analysisRun)
        if (currentContext.current !== context) return
        setImageState({ key: runKey, report: imageReport })
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        await Promise.all(Array.from(printArea.current?.querySelectorAll('img') ?? []).map(image => image.decode()))
      }
      if (currentContext.current === context) onPrint()
    } catch { if (currentContext.current === context) setExportError('打印未发起：图片校验或显示失败，未遗漏图片打印；原数据保留。') }
    finally { busy.current = false; setExportBusy(false) }
  }
  async function exportJson() {
    if (busy.current || reviewIncomplete || !imageReady) return
    busy.current = true; setExportBusy(true)
    try { await onExport() } finally { busy.current = false; setExportBusy(false) }
  }

  return (
    <section className="workspace-page report-page">
      <header className="report-toolbar no-print">
        <div>
          <span className="page-index">04 / DECISION REPORT</span>
          <h1>决策报告已就绪。</h1>
        </div>
        <div className="report-actions-row">
          <button type="button" onClick={onBack}>← 返回修改数据</button>
          <button type="button" disabled={reviewIncomplete || !imageReady || exportBusy} onClick={() => void exportMemo()}>📄 导出高管备忘录 HTML</button>
          <button type="button" disabled={reviewIncomplete || !imageReady || exportBusy} onClick={() => void printReport()}>🖨️ 打印 / 保存 PDF</button>
          <button className="primary-action" disabled={reviewIncomplete || !imageReady || exportBusy} type="button" onClick={() => void exportJson()}>导出证据 JSON</button>
        </div>
      </header>
      {analysisRun && <div className="analysis-notice no-print"><p role={imageState.error ? 'alert' : 'status'}>{imageState.error ?? (images ? `报告包含 ${images.images.length} 张当前快照的已校验本机图片` : '正在准备当前快照报告图片；未就绪时不导出或打印')}</p><button type="button" disabled={exportBusy || reviewIncomplete} onClick={() => setImageRevision(value => value + 1)}>重新校验报告图片</button></div>}
      {exportError && <p role="alert" className="no-print">{exportError}</p>}
      {tools}
      <article className="print-report" ref={printArea}>
        {archive && <p className="archive-stamp">历史快照 · 存档 {archive.id} · 保存于 {archive.savedAt}<br />完整存档指纹 {archive.digest}。本报告使用当时原文、版本与成本，不代表当前分析。</p>}
        <header>
          <div className="report-brand">
            <span>QL</span>
            <strong>Qling 出海智察</strong>
          </div>
          <small>生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')} · {sourceLabel} · {categoryName}</small>
        </header>
        <p>{provenanceSummary(report.provenance)}</p>
        <p>{evidenceBindingNote}</p>
        {costSet && <CostScenarioSummary value={costSet} />}
        {images && <section className="report-saved-images" aria-label="报告概念参考图"><h3>历史快照概念参考图</h3><p>未验证概念参考，不证明性能、尺寸、认证、量产或改良效果；原文存在与绑定不证明语义支持。</p><p className="report-fingerprint">图片报告 {images.schemaVersion} · 图片指纹 {images.digest}</p>{images.images.map(({ metadata, dataUrl }) => <article key={metadata.id}><h4>{report.themes.find(theme => theme.id === metadata.themeId)?.label ?? metadata.themeId} · 未验证概念</h4><img src={dataUrl} alt="未验证概念参考图" /><p>假设：{metadata.response.binding.hypothesis}</p>{metadata.response.binding.anchors.map((anchor, index) => <blockquote key={index}>{anchor.quote} · {anchor.reviewId} · 语义待复核</blockquote>)}<p>{metadata.schemaVersion === 'qling-concept-image-file/2' ? '从备份恢复，保留原生成绑定' : '原本机保存记录'} · 模型 {metadata.response.model} · {metadata.createdAt}</p><p className="report-fingerprint">文件指纹 {metadata.fileDigest} · 原生成工作区 {metadata.response.binding.workspaceId}</p></article>)}</section>}
        {!!validationTasks?.records.length && <ValidationSummaryView value={validationTasks} />}
        <p>{report.evidenceProtocol === 2 ? '新版原文锚点协议 · 结构校验不证明语义正确，仍需人工复核。' : '旧版引用等级 · ID 绑定不等于精确原文锚点。'}</p>
        {report.batchRun && <BatchRunNotice run={report.batchRun} offline={report.providerMode !== 'bailian'} report />}

        <div className="report-decision">
          <div>
            <span>市场进入建议</span>
            <h2>{decision.label}</h2>
            <p>{report.recommendation}</p>
          </div>
          <strong>{report.opportunityScore}<small>/100</small></strong>
        </div>

        <div className="report-kpis">
          <div><span>引用绑定覆盖率</span><strong>{Math.round(report.evidenceCoverage.coverageRate * 100)}%</strong></div>
          <div><span>关键痛点</span><strong>{report.themes.length}</strong></div>
          <div><span>合规事项</span><strong>{report.complianceRisks.length}</strong></div>
          <div><span>购买标记（输入声明）</span><strong>{Math.round(report.dataQuality.verifiedPurchaseRate * 100)}%</strong></div>
        </div>

        <section>
          <span className="report-section-label">TOP ACTIONS</span>
          <h3>建议优先执行</h3>
          {report.actions.slice(0, 3).map((action, index) => (
            <div className="report-action" key={action.id}>
              <span>0{index + 1}</span>
              <div>
                <strong>{action.title}</strong>
                <p>{action.rationale}</p>
                <small>证据：{action.evidenceRecordIds.join('、')}</small>
              </div>
            </div>
          ))}
        </section>

        {report.themes.some((theme) => theme.evidence.some((reference) => reference.quoteAnchor)) && <section>
          <span className="report-section-label">QUOTE ANCHORS</span>
          <h3>方面与原文锚点 · 语义待复核</h3>
          {report.themes.map((theme) => <div key={theme.id} className="report-quote">
            <strong>{theme.label} · {theme.aspectId ?? '未标注方面'} · {{ positive: '正向', negative: '负向', neutral: '中性', mixed: '混合' }[theme.sentiment]}</strong>
            {theme.sampleStats?.map((sample) => <p key={`${sample.productId}-${sample.market}`}>{sampleStatisticsLabel(sample)}</p>)}
            {theme.evidence.filter((reference) => reference.quoteAnchor).map((reference, index) => <p key={index}><small>{reference.recordId} · {reference.quoteAnchor!.field} · UTF-16 [{reference.quoteAnchor!.start}, {reference.quoteAnchor!.end})</small><br />“{reference.quoteAnchor!.quote}”</p>)}
          </div>)}
          <p>20% 提及率 / 60% 预测负向占比为产品启发式；至少 20 条样本、3 条支持证据。不代表平台总体、严重度或已人工确认。</p>
        </section>}

        {report.visualConcepts && report.visualConcepts.length > 0 && (
          <section>
            <span className="report-section-label">PRODUCT CONCEPTS</span>
            <h3>产品改良概念与生图提示词</h3>
            <div className="report-concepts-list">
              {report.visualConcepts.map((c) => (
                <div key={c.id} className="report-concept-item">
                  <strong>{c.conceptTitle}（针对：{c.themeLabel}）</strong>
                  <p>{c.designSolution}</p>
                  {conceptImages[c.id]?.url && <img src={conceptImages[c.id]?.url} alt={`${c.conceptTitle}的参考图`} />}
                  <small>{conceptImages[c.id]?.url ? '参考图已生成，仍须人工判断，不是实拍商品。' : '概念提示词，尚未生成图片：'}{c.imagePrompt}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        {humanReview && <ReviewSummaryView summary={humanReview} />}
        {complianceReview && <ComplianceReviewSummaryView value={complianceReview} />}

        {pricingScenario && (
          <section className="report-pricing">
            <span className="report-section-label">PRICING ASSUMPTIONS</span>
            <h3>定价假设与保本测算</h3>
            <dl>
              {pricingScenarioRows(pricingScenario).map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
            <p>{pricingScenarioMessage(pricingScenario)}</p>
            <small>{pricingScenarioNote}</small>
          </section>
        )}

        <section className="report-method">
          <span className="report-section-label">METHOD</span>
          <h3>评分口径</h3>
          <p>{report.scoreContributions.map((item) => item.label + ' ' + (item.direction === 'subtract' ? '−' : '+') + Math.round(item.weight * 100) + '%').join(' · ')}</p>
          <small>AI 负责文本理解，确定性规则负责评分；模型不能直接修改最终分数。</small>
        </section>

        <footer>
          <p>本报告为信息辅助，不构成法律、财务或销量预测。合规结论与市场行动均需人工复核。</p>
          <p className="report-fingerprint">
            证据链指纹 {integrity.algorithm} {integrity.digest.toUpperCase()} · {integrity.schemaVersion} · {integrity.coverage === 'scoped-dataset' ? '当前范围完整输入与引用原文' : '仅报告引用，不覆盖完整输入'} · 覆盖 {integrity.coveredThemes} 项聚类 / {integrity.coveredEvidence} 条引用 / {integrity.coveredClaims} 条结论
          </p>
          {scenarioIntegrity && <p className="report-fingerprint">情景指纹 {scenarioIntegrity.algorithm} {scenarioIntegrity.digest.toUpperCase()} · {scenarioIntegrity.schemaVersion} · 公式 {scenarioIntegrity.formulaVersion} · 覆盖定价输入、状态与结果。</p>}
          <p>指纹仅用于内容一致性检查，不证明来源真实或语义正确，不是数字签名。</p>
        </footer>
      </article>
    </section>
  )
}
