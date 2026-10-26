# Coding 上游问题

## 问题清单

| ID | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |
|---|---|---|---|---|---|
| UP-001 | INFO | 已关闭 | 旧轮次曾报告 `named_business_handler` 解析异常；当前可读证据 `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/script-report.json:1029` 至 `:1035` 显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷。 | `doc/features/bc-openCard-2/bank-card-opening-flow/coding/upstream-issues.md` | 无需修改上游产物；保留历史关闭记录并以当前 harness 结果为准。 |
