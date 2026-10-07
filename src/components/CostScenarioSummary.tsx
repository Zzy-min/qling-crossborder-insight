import { costSetRows, type CostSet } from '../domain/cost-scenario'
import { CostSensitivityView } from './CostSensitivityView'

export function CostScenarioSummary({ value }: { value: CostSet }) {
  return <section className="detailed-cost-summary" aria-label="明细贡献测算报告"><h3>三情景成本假设与贡献</h3><p>此明细与旧版简化情景分别列示；不是财务净利润，改良效果尚待验证。</p><dl>{costSetRows(value).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>{value.sensitivity && <CostSensitivityView value={value} report />}</section>
}
