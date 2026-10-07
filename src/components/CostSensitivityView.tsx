import { useMemo, useState } from 'react'
import { costKindLabels, costLabels, validateCostSet, type CostSet } from '../domain/cost-scenario'
import { buildCostSensitivity, initialSensitivitySpec, sensitivityAxes, type SensitivityAxis, type SensitivityCurve } from '../domain/cost-sensitivity'

const colors = { baseline: '#24563c', improvement: '#9b4d2f', stress: '#456b8c' }

function paths(curve: SensitivityCurve, low: number, high: number, scale: number) {
  const segments: string[] = []
  let current: string[] = []
  const finish = () => { if (current.length) segments.push(current.join(' ')); current = [] }
  for (const point of curve.points) {
    if (point.contribution === null) { finish(); continue }
    const horizontal = high === low ? 197 : 54 + ((point.value / Math.max(high, 1) - low / Math.max(high, 1)) / ((high - low) / Math.max(high, 1))) * 286
    const vertical = 125 - (point.contribution / scale) * 90
    current.push(`${horizontal.toFixed(3)},${vertical.toFixed(3)}`)
  }
  finish()
  return segments
}

export function CostSensitivityView({ value, onChange, report = false }: { value: CostSet; onChange?: (value: CostSet) => void; report?: boolean }) {
  const [axis, setAxis] = useState<SensitivityAxis>('price')
  const [error, setError] = useState('')
  const analysis = useMemo(() => buildCostSensitivity(value), [value])
  const seed = useMemo(() => initialSensitivitySpec(value), [value])
  const range = value.sensitivity?.ranges[axis]
  const editRange = (key: 'min' | 'max', input: string) => {
    if (!onChange || !value.sensitivity || !range) return
    const next = { ...value, sensitivity: { ...value.sensitivity, ranges: { ...value.sensitivity.ranges, [axis]: { ...range, [key]: input === '' ? NaN : Number(input) } } } }
    try { validateCostSet(next); onChange(next); setError('') } catch { setError('范围无效，此次修改未保存；下限不高于上限、售价大于零、比例在 0–1 内。') }
  }
  return <section className="cost-sensitivity" aria-label="成本敏感性分析">
    <h3>成本敏感性 · 条件曲线</h3>
    {!analysis && <p>尚未启用。先明确基线的售价、广告费率、退货率和改良成本，再确认启用；未知成本不会补零。</p>}
    {!analysis && onChange && <button type="button" disabled={!seed} onClick={() => { if (seed) onChange({ ...value, sensitivity: seed }) }}>确认启用敏感性分析</button>}
    {analysis && <>
      <p>{analysis.note}</p>
      {onChange && <div className="sensitivity-controls">
        <label>变化参数<select aria-label="敏感性变化参数" value={axis} onChange={event => { setAxis(event.target.value as SensitivityAxis); setError('') }}>{sensitivityAxes.map(key => <option key={key} value={key}>{costLabels[key]}</option>)}</select></label>
        <label>下限<input aria-label="敏感性下限" type="number" step="any" value={range?.min ?? ''} onChange={event => editRange('min', event.target.value)} /></label>
        <label>上限<input aria-label="敏感性上限" type="number" step="any" value={range?.max ?? ''} onChange={event => editRange('max', event.target.value)} /></label>
      </div>}
      {error && <p role="alert">{error}</p>}
      {(report ? analysis.axes : analysis.axes.filter(entry => entry.axis === axis)).map(entry => {
        const values = entry.curves.flatMap(curve => curve.points.flatMap(point => point.contribution === null ? [] : [Math.abs(point.contribution)]))
        const scale = Math.max(1, ...values)
        const bounds = analysis.spec.ranges[entry.axis]
        const format = (amount: number) => ['adRate', 'returnRate'].includes(entry.axis) ? `${(amount * 100).toFixed(2)}%` : amount.toFixed(2)
        return <div key={entry.axis} className="sensitivity-axis">
          <h4>{costLabels[entry.axis]} → 单件贡献（{analysis.target.currency}）</h4>
          <p>范围 {format(bounds.min)}–{format(bounds.max)}；横轴为条件参数，纵轴为单件贡献。</p>
          {values.length ? <svg className="sensitivity-chart" viewBox="0 0 360 250" role="img" aria-label={`${costLabels[entry.axis]}变化下三情景贡献曲线`}>
            <line x1="54" y1="35" x2="54" y2="215" stroke="#9ba99f" /><line x1="54" y1="125" x2="340" y2="125" stroke="#9ba99f" strokeDasharray="4 4" />
            <text x="4" y="40">{scale.toFixed(2)}</text><text x="8" y="129">0</text><text x="4" y="215">{(-scale).toFixed(2)}</text>
            <text x="54" y="239">{format(bounds.min)}</text><text x="300" y="239">{format(bounds.max)}</text>
            {entry.curves.flatMap(curve => paths(curve, bounds.min, bounds.max, scale).map((path, index) => <polyline key={`${curve.kind}-${index}`} points={path} fill="none" stroke={colors[curve.kind]} strokeWidth="3" strokeDasharray={curve.kind === 'stress' ? '6 4' : curve.kind === 'improvement' ? '2 2' : undefined} />))}
            {bounds.min === bounds.max && entry.curves.map(curve => curve.points[0].contribution === null ? null : <circle key={curve.kind} cx="197" cy={125 - (curve.points[0].contribution / scale) * 90} r="4" fill={colors[curve.kind]} />)}
          </svg> : <p>此范围未形成可计算贡献；请补齐其他变量，不显示虚假零线。</p>}
          <p className="sensitivity-legend">{entry.curves.map(curve => <span key={curve.kind} style={{ color: colors[curve.kind] }}>{costKindLabels[curve.kind]}（{curve.kind === 'baseline' ? '实线' : curve.kind === 'improvement' ? '点线' : '虚线'}） </span>)}</p>
          <details open={report}><summary>查看 11 个条件点、保本销量和未计算原因</summary>
            <div className="sensitivity-table-wrap"><table><caption>{costLabels[entry.axis]}条件点 · 不代表实际销量</caption><thead><tr><th>情景</th><th>条件值</th><th>单件贡献</th><th>保本销量</th><th>未计算原因</th></tr></thead><tbody>{entry.curves.flatMap(curve => curve.points.map((point, index) => <tr key={`${curve.kind}-${index}`}><td>{costKindLabels[curve.kind]}</td><td>{format(point.value)}</td><td>{point.contribution === null ? '未计算' : point.contribution.toFixed(2)}</td><td>{point.breakEvenUnits === null ? '未计算' : point.breakEvenUnits}</td><td>{point.status === 'ready' ? '无' : point.status === 'non-positive-contribution' ? '非正贡献' : point.status === 'calculation-error' ? '数值超出安全范围' : point.missing.map(key => costLabels[key as keyof typeof costLabels]).join('、')}</td></tr>))}</tbody></table></div>
          </details>
        </div>
      })}
      <p className="report-fingerprint">敏感性指纹 {analysis.digest} · {analysis.schemaVersion}；不证明假设或收益真实。</p>
    </>}
  </section>
}
