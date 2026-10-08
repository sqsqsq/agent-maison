## 1. 计划冻结

- [x] 1.1 plan c3f8a2d7 经 codex 两轮评审冻结（§7）；三批实施，记录在 plan §8。

## 2. facts 归属按写边界（批一 t1）

- [x] 2.1 `capability-resolution-entry-input.ts` code owner 分配复用 `resolvePhaseWriteBoundary` / `resolvePhasePathOwnership`；解析失败或实现阶段未解析时不扩大归属。

## 3. 外部能力缺席裁决链（批二 t2）

- [x] 3.1 provider 缺席投影补 `evidence_block_owner: 'capability'`；证据义务门、`p0_coverage_integrity`、`p0_semantic_coverage_integrity` 复用共用投影（空关联集合不放行）。
- [x] 3.2 `testing_run_status` 能力缺席降级；报告 writer 逐 TC 行、功能轴、gaps 与下一步建议。
- [x] 3.3 运行时 defer 分支停放投影（halt 或链尾 continue）与同形 `phase_halt`。

## 4. 返修复看与两处准确性（批一 t3、t4）

- [x] 4.1 `formatRepairLocalDiagnosis` 触发改为 coding + 有候选 + 有效阶段链设备资格，措辞改为执行要求；coding / device-testing Skill 同步。
- [x] 4.2 `lastStopGuidance` 只看最近停止窗口；金丝雀 invoke 失败附 stderr 摘要。

## 5. 连续回放、文档与验证（批二 t5、批三 t6）

- [x] 5.1 goal-runner-testing-integrity 连续回放：失败 → 回 coding → 只剩缺席 → 延迟 → 恢复后重发 → 完成。
- [x] 5.2 `MIGRATION.md`、goal-mode / harness 运维手册、第四轮观察记录；本 change 严格校验。
- [x] 5.3 typecheck 与各批目标套件、plan 扫描、`git diff --check`、LF 复核。
- [x] 5.4 代码冻结后由调度一次运行 `cd harness && npm test` 与受影响 release-only 链路；接手收口采用全量运行加失败项定向复跑，结果见下。

## 归档顺序

本 change 对 goal-runner「The repair window offers local device diagnosis and driver notes without changing identity」以 `effective-budget-completion-and-repair-diagnosis` 的 ADDED 文本为底出 MODIFIED（触发条件与复看措辞；`--repair-notes` 部分不变），归档须晚于该 change。与 `deferred-is-phase-conclusion-and-explicit-resume-attaches` 不修改同一需求（本 change 其余均为 ADDED），归档顺序不受其约束，惯例上按创建顺序在其后。旧 change 正文不改。

## 接手收口记录（2026-10-08）

- 隔离工作树按字节复制本批改动后验证，未追加修改生产逻辑。补齐两处遗漏：real-chain 的 PNG 断言改为 coding 阶段有施工归属、后续阶段为只读输入，保留资源登记、哈希与提示词不变量；device-testing Skill 将重复的返修要求改为引用 coding Skill，正文回到 150 行预算内。
- `npm test` 首轮 typecheck 通过，单测 5164/21（共 5185）。20 条失败来自验证树的依赖目录使用 junction，1 条来自 Skill 正文超预算；改用实体依赖目录并修正文档后，六个受影响套件/子集 78/0，逐条确认原 21 条失败全部覆盖、无遗漏。复用其余通过结果，不重复全量；另补跑 fixtures 46/0。原始命令退出码仍记为 1，不改写成首次全绿。
- release-only：design-authority-repair 38/0；real-chain 首轮 3/1（遗漏的 PNG 旧断言），修正后复跑 4/0；real-chain-seams 10/0 复用首轮；lifecycle-evolution 14/0；reliability-scenarios 44/0。验证树首次缺少未跟踪的空 `harness/framework` 目录导致设计返修夹具准备失败，补齐后才取得上述结果。
- OpenSpec 严格校验 57/0；plan 扫描、diff 检查与 LF 检查通过。日志及摘要保存在仓根 `dist/c3f8-takeover-validation/`，原始失败日志一并保留。
- 宿主 H1、提交、推送、打包与回灌仍按本 change 的既定边界另行安排。
