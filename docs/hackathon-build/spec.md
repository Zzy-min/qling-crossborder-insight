# 技术规格

## 数据流

`公开样例/CSV -> schema 校验 -> 规范化与去重 -> fixture/百炼分析 -> 确定性规则 -> 证据绑定 -> InsightReport`

## 数据契约

- `ProductRow`: productId, title, brand, market, currency, price, rating, reviewCount, capturedAt, sourceUrl
- `ReviewRow`: reviewId, productId, locale, rating, title, body, reviewedAt, verifiedPurchase, sourceUrl
- `PolicyRow`: policyId, market, authority, topic, effectiveAt, summary, sourceUrl
- `EvidenceRef`: sourceUrl, capturedAt, excerpt, recordId, evidenceType
- `InsightReport`: themes, opportunityScore, complianceRisks, recommendation, generatedAt, providerMode

## 评分

- 痛点强度 30%
- 可改进空间 25%
- 竞争与价格空间 20%
- 数据可信度 10%
- 合规风险扣分 15%

所有分项为 0-100，最终分数限制在 0-100。模型不能直接修改最终分数。

## 隐私与安全

- CSV 默认仅在浏览器本地处理。
- 不接收手机号、邮箱、订单号等个人信息字段。
- API Key 不进入浏览器 bundle、Git 或日志。
- 合规预警是信息辅助，不构成法律意见。

