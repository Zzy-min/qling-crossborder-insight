import type { ReactNode } from 'react'

export function WorkspaceUtilityPanel({ storageStatus, onlineEnabled, source, children }: { storageStatus: string; onlineEnabled: boolean; source: string; children: ReactNode }) {
  return <section className="workspace-utility no-print" aria-label="工作区与数据边界">
    <details><summary>工作区设置 <span>{storageStatus.startsWith('已保存') ? '已保存到本机' : storageStatus.startsWith('演示') ? '演示模式' : '本机工作区'} · 在线处理：{onlineEnabled ? '已许可' : '关闭'} · 来源：{source}</span></summary>{children}</details>
    {/未保存|失败|未导出|未就绪/.test(storageStatus) && <p role={storageStatus.includes('等待') ? 'status' : 'alert'}>{storageStatus}</p>}
  </section>
}
