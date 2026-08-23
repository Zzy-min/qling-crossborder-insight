# Qling 出海智察

面向中小跨境卖家的证据约束型 AI 市场决策工作台——把评论、竞品和政策数据变成可追溯到原始记录的进入决策，而不是 AI 摘要。AI 输出必须引用数据集中存在的记录 ID，编造引用会被合同层拒绝。

> CSDN AI+跨境黑客松参赛作品（场景：AI 市场洞察）｜团队：轻灵

## 演示工作流

1. **数据准备**：导入评论 CSV，完成隐私、字段、重复记录与商品关联校验。
2. **市场机会**：查看机会指数、评分贡献、评论痛点、竞品快照和定价情景。
3. **证据与风险**：从结论钻取原始记录，检查证据矩阵并查看确定性行动项。
4. **决策报告**：导出 schema `1.1` 的证据 JSON，或打印为单页报告。

内置样例、用户 CSV 与百炼增强状态会被明确区分；fixture 不代表实时市场数据。

## 快速开始

**环境要求**：Node.js ≥ 20.6（需要 `--env-file-if-exists` 标志）

```powershell
npm install

# 终端 1：启动前端
npm run dev

# 终端 2（可选）：启动 AI 代理（需配置 .env）
npm run dev:api
```

前端默认运行在 `http://127.0.0.1:5173`，API 代理在 `http://127.0.0.1:8787`。
未配置 API Key 时前端自动回退到本地确定性分析，不报错。

## 质量门禁

```powershell
npm run check          # vitest (60) + server tests (32) + build
npm run test:e2e       # Playwright (14, 需 Chrome)
npm run eval           # 黄金集本地规则评测 (200)
npm run eval:model     # 真实模型合同评测 (12, 需 dev:api + 真实 Key)
npm run smoke:real     # 真实链路冒烟 (9 项检查, 需 dev:api + 真实 Key)
```

## 评测口径说明

| 评测 | 命令 | 性质 | 样本量 |
|---|---|---|---|
| 黄金集评测 | `npm run eval` | 本地确定性规则（不涉及模型） | 200 例 |
| 模型合同评测 | `npm run eval:model` | 真实百炼调用（合同形状 + 零幻觉 + 主题接地） | 12 例 |
| 人工抽样复核 | 见 `docs/evaluation/human-review.md` | 单人复核 | 40/200 |

三者互为补充：黄金集证明规则引擎自洽性，模型合同评测证明真实链路可靠性，人工抽样是唯一的人眼看过证据。详见 `docs/evaluation/model-contract-eval.md`。

## 可选百炼代理

百炼密钥只配置在本地 `.env` 的 `BAILIAN_API_KEY`，不写入前端 bundle、不提交到 Git。未配置时 `/api/analyze` 返回 503，离线样例仍可正常使用。

```ini
# .env (gitignored)
BAILIAN_API_KEY=sk-sp-...
BAILIAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen3.7-plus
```

Web 页面检测到代理已配置后"运行百炼增强"按钮才可用；调用失败或模型证据无效时自动回退到本地确定性报告并显示重试入口。分析模式由 `/health` 探测决定，不由前端环境变量控制。

## 离线桌面版

```powershell
npm run desktop
```

加载本地生产构建，不依赖网络或 API Key。`npm run build:desktop` 可生成未安装的桌面打包目录。

## 项目结构

```
src/          前端（React 19 + TypeScript + Vite 7）
server/       AI 代理（node:http，转发阿里云百炼 Token Plan）
scripts/      评测与冒烟脚本
tests/e2e/    Playwright 端到端测试
docs/         架构说明、PRD、评测报告、演示脚本
```
