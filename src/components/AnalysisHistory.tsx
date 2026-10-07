import type { AnalysisRun } from '../domain/analysis-run'
import { useState } from 'react'
import { marketLabel } from '../domain/labels'

export interface HistoryEntry { run: AnalysisRun; status: 'saving' | 'saved' | 'error' }

export function AnalysisHistory({ entries, status, selectedId, onOpen, onRetry, onBackup, onCurrent }: {
  entries: HistoryEntry[]; status: string; selectedId?: string; onOpen: (run: AnalysisRun) => void;
  onRetry: (run: AnalysisRun) => void; onBackup: (run: AnalysisRun) => void; onCurrent: () => void;
}) {
  const [showAll, setShowAll] = useState(false)
  return <section className="quality-section analysis-history no-print" aria-label="分析历史">
    <div className="section-title"><div><span>ANALYSIS ARCHIVE</span><h2>分析历史</h2></div><small>独立快照 · 不覆盖当前草稿</small></div>
    <p role="status">{status}</p>
    <p>历史保留原文、版本和成本；指纹不证明结论正确。分析结果自动存档一次，失败可重试。</p>
    {selectedId && <button type="button" onClick={onCurrent}>返回当前报告</button>}
    {!entries.length && <p>尚无存档。分析形成结果后自动保存一次；保存失败可重试同一存档。</p>}
    <ol className="history-list">{(showAll ? entries : entries.slice(0, 3)).map(({ run, status: saved }) => <li key={run.id}>
      <div><strong>{new Date(run.report.generatedAt).toLocaleString('zh-CN')} · {run.outcome === 'online' ? '在线增强' : run.outcome === 'offline-fallback' ? '在线失败后的本地回退' : '本地规则'}</strong>
        {run.report.batchRun && <p>批次状态 {run.report.batchRun.status} · 成功 {run.report.batchRun.batches.filter((batch) => batch.status === 'completed').length}/{run.report.batchRun.batches.length}，未完成范围不代表没有痛点</p>}
        <p>{marketLabel(run.input.marketScope)} · {run.input.dataset.reviews.length} 条评论 · 测算 {run.input.pricingScenario.target.productId} / {run.input.pricingScenario.target.currency}</p>
        <small>{saved === 'saved' ? '已保存' : saved === 'saving' ? '保存中，尚未确认' : '未保存，可重试或单独备份'} · {run.report.analysisVersion?.rules ?? '未知规则版本'} · {run.report.analysisVersion?.model ?? '未知模型'} · {run.evidenceDigest.slice(0, 12)}</small>
      </div><div className="history-actions"><button type="button" aria-pressed={selectedId === run.id} onClick={() => onOpen(run)}>查看历史报告</button>
        <button type="button" onClick={() => onBackup(run)}>下载分析存档</button>
        {saved === 'error' && <button type="button" onClick={() => onRetry(run)}>重试保存历史</button>}
      </div>
    </li>)}</ol>
    {entries.length > 3 && <button type="button" onClick={() => setShowAll(value => !value)}>{showAll ? '收起较早历史' : `查看全部 ${entries.length} 条历史`}</button>}
  </section>
}
