import type { DragEvent } from 'react'
import type { DataQualitySummary } from '../domain/types'
import { CATEGORY_PRESETS, type CategoryPreset } from '../fixtures/categories'

export interface ImportErrorDetail { summary: string; detail: string }

export function DataPreparation({
  quality,
  sourceLabel,
  error,
  canAnalyze,
  selectedCategoryId,
  onSelectCategory,
  onFile,
  onReset,
  onAnalyze,
}: {
  quality: DataQualitySummary
  sourceLabel: string
  error: ImportErrorDetail | null
  canAnalyze: boolean
  selectedCategoryId?: string
  onSelectCategory?: (category: CategoryPreset) => void
  onFile: (file?: File) => void
  onReset: () => void
  onAnalyze: () => void
}) {
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    onFile(event.dataTransfer.files[0])
  }

  return (
    <section className="workspace-page data-page">
      <header className="page-heading">
        <div>
          <span className="page-index">01 / DATA INTAKE</span>
          <h1>让数据先通过审查，<br />再让模型参与判断。</h1>
        </div>
        <p>支持多品类出海预置场景或导入合法获得的评论 CSV。系统会先检查隐私、关联关系与数据完整度，失败不会覆盖当前有效报告。</p>
      </header>

      {/* 多品类出海场景切换 */}
      <section className="category-preset-section" aria-label="出海品类预置场景">
        <div className="section-title">
          <div>
            <span>INDUSTRY PRESETS</span>
            <h2>典型出海品类预置</h2>
          </div>
          <small>一键载入跨国商品、真实痛点与官方政策</small>
        </div>
        <div className="category-grid">
          {CATEGORY_PRESETS.map((cat) => {
            const isSelected = selectedCategoryId === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                className={`category-card ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectCategory?.(cat)}
              >
                <div className="cat-icon">{cat.icon}</div>
                <div className="cat-body">
                  <strong>{cat.name}</strong>
                  <p>{cat.tagline}</p>
                </div>
                {isSelected && <span className="active-badge">当前选择</span>}
              </button>
            )
          })}
        </div>
      </section>

      <div className="data-layout">
        <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <input type="file" accept=".csv,text/csv" onChange={(event) => onFile(event.target.files?.[0])} />
          <span className="drop-icon">↧</span>
          <strong>拖入自定义评论 CSV，或点击选择文件</strong>
          <p>最多 1,000 行、1 MB 文本；拒绝 email、phone、address 等个人信息字段。</p>
          <span className="drop-action">选择 CSV</span>
        </label>
        <div className="source-actions">
          <a href="./samples/reviews-template.csv" download>下载 CSV 模板</a>
          <button type="button" onClick={onReset}>恢复默认数码快充样例</button>
        </div>
      </div>

      {error && (
        <div className="validation-error" role="alert">
          <span>导入未生效</span>
          <strong>{error.summary}</strong>
          <p>{error.detail}</p>
        </div>
      )}

      <section className="quality-section">
        <div className="section-title">
          <div>
            <span>VALIDATION RESULT</span>
            <h2>数据质量摘要</h2>
          </div>
          <span className="quality-pass">✓ 隐私检查通过</span>
        </div>
        <div className="quality-ledger">
          <div><span>当前数据</span><strong>{sourceLabel}</strong></div>
          <div><span>评论记录</span><strong>{quality.totalReviews}</strong><small>有效购买 {Math.round(quality.verifiedPurchaseRate * 100)}%</small></div>
          <div><span>关联商品</span><strong>{quality.linkedProducts}</strong><small>去重 {quality.deduplicatedCount} 条</small></div>
          <div><span>时间范围</span><strong>{quality.timeRange ? `${quality.timeRange.from} — ${quality.timeRange.to}` : '暂无'}</strong></div>
          <div><span>市场覆盖</span><strong>{quality.marketCoverage.length ? quality.marketCoverage.join(' / ') : '暂无'}</strong></div>
        </div>
      </section>

      <footer className="page-footer">
        <p>{canAnalyze ? '数据门禁通过，可以生成确定性分析。' : '当前市场缺少商品、评论或政策证据，暂不能分析。'}</p>
        <button className="primary-action" type="button" disabled={!canAnalyze} onClick={onAnalyze}>
          开始分析 <span>→</span>
        </button>
      </footer>
    </section>
  )
}
