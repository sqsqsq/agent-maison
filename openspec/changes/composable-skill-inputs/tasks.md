## 1. 输入契约

- [x] 1.1 冻结 docs/concepts/skill-contracts.md 输入矩阵与迁移责任。
- [x] 1.2 实现 contract 1.1、类型化内容与 InputBinding、入口桥接和缺失/冲突语义。

## 2. 同源消费

- [x] 2.1 接通 SpecLoader/CheckContext、verifier 内容与材料、evidence/候选面，保留 1.0 兼容。
- [x] 2.2 接通 facts 1.1 首阶段/request/继承、所有 facts checker 参数及 checkpoint 路径，更新 Research 文案。

## 3. 校验

- [x] 3.1 静态 producer/类型闭包、schema/parser 版本边界与真实 checker 的定向测试。
- [x] 3.2 运行 npm run openspec:validate、cd harness && npm test、plan 与 diff/LF 校验，按结果更新 P1 todo。

按总纲 §11，本次不发布；正式发版 mandatory `npm run release:verify` 由发布批次执行。默认切换及 MIGRATION.md 由 P7 负责。未调用 openspec update，不需要重打生成器补丁。

验收记录（2026-09-11）：最终冻结代码的 `cd harness && npm test` 退出码 0，typecheck PASS、单测 4391 passed / 0 failed、fixtures 46 passed / 0 failed。日志：`harness/reports/p1-harness-validation.log`（开发运行报告，不进发布件）。OpenSpec 严格校验 39 passed / 0 failed，enforcement 路径校验 PASS；plan、diff 与 LF 校验 PASS。P1 四项 todo 完成，计划正文未改，P2–P7 状态未变。

局部返修（2026-09-11，两条替代意见）：facts evidence 复用基线与本阶段增量指纹，后续无关追加保持 fresh，已消费内容变化仍 stale；baseline.dependencies 与 resolved inputs 共用发布前 exists/sha256 核验，来源变化或删除拒绝发布。普通/staged 新鲜度及 manifest、verifier-material、closure 发布入口定向测试 63/63、typecheck 和 OpenSpec 39/39 通过；冻结后完整 `npm test` 退出码 0，4394 单测、46 fixtures 全通过（`harness/reports/p1-facts-repair-validation.log`）。未新增 ut_layer 重复校验，未扩面到 P2–P7；P1 本轮收口。
