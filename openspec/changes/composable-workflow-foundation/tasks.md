## 1. 规范对齐

- [x] 1.1 建立 composable-workflow-foundation，记录 g1 范围和子 plan 交接责任。
- [x] 1.2 完成六份现行规范的 requirement delta 并同步，保留旧协议边界、真实输入与分层完成。
- [x] 1.3 修订父 goal §8/§9 的固定阶段及无条件 plan 产物口径，不改已定稿 plan 正文。

## 2. 验证与收口

- [x] 2.1 运行 npm run openspec:validate，核对 delta/现行规范一致性和相关 diff/LF。
- [x] 2.2 完成 g1 todo 状态更新并运行 node scripts/check-plan-version.mjs，报告修改文件与后续交接。

本次不涉及 runtime SSOT 或发布件。按总纲 §11，harness 测试、MIGRATION.md 更新及发布前 mandatory `npm run release:verify` 由对应实现/发布批次执行，不计入 g1 待办或本次通过声明。未调用 openspec update，无需重打生成器补丁。

验收记录（2026-09-11）：`npm run openspec:validate` 为 38 passed / 0 failed，enforcement 路径校验 PASS；21 个 requirement delta 与六份现行规范逐块一致；18 个本次修改/新增文件均为 LF；`git diff --check` 和 `node scripts/check-plan-version.mjs` PASS。未修改发布件、P1–P7 plan 正文/状态或历史归档。本 change 暂不归档。
