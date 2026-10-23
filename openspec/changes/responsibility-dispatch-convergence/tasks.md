## 1. 保全与减法

- [x] 1.1 保全 179a73 原件、来源哈希和 i6 入场前生产回放。
- [x] 1.2 删除 lite 专用能力及共享分支，保留非 lite spec-driven，更新 MIGRATION.md 与当前入口。

## 2. 同源责任与恢复

- [x] 2.1 集中原始责任契约和 resolveRepairResponsibility，区分 owner、三角色、授权、能力与五类动作。
- [x] 2.2 落地 coding 有限测试兼容契约及唯一 coding_existing_test_preserved 检查。
- [x] 2.3 将 verification 候选、writer/finalizer、写界、assess/runtime、范围修订和完成接到同源责任，保持真实依赖与拒修预算。
- [x] 2.4 承接原 facts 建立者、合法历史写入、真实 UT 当前哈希采纳及本阶段快照 delta。
- [x] 2.5 提供可修问题单反馈和准确最终责任指导，对齐 Skill 与规范。

## 3. 开发验收

- [x] 3.1 目标单元、179a73 生产回放、两两组合及关键生产反向变异通过。
- [x] 3.2 统一执行 cd harness && npm test、全部受影响 release-only 分片、OpenSpec/plan/LF 校验。
- [x] 3.3 实际 Claude Code CLI 统一检视并由指定开发者修复。

本轮用户明确禁止打包；后续获准发版时 `npm run release:verify` 仍为必需既有门禁，本 change 不用发版动作充当开发验收。联合宿主观察仍由 plan t8 独立保持 pending；不归档 change、不提交、不改版本。
