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
```

当前只使用明确标注的离线样例，不需要 API Key。

## 可选百炼代理

百炼密钥只配置在本地服务端环境变量 `BAILIAN_API_KEY`，不得写入前端或提交到 Git。未配置时 `/api/analyze` 明确返回 503，离线样例仍可正常使用。

```powershell
$env:BAILIAN_API_KEY='在本机设置，不要写入文件'
npm run dev:api
```

## 离线桌面版

```powershell
npm run desktop
```

该命令加载本地生产构建，不依赖网络或 API Key。`npm run build:desktop` 可生成未安装的桌面打包目录。
