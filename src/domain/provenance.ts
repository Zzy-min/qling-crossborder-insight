import type { DatasetProvenance, SourceKind } from './types'

export const demoProvenance: DatasetProvenance = { products: 'demo', reviews: 'demo', policies: 'demo' }

export function sourceKindLabel(kind: SourceKind | undefined): string {
  switch (kind) {
    case 'demo': return '演示数据 · 非商业事实验证'
    case 'user-provided': return '用户提供 · 未独立核验'
    case 'official': return '官方来源资料 · 适用性待复核'
    default: return '来源身份未知 · 待核验'
  }
}

export function provenanceSummary(provenance?: DatasetProvenance): string {
  return `商品：${sourceKindLabel(provenance?.products)}；评论：${sourceKindLabel(provenance?.reviews)}；政策：${sourceKindLabel(provenance?.policies)}`
}

export const evidenceBindingNote = '引用绑定覆盖率仅表示结论关联了已知记录，不证明原文支持结论或来源真实。购买标记为输入声明，未经平台独立验证。'
