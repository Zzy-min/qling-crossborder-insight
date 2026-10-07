import { useState } from 'react'
import type { HistoryEntry } from './AnalysisHistory'
import { compareAnalysisRuns, comparisonHtml, comparisonPercent, comparisonDelta, type AnalysisComparison } from '../domain/analysis-comparison'
import { costKindLabels } from '../domain/cost-scenario'

export function AnalysisComparisonPanel({ entries, disabled }: { entries: HistoryEntry[]; disabled: boolean }) {
  const saved = entries.filter(entry => entry.status === 'saved')
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const [productId, setProductId] = useState('')
  const [value, setValue] = useState<AnalysisComparison>()
  const [error, setError] = useState('')
  const before = saved.find(entry => entry.run.id === beforeId)?.run
  const after = saved.find(entry => entry.run.id === afterId)?.run
  const current = value && before?.archiveDigest === value.before.archiveDigest && after?.archiveDigest === value.after.archiveDigest && productId === value.productId ? value : undefined
  function compare() {
    if (!before || !after || !productId) return
    try { setValue(compareAnalysisRuns(before, after, productId)); setError('') }
    catch { setValue(undefined); setError('比较失败：存档内容或指纹无效，原历史未修改；请备份后核对。') }
  }
  function download(format: 'json' | 'html') {
    if (!current || disabled) return
    const content = format === 'json' ? JSON.stringify(current, null, 2) : comparisonHtml(current)
    if (new TextEncoder().encode(content).length > 20_000_000) { setError('比较文件超过 20 MB，未导出或截断；请使用更小且可比的原始分析范围。'); return }
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/html;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `qling-analysis-comparison.${format}`; link.click(); URL.revokeObjectURL(url)
  }
  const options = saved.map(entry => <option key={entry.run.id} value={entry.run.id}>{new Date(entry.run.createdAt).toLocaleString('zh-CN')} · {entry.run.outcome} · {entry.run.id.slice(0, 8)}</option>)
  return <section className="analysis-comparison ledger-section no-print" aria-label="历史分析比较">
    <h2>历史分析 · 先核验可比性</h2><p>只比较所选商品。样本结构或原文变化时不计算趋势；相同样本仅描述模型/规则输出差异，不证明产品改良。</p>
    <fieldset disabled={disabled || saved.length < 2}><legend>选择两份已保存运行</legend><div className="comparison-selectors">
      <label>A：参照运行<select aria-label="比较参照运行" value={beforeId} onChange={event => { setBeforeId(event.target.value); setProductId(''); setValue(undefined); setError('') }}><option value="">请选择</option>{options}</select></label>
      <label>B：对照运行<select aria-label="比较对照运行" value={afterId} onChange={event => { setAfterId(event.target.value); setValue(undefined); setError('') }}><option value="">请选择</option>{options}</select></label>
      <label>明确比较商品<select aria-label="比较商品" value={productId} onChange={event => { setProductId(event.target.value); setValue(undefined); setError('') }}><option value="">请选择</option>{before?.input.dataset.products.map(product => <option key={product.productId} value={product.productId}>{product.productId} / {product.market} / {product.currency}</option>)}</select></label>
    </div><button type="button" onClick={compare} disabled={!before || !after || !productId}>核验并比较历史分析</button></fieldset>
    {saved.length < 2 && <p>至少需要两份已保存运行；保存中或失败的存档不参与比较。</p>}
    {error && <p role="alert">{error}</p>}
    {current && <>
      <p role="status">{current.comparable ? '相同样本/配置，可描述输出差异' : '不可直接比较趋势；仅并列查看'}</p>
      <ul>{current.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>{current.notice}</p>
      <div className="comparison-sides">{([['A：参照', current.before], ['B：对照', current.after]] as const).map(([label, data]) => <article key={label} aria-label={label}>
        <h3>{String(label)}</h3><p>{data.sourceLabel} · {data.scope.target?.productId ?? '未找到商品'} / {data.scope.target?.market} / {data.scope.target?.currency}</p><p>分析样本 {data.scope.sampleCount} / 原始样本 {data.scope.originalSampleCount}</p>
        <p>评论日期 {data.scope.timeRange?.from ?? '未知'} 至 {data.scope.timeRange?.to ?? '未知'}；运行 {data.generatedAt}（不是数据更新时间）</p>
        <p>模式 {data.configuration.outcome} · 规则 {data.configuration.analysisVersion?.rules ?? '未知'} · 模型 {data.configuration.analysisVersion?.model ?? '未知'} · 提示词 {data.configuration.analysisVersion?.prompt ?? '未知'}</p>
        <details><summary>查看样本结构与原成本输入</summary><p>评分 {JSON.stringify(data.scope.structure.ratings)}</p><p>语言 {JSON.stringify(data.scope.structure.locales)}</p><p>购买声明 {JSON.stringify(data.scope.structure.purchaseDeclarations)}</p><p>日期分布 {JSON.stringify(data.scope.structure.dates)}</p>{data.costInputs.map((row, index) => <p key={index}>{row.label}：{row.value}</p>)}{!data.costInputs.length && <p>此运行未绑定所选商品成本明细</p>}</details>
        <p className="report-fingerprint">样本指纹 {data.scope.sampleDigest}<br />配置指纹 {data.configurationDigest}<br />原存档 {data.archiveDigest}</p>
      </article>)}</div>
      <h3>方面预测对照（不混入人工复核）</h3><div className="sensitivity-table-wrap"><table><caption>唯一评论提及率与预测负向占比；差值为百分点</caption><thead><tr><th>方面</th><th>A 提及/负向/混合</th><th>B 提及/负向/混合</th><th>提及率差/负向差</th></tr></thead><tbody>{current.rows.map(row => <tr key={row.aspectId}><th scope="row">{row.aspectId}</th>{([[row.before, current.before], [row.after, current.after]] as const).map(([finding, side], index) => <td key={index}>{finding?.mentionCount ?? 0}/{side.scope.sampleCount}<br />{comparisonPercent(finding?.mentionRate ?? (side.scope.sampleCount ? 0 : null))} / {comparisonPercent(finding?.negativeRate)} / {finding?.mixedCount ?? 0}</td>)}<td>{comparisonDelta(row.delta?.mentionRatePoints)} / {comparisonDelta(row.delta?.negativeRatePoints)}</td></tr>)}</tbody></table></div>
      {!current.rows.length && <p>未识别可比较方面；不代表没有痛点。</p>}
      {current.rows.map(row => <details key={row.aspectId}><summary>{row.aspectId} · 查看两次原文锚点</summary>{([['A', row.before], ['B', row.after]] as const).map(([label, finding]) => <div key={label}><p>{label}</p>{finding ? finding.anchors.map((reference, index) => <blockquote key={index}>{reference.anchor.quote}<small>{reference.anchor.reviewId} / {reference.anchor.field} [{reference.anchor.start},{reference.anchor.end}) · {reference.sentiment}</small></blockquote>) : <p>未识别，不代表不存在</p>}</div>)}</details>)}
      <h3>独立成本条件差异</h3><p>不受评论可比性判断替代；未知不补零，差值不代表实际收益变化。</p>
      {current.costRows.map(row => <p key={row.kind}>{costKindLabels[row.kind]} · A 单件贡献 {row.before?.result.contributionPerUnit ?? '未计算'} · B {row.after?.result.contributionPerUnit ?? '未计算'} · 贡献差 {comparisonDelta(row.contributionDelta)} · 保本销量差 {comparisonDelta(row.breakEvenDelta)} {row.limitation}</p>)}
      {!current.costRows.length && <p>两次运行没有所选商品的成本明细，不生成明细差值。</p>}
      <p className="report-fingerprint">比较指纹 {current.digest} · {current.schemaVersion}，不是数字签名。</p>
      <button type="button" disabled={disabled} onClick={() => download('json')}>下载历史比较 JSON</button><button type="button" disabled={disabled} onClick={() => download('html')}>下载历史比较 HTML（可打印）</button>
    </>}
  </section>
}
