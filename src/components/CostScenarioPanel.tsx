import { useState } from 'react'
import { compareCostScenarios, costKeys, costKindLabels, costLabels, type CostItem, type CostKey, type CostScenario, type CostSet } from '../domain/cost-scenario'
import { CostSensitivityView } from './CostSensitivityView'

export function CostScenarioPanel({ value, onChange }: { value: CostSet; onChange: (value: CostSet) => void }) {
  const [kind, setKind] = useState<CostScenario['kind']>('baseline')
  const [error, setError] = useState('')
  const scenario = value.scenarios.find(candidate => candidate.kind === kind)!
  const evaluated = compareCostScenarios(value.scenarios)
  const update = (next: CostScenario) => {
    const updated = { ...value, scenarios: value.scenarios.map(candidate => candidate.kind === kind ? next : candidate) }
    try { compareCostScenarios(updated.scenarios); setError(''); onChange(updated) } catch { setError('参数无效或计算超出安全范围；此次修改未保存，请检查数值、日期或备注长度。') }
  }
  const setItem = (key: CostKey | 'price', item: CostItem) => update(key === 'price' ? { ...scenario, price: item } : { ...scenario, costs: { ...scenario.costs, [key]: item } })
  const activeKeys: Array<CostKey | 'price'> = ['price', ...(scenario.landedMode === 'combined' ? ['landed'] as const : ['procurement', 'freightDuty'] as const), ...costKeys.filter(key => !['landed', 'procurement', 'freightDuty'].includes(key))]
  return <section className="ledger-section detailed-costs" aria-label="三情景成本明细">
    <div className="section-title"><div><span>CONTRIBUTION SCENARIOS</span><h2>改良前后 · 贡献测算</h2></div></div>
    <p>独立于上方旧版简化测算。所有成本默认未知；不预填平台费率，不是净利润或销量预测。{scenario.target.productId} / {scenario.target.market} / {scenario.target.currency}</p>
    {error && <p role="alert">{error}</p>}
    <label>编辑情景<select aria-label="编辑成本情景" value={kind} onChange={event => setKind(event.target.value as CostScenario['kind'])}>{Object.entries(costKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <button type="button" onClick={() => {
      const mode = scenario.landedMode === 'combined' ? 'split' : 'combined'
      const costs = { ...scenario.costs }
      for (const key of mode === 'combined' ? ['procurement', 'freightDuty'] as const : ['landed'] as const) costs[key] = { ...costs[key], status: 'unknown', value: null, source: null, updatedAt: null }
      update({ ...scenario, landedMode: mode, costs })
    }}>切换为{scenario.landedMode === 'combined' ? '采购＋头程关税' : '综合到岸'}（清空另一组成本）</button>
    <div className="cost-items">{activeKeys.map(key => {
      const item = key === 'price' ? scenario.price : scenario.costs[key]
      const rate = ['platformRate', 'adRate', 'returnRate'].includes(key)
      const label = costLabels[key]
      return <details key={key} className="cost-item"><summary>{label} · {item.status === 'unknown' ? '未知' : item.status === 'not-included' ? '明确不计入' : `${rate ? (item.value! * 100).toFixed(2) + '%' : item.currency + ' ' + item.value}`}</summary>
        <label>状态<select aria-label={`${label}状态`} value={item.status} onChange={event => {
          const status = event.target.value as CostItem['status']
          setItem(key, { ...item, status, value: status === 'unknown' ? null : status === 'not-included' ? 0 : item.value ?? (key === 'price' ? 1 : 0) })
        }}><option value="unknown">未知</option><option value="included">计入（允许零）</option>{key !== 'price' && <option value="not-included">明确不计入</option>}</select></label>
        <label>{rate ? '比例（0–1）' : `金额（${item.currency}）`}<input type="number" aria-label={`${label}明细值`} min={key === 'price' ? 0.01 : 0} max={rate ? 1 : undefined} step="any" disabled={item.status !== 'included'} value={item.value ?? ''} onChange={event => {
          const amount = event.target.value === '' ? null : Number(event.target.value)
          if (amount !== null && (!Number.isFinite(amount) || amount < (key === 'price' ? 0.01 : 0) || (rate && amount > 1))) { setError('此次无效数值未保存：金额不能为负、售价须大于零，比例须介于 0 与 1。'); return }
          setItem(key, { ...item, value: amount, status: amount === null ? 'unknown' : 'included' })
        }} /></label>
        <label>参数身份<select aria-label={`${label}身份`} value={item.identity} onChange={event => setItem(key, { ...item, identity: event.target.value as CostItem['identity'] })}><option value="user-assumption">用户假设</option><option value="measured">用户声明实测</option><option value="example">示例</option></select></label>
        <label>来源（未知可留空）<input aria-label={`${label}来源`} maxLength={1000} value={item.source ?? ''} onChange={event => setItem(key, { ...item, source: event.target.value.trim() ? event.target.value : null })} /></label>
        <label>来源更新时间（不是导入时间）<input type="date" aria-label={`${label}更新时间`} value={item.updatedAt ?? ''} onChange={event => { if (!event.target.value || /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setItem(key, { ...item, updatedAt: event.target.value || null }) }} /></label>
      </details>
    })}</div>
    <label>其他未覆盖成本（每行一项，离开输入框后保存）<textarea key={kind} aria-label="其他未覆盖成本" defaultValue={scenario.omittedCosts.join('\n')} onBlur={event => update({ ...scenario, omittedCosts: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} /></label>
    <div className="cost-comparison">{evaluated.map(({ scenario: current, result, contributionDelta, scenarioDigest }) => <article key={current.kind} aria-label={`${costKindLabels[current.kind]}贡献结果`}>
      <h3>{costKindLabels[current.kind]}</h3><p>单件贡献：{result.contributionPerUnit === null ? '未计算' : `${current.target.currency} ${result.contributionPerUnit.toFixed(2)}`}</p>
      <p>相对基线：{contributionDelta === null ? '未计算' : contributionDelta.toFixed(2)}</p><p>保本销量：{result.breakEvenUnits === null ? '未计算' : `${result.breakEvenUnits} 件`}</p>
      <p>待填写：{result.missing.map(key => costLabels[key as CostKey | 'price']).join('、') || '无'}</p><small className="report-fingerprint">{scenarioDigest}</small>
    </article>)}</div>
    <p>退货率 × 每次退货增量净损失；不要重复计入退款、佣金和货值。改良效果是条件假设，未知固定投入或非正贡献不计算保本销量。用户声明实测不等于平台核验。</p>
    <CostSensitivityView value={value} onChange={onChange} />
  </section>
}
