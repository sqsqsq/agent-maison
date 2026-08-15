# Tasks

- [x] gate 减法：`requirement_ref` 收窄为 `{source_path,snippet}`，`snippet_sha256` 退役（存量忽略）；报错/建议文案同步（`p0-semantic-gates.ts`）
- [x] 骨架归责：新增 `receipt-scaffold.ts`（runner-owned 身份字段预填 + force 重建语义）；`harness-runner.ts` PASS 骨架改走共享实现；`goal-runner.ts` closure-only invoke 前重建骨架；模板与 `check-receipt.ts` 文案对齐
- [x] 单测：存量失配 `snippet_sha256` 被忽略（默认 PASS 用例钉住）+ 无该字段 PASS + 引文伪造仍 FAIL（`p0-semantic-gates.unit.test.ts`）；骨架预填/幂等/force 作废旧回执/非 goal 留空（`receipt-slim.unit.test.ts`）
- [x] OpenSpec：harness-gates MODIFIED + goal-runner ADDED（本 change）
