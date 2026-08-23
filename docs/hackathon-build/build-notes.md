# Build Notes

## 2026-08-12

- 建立独立比赛项目，避免改动 `qling-trade` 中归属不明的用户修改。
- 冻结 USB-C 充电器、三主两辅、公开样例 + CSV、fixture-first 的范围。
- 初赛状态按“报名完成、作品尚未确认提交”处理。
- RED：领域测试因缺少 CSV 和分析模块按预期失败。
- GREEN：实现 CSV 精确错误定位、隐私字段拒绝、去重、确定性评分、评论主题、合规证据和离线报告；7 项测试通过。
- 建立 Web 薄切片并完成全页视觉验收；将演示评论来源改为显式 `fixture:`，避免占位链接被误认作真实证据。

## 2026-08-22

- **P0-1 端点修复**：默认基地址改为 Token Plan 专属 `https://token-plan.cn-beijing.maus.aliyuncs.com/compatible-mode/v1`，模型改为 `qwen3.7-plus`；`enable_thinking:false` 使推理延迟从 48s 降至 ~9s；超时从 20s 提至 60s。commit `9cd47fc`。
- **P0-2 真实联调冒烟**：`smoke-real.mjs` 9/9 检查全过——合同形状、零幻觉引用、主题接地均通过。commit `7d2ced5`。
- **P1-2 抽样复核**：从 200 例黄金集分层抽样 40 例（4 family × 10），AI 预填 accept/revise 判断，诚实声明单人 20% 覆盖率。commit `3862954`。

## 2026-08-23

- **仓库卫生**：`engines.node >=20.6` 声明；构建依赖移 devDependencies；删死配置 `VITE_MODEL_MODE`；清理 636MB electron-builder 残留。commit `1c5672c`。
- **前端演示体验修复**：进度状态机绑定真实请求（不再假播完即跳页）；70s 前端超时；决策文案统一为共享函数；回退加重试按钮；Drawer 无障碍（role=dialog + 焦点陷阱）；内部 ID/枚举中文化。vitest 39→48。commit `fe1f580`。
- **服务端加固**：envelope 校验 + 2MB 响应上限；并发保护（MAX_INFLIGHT=2 → 429）；脱敏访问日志；顶层错误兜底防崩溃；`SYSTEM_PROMPT` 导出去重；`smoke:real` 正式入口。server 测试 23→32。commit `52f73b1`。
- **组件级测试基建**：jsdom + @testing-library/react（文件级注解，不影响既有 48 例）；新增 12 例（App 状态机 4、EvidenceDrawer 无障碍 4、DataPreparation 错误展示 4）。vitest 48→60。commit `47c2a39`。
- **真实模型合同评测**：12 例有区分度的合成样例（多评论噪声/弱信号/负样本/对抗 ID），走 8787 代理真实调用 qwen3.7-plus。12/12 通过，零幻觉，37/37 主题接地，延迟 3.8–8.6s。commit `09cf7ae`。
