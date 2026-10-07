# P1 界面收敛与合规接线（2026-10-07）

## 已批准范围

按用户粘贴请求完成现有产品局部收敛，不重做品牌，不改服务器、安全门禁、评分、成本或原文合同，不提交、推送、部署或上传资料。沿用四步主路径与 IndexedDB 本地优先设计。真实评论、独立标注、卖家试用和真实生图下载仍未验证。

## 实施顺序与数据流

1. 阅读现有 App、工作区、图片备份/报告、任务与比较实现；复用原合同和版本。合规复核绑定已保存 AnalysisRun，未知来源/适用性保留 null/unknown。
2. Dexie v8 追加 complianceReviews；保存时校验原运行、连续全局 revision、完整修订链和工作区 10,000 条上限。仅事务成功更新 UI 统计；失败保留内存记录，支持重试和独立备份。
3. 完整备份按能力选择版本：无合规记录维持 /4、/5、/6；有记录使用 /7。恢复时显式重绑定工作区、运行及指纹，合规与原工作区/分析/语义复核/任务/附件/图片同事务追加；损坏或写入失败整包回滚，不删除原内容。
4. ReportView、JSON、离线 HTML、打印共享同一历史合规汇总，原自动风险提示保持独立。报告最终版本只选择一次，含合规记录为 1.8，不被图片降为 1.7。读取、保存、失败记录未处理时阻止输出，异步范围改变废弃旧结果。
5. 顶部三块说明折叠为工作区设置；真实导入仍为主入口，兼容评论与映射模板下沉。高级成本、视觉概念、比较、语义复核、任务和图片工具按需展开。移除手动重复存档，保留原分析完成后的自动保存与失败重试。

## 验证与隐私

- 定向：原合规合同、迁移、连续修订、重绑定、混合能力整包、写入故障回滚、HTML 注入和版本组合。
- 集成：重新执行 npm run test、npm run test:server、npm run build、npm run test:e2e；不得复用旧测试数字。
- 原生浏览器：本地/模拟在线/回退存档、合规保存刷新恢复、未保存备份与输出阻断、JSON/HTML/打印信息一致、四步主路径、抽屉键盘行为、1440/390px 与实际 PDF 渲染。
- 来源机构/日期/确认状态全部是用户声明；不声称法律准入、官方认证或独立验证。来源 URL 仅文本，不自动访问。备份包含原始评论与成本，不能未经授权分享；不含凭证。

## 本轮文件责任

| 文件 | 局部修改目的 |
| --- | --- |
| src/App.tsx | 合规加载/保存/失败/导出门禁，最终版本选择，删除重复存档，工具分层与外显失败提示 |
| src/domain/compliance-review.ts | 保留原合同，追加恢复重绑定与汇总核验 |
| src/domain/workspace.ts | v8 表、追加保存、校验读取、恢复同事务 |
| src/domain/workspace-images.ts | /7 含合规及图片，保持旧备份可读 |
| src/domain/report-export.ts | 报告能力版本单次最高版本选择 |
| src/domain/memo.ts | 转义后的独立合规完整历史及原运行核验 |
| src/components/ComplianceReviewPanel.tsx | 已保存快照编辑、完整字段、失败重试与备份 |
| src/components/ComplianceReviewSummaryView.tsx | 页面/打印共用完整修订与限制说明 |
| src/components/WorkspaceUtilityPanel.tsx | 紧凑设置，主动显示保存异常 |
| src/components/ReportView.tsx | 标题后工具插槽、合规章节/HTML上下文及打印，保留原导出门禁 |
| src/components/AnalysisHistory.tsx | 最近三条/主动查看全部，不过滤真实历史，不再暗示手动存档 |
| src/components/DataPreparation.tsx | 兼容单评论入口默认折叠 |
| src/components/DatasetImport.tsx | 映射模板默认折叠，不改变 Worker 或数据规则 |
| src/components/DecisionOverview.tsx | 视觉概念默认折叠；主区改为样本/关联商品/被引用评论指标，不重复全局右栏；原生成限制不变 |
| src/components/EvidenceWorkspace.tsx | 提示复核应在历史报告中进行，不增加编辑器 |
| src/styles.css | 复用原变量，紧凑工具/表单/响应式和打印样式 |
| src/domain/compliance-review.test.ts | 合规 HTML 转义与汇总作用域回归 |
| src/domain/workspace-images.test.ts | v7 升级、混合备份、重绑定及故障回滚 |
| src/domain/report-export.test.ts | 各能力组合不得降级 |
| src/domain/concept-image-file.test.ts | 升级后的最高 DB 版本断言，原内容保护断言保留 |
| src/components/ComplianceReviewPanel.test.tsx | 未知默认值、确认前必填校验、保存失败的禁用/重试/备份 |
| tests/e2e/advanced-controls.ts | 按真实折叠入口展开工具，分析后自动存档替代手动存档 |
| tests/e2e/compliance-review.spec.ts | 新合规完整 UI/备份/报告/失败路径与紧凑四步原生验证 |
| tests/e2e/seller-workspace.spec.ts、demo-flow.spec.ts、cost-scenarios.spec.ts、validation-tasks.spec.ts、analysis-comparison.spec.ts、mapping-templates.spec.ts、concept-image-storage.spec.ts | 保留旧行为断言，操作显式展开后的入口；不恢复已移除的重复存档按钮 |

