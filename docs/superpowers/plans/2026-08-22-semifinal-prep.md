# 复赛准备实施计划｜Qling 出海智察

- 日期：2026-08-22
- 状态：草案（待确认后实施）
- 前提：初赛已于 2026-08-12 提交（团队「轻灵」，场景 AI 市场洞察）；评审期 8.21–8.31；复赛开发期 9.1–9.13；决赛路演 9.25。

## 一、现状健康检查（2026-08-22 新鲜验证）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 前端单元测试 | `npm run test` | ✅ 60 passed |
| 服务端测试 | `npm run test:server` | ✅ 32 passed |
| 端到端 | `npm run test:e2e` | ✅ 14 passed |
| 类型与构建 | `npm run build` | ✅ 成功（需先清空旧 `dist`，本机沙箱回收机制会阻断 vite 的 emptyOutDir） |
| 页面渲染 | 本地起静态服务器访问 `/` | ✅ 首屏 HTML 正常 |

结论：初赛原型完全可运行；`checklist.md` 中两个未完成项（200 例人工复核、复赛视频/最终提交）仍然成立。

## 二、差距清单（按优先级）

### P0-1｜百炼真实联调的地址与模型错配（当前最大阻塞）

事实核查：

- `server/app.mjs:6` 默认 `endpoint = https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- `server/app.mjs:60` 默认 `model = qwen-plus`
- `server/index.mjs:5` 创建服务时**不传** endpoint，永远走默认值
- 赛事发放的 Token Plan Key 的参赛凭证（见本地参赛信息文档）：
  - 基地址必须为 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
  - 可用模型为 `qwen3.8-max`、`qwen3.7-max`、`qwen3.7-plus` 等，**不含 `qwen-plus`**
- 后果：直接用参赛 Key 启动 `npm run dev:api` 会命中错误端点/模型，真实联调必然失败。
- 状态：**已完成**。commit `9cd47fc`。

改动方案：

1. `server/app.mjs`：`createApiServer` 已接受 `endpoint` 参数，保留；把默认值注释清楚。
2. `server/index.mjs`：读取 `BAILIAN_BASE_URL`（默认保持现值以兼容通用百炼），拼出 `endpoint` 传入；读取 `BAILIAN_MODEL`（已有）。
3. `.env.example`：新增 `BAILIAN_BASE_URL=` 注释示例（Token Plan 专属地址写在注释里，不落值）。
4. 测试：新增「endpoint 可被环境变量覆盖」「401/无效 Key 映射为 502/明确错误」的 node:test 用例，全部用假 fetcher，不发真实请求。
5. 安全红线：真实 Key 只从当前终端会话环境变量注入，不进 `.env` 文件、不进 Git、不进日志。

### P0-2｜真实模型下的 Prompt 与证据合同联调

现状：Provider 合同测试全部用假响应；真实模型的输出格式稳定性未知。

1. 用最小请求（1 条样例市场）试跑真实端点，核对返回 JSON 是否满足 `InsightReport` schema 与 recordId 存在性校验。
2. 如模型输出不稳：在 `src/providers/provider.ts` 侧补充输出清洗/重试（保持"未知 ID 中止报告"的硬合同不变）。
3. 联调额度纪律：单次验证 1–2 个请求即停，不做批量压测；记录每次调用时间与用途到 `docs/hackathon-build/build-notes.md`。

### P1-1｜复赛演示视频与提交材料

`checklist.md` 未完成项。复赛通常要求 DEMO 与现场/视频路演。

1. 基于 `docs/submission/demo-script.md` 改写 3 分钟复赛版脚本：突出"真实百炼已联调"这一初赛到复赛的增量。
2. 录屏：真实模式下的分析→证据钻取→导出全流程，附离线回退演示（评委关心失败路径）。
3. 材料打包复用现有 `prepare:submission` 卫生检查流程。

### P1-2｜黄金集人工复核（抽样降级）

200 例双评在 13 天内不现实。方案：从机器播种集分层抽 40 例做单人复核+争议标注，更新 `docs/evaluation/human-review.md`，如实写明覆盖率 40/200，不夸大。

### P2｜可选加分项（时间有余才做）

- 公开可访问的静态演示（仅 fixture 模式，不带代理），供评委直接体验。
- 多品类样例扩展（当前只有 USB-C 充电器），展示方案通用性。

## 三、时间安排

| 阶段 | 时间 | 内容 |
|---|---|---|
| 预备期（现在即可开始，不依赖晋级结果） | 8.22–8.31 | P0-1 代码改动 + 假响应测试；用参赛 Key 做 1 次最小真实冒烟 |
| 第 1 周 | 9.1–9.7 | P0-2 真实联调收敛；P1-2 抽样复核；回归全部门禁 |
| 第 2 周 | 9.8–9.13 | P1-1 视频与材料；路演排练；冻结代码 |
| 缓冲 | 9.14–9.24 | 评审反馈响应、决赛 DEMO 打磨 |

说明：预备期的 P0-1 无论是否晋级都值得做——它是初赛 PRD 承诺的"核心 AI 能力最终经百炼调用"的收尾，不是白干。

## 四、验收标准

1. `BAILIAN_BASE_URL` + `BAILIAN_MODEL` 环境变量注入后，`dev:api` 模式下 `/api/analyze` 返回包含有效 recordId 的真实报告，前端"百炼增强"按钮可用且证据可钻取。
2. `npm run check` 与 `npm run test:e2e` 全绿。
3. 真实联调证据（脱敏后的请求/响应样例）记入 `build-notes.md`，全程无 Key 泄漏（`git grep sk-sp` 为空）。
4. 复赛视频 ≤3 分钟，脚本描述与实际功能一一对应，未完成能力不得出现在口播中。

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 初赛未晋级 | 预备期产出（真实联调）本身就是产品收尾，损失趋近于零 |
| Token Plan 额度被冒烟耗尽 | 最小请求原则 + 调用台账；`qwen3.7-plus` 级别模型优先于 max 级 |
| Key 泄漏 | 只走会话环境变量；提交前 `git grep` 检查；参赛凭证文档仅存本地，不移动进任何仓库 |
| 真实模型输出不稳导致演示翻车 | 演示脚本保留离线回退路径（初赛脚本已有该段落，沿用） |

## 六、第一步（确认后执行）

实施 P0-1：修改 `server/index.mjs` 支持 `BAILIAN_BASE_URL`，补 2 个 node:test 用例，更新 `.env.example`，跑 `npm run test:server` 验证。
