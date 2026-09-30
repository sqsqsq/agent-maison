# rule-subtraction-second-classification tasks

- [x] t1 去向表追加四条 `ledger_shape`（`harness/scripts/utils/check-disposition.ts`），每条带依据、后果与入口边界；不登记与暂缓的六条保持现状。
- [x] t2 公开入口验证：review 真实 CLI（文件数、decisions），goal 真实链路 RC-8c / RC-8d（plan 缺节、空节）；RC-8a/8b 失败载体换为 `contract_file_reference_closure`，原断言不变；四条逐条反向变异。
- [x] t3 指引与迁移说明同步：`agents-entry-detail.md`、`device-testing/SKILL.md`、`MIGRATION.md` 3.1.0 第二批条目。

## 归档顺序

本变更须排在 `check-disposition-single-verdict` 之后归档：本变更 harness-gates 的 ADDED 需求以该变更建立的处置函数、去向表与
`disclosed_failures` 为前提（其 ADDED「The first classification registers one result-basis gate and six ledger checks」先入主规范）。
feature-artifact-layout 的 MODIFIED 以当前主规范原文为底，其它在研变更未修改这条需求，无交叠。