## 当前状态

本轮界面收敛与合规持久化/报告接线已完成技术验收；整体真实卖家试用目标未完成。未改服务端、评分、成本或原文合同，未提交、推送、部署或上传；本轮真实模型调用 0。

### 最终执行结果

以下均为当前改动后的实际执行结果，不复用历史数字；日志位于 `artifacts/product-improvement/`。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| npm run test | 363/363，41 文件，退出 0 | p1-unit-final.log |
| npm run test:server | 69/69，退出 0 | p1-server-final.log |
| npm run build | TypeScript 与 Vite 构建成功，退出 0 | p1-build-final.log |
| npm.cmd run test:e2e -- --workers=1 | 45/45，退出 0，约 2.6 分钟 | p1-e2e-acceptance.log |
| git diff --check | 退出 0；Windows 换行提示保留 | 终端检查 |

PowerShell 的 npm 包装入口拒绝 workers 参数（EUNKNOWNCONFIG）；改用同一环境的 npm.cmd 执行上述完整串行 E2E，没有修改安装或运行时配置。最终构建日志主包 618.21 kB，超过 500 kB 的警告保留，不能据此宣称性能目标达标。

### 验收证据与失败处理

| 验收项 | 已验证内容 |
| --- | --- |
| A：紧凑主路径 | 四步 1440/390px，设置默认折叠，标题位置、键盘展开、页面无横向溢出；高级内容仍可展开 |
| B：自动存档 | 本地、模拟在线与回退成功分析自动存档；移除手动重复按钮，保存失败仍可重试 |
| C：完整合规链 | 历史真实工作区快照新增待复核及确认修订；刷新恢复、全运行连续 revision、完整字段与限制说明 |
| D：事务与恢复 | /7 混合复核/任务/附件/图片/合规恢复，新本机 ID 显式重绑定；坏包、冲突、写入失败回滚；旧 /3–/6 继续可读 |
| E：输出一致 | JSON 1.8 不被图片 1.7 降级；页面、HTML、打印呈现完整历史、未知值、来源身份、指纹与限制；攻击文本转义 |
| F：未保存保护 | 写入失败不计入已保存统计；报告三出口与完整备份阻断，独立备份与仅本机重试可用；旧范围异步结果废弃 |
| G：原行为回归 | 45 项完整 E2E 保留导入、情景、语义复核、任务、比较、图片存储和抽屉键盘路径；在线端点为模拟 |

最终截图目录 `p1-shell-1791382592286/` 覆盖四步与两种宽度；`p1-compliance-1791382582068/` 保存 390/1440px 合规表单、完整报告截图及实际 A4 `compliance-memo.pdf`、`compliance-report.pdf`。已渲染检查合规表单、主路径与报告打印页：长指纹可换行，完整修订可读，无横向溢出或内容遗漏。HTML 备忘录记录会跨页延续，不保证单张卡片占一页。

早期失败包括旧最高 DB 版本断言、折叠入口尚未展开、等待状态与泛化 alert 查询歧义，以及恢复后未选既有事项就新增修订。按真实入口、明确状态和数据作用域修复；保留中间日志，不放宽合同、不将早期失败冒称全绿。

### 未完成与下一步边界

- 本轮仅技术验收。经授权的至少 100 条真实评论、独立标注、卖家操作测试与复用观察仍未完成，不宣称准确率、利润提升或卖家验证完成。
- 真实提供商图片下载仍受此前保留地址解析安全门禁阻断；不更改 DNS 或安全规则。合成小图仅证明存储和导出，不证明图像语义或改良质量。
- 合规确认是用户记录，不是认证、法律意见或准入通过；来源链接与哈希不证明来源真实。
- 独立失败合规备份已有严格领域读取接口，本轮未增加独立导入 UI；完整 /7 工作区恢复入口已交付。
- 下一步优先检验现有闭环的实际使用瓶颈与真实数据质量门禁，不继续堆叠市场、图表或 Agent 框架；外联、部署、提交及卖家资料上传仍须另行授权。
