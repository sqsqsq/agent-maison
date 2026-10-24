# Coding 上游问题

| ID | 严重程度 | 分类 | 涉及文件 | 问题描述/依据 | 修复建议 | 状态 |
|---|---|---|---|---|---|---|
| UP-001 | BLOCKER | framework 门禁缺陷 | `framework/profiles/hmos-app/harness/named-handler.ts:108` | coding harness 的 `named_business_handler` 在读取合法的 `use-cases.yaml` 数组字段 `calls: [openCardTypeSheet]` 时无条件执行 `ua.calls.split(...)`，抛出 `TypeError: ua.calls.split is not a function`。真实编译已经 PASS；该异常是当前唯一 BLOCKER，完整栈已写入 `coding/reports/script-report.json`。本阶段未修改 framework 或 plan 产物绕过。 | 在 Maison 源仓让 named-handler 同时接受 schema 允许的字符串数组与兼容字符串，再发布/集成新 framework；随后重跑 coding harness。 | 未关闭 |
