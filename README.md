# Qling 出海智察

面向中小跨境卖家的可追溯 AI 市场情报 Agent。当前为 AI+跨境黑客松初赛原型。

## 本地运行

```powershell
npm install
npm run dev
```

## 质量门禁

```powershell
npm run check
npm run test:e2e
npm run eval
```

当前只使用明确标注的离线样例，不需要 API Key。

页面提供可下载的 `reviews-template.csv`；端到端门禁覆盖 CSV 导入、隐私字段拒绝、定价变化、证据报告下载与手机端横向溢出。

`npm run eval` 会评估 200 例机器播种样例并生成本地 JSON 报告。机器播种结果不等同于人工标注结论；人工复核状态见 `docs/evaluation/human-review.md`。

`npm run prepare:submission` 会从生产构建重新生成初赛截图、材料 ZIP 和 SHA-256 清单，并检查 ZIP 不含环境文件、依赖目录、日志或构建缓存。产物状态始终为草稿，不会执行官网提交。

## 可选百炼代理

百炼密钥只配置在本地服务端环境变量 `BAILIAN_API_KEY`，不得写入前端或提交到 Git。未配置时 `/api/analyze` 明确返回 503，离线样例仍可正常使用。

Web 页面会检测本机代理是否已配置。只有检测成功后“运行百炼增强”按钮才可用；调用失败或模型证据无效时会自动回退到本地确定性报告。

```powershell
# 先在当前 PowerShell 会话中设置 BAILIAN_API_KEY，不要写入文件
npm run dev:api
```

## 离线桌面版

```powershell
npm run desktop
```

该命令加载本地生产构建，不依赖网络或 API Key。`npm run build:desktop` 可生成未安装的桌面打包目录。
