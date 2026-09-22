# ledger-class-failure-containment tasks

- [x] t1 档位读数与回退资格：`repair-candidates.ts` 的 testing 分支删除 `repair_owner === 'spec'|'plan'` 的产候选路径（只读既有 `repair_owner`，不新立表）——账本/形状档因此既不触发 `phase_backtrack_requested`，也不参与回退目标选择；披露（`repair_owner`/`affected_files`/`spec_capture_gap` 归因）原样保留。`resolveInvalidatablePhases` 不动。
- [x] t2 无相关目标的停止出路：`shouldHaltNoProgress` 对 `code_regression` 在相关集合未知/为空时同签名重复即停（`relevantEvidenceKnown` 判据本身不动）；`goal-phase-runtime.ts` 在既有 `no_progress_guard` 分支补「相关目标未知」指引（不新增 halt reason），并把该分支的 halt 补发到既有 `phase_halt` 事件（原先只落 outcome/console，events-only 消费者看不见）。
- [x] t3 模式误用话术：`attended-goal-context.ts` 把非 session owner 的拒绝报成「模式不匹配」并点名 attended 专用参数；session 租约过期原文案保留。`skills/project/goal-mode/SKILL.md`、`skills/reference/goal-mode-operations.md`、`agents/claude/templates/agents/phase-executor.md` 按模式给出可直接执行的 harness 命令与两句边界。
- [x] t4 回归（走生产函数链，不手搓 blocker/summary）：`goal-runner-repair-convergence.unit.test.ts` P3-T14/T15（账本类不回退 / TC-005 断言与半模态几何两个真实候选仍回退并作废既有链后缀）；`goal-headless-guard.unit.test.ts` P3-T11/T12/T13（真实修复仍可继续 / 已知零变化第二次即停 / 未知集合走既有 `no_progress_guard` 且不新增 halt reason）；`attended-goal-context.unit.test.ts` P3-T16 正反例；`framework-init-entry-contract.unit.test.ts` 三处已发布指引文本。
- [ ] t5 宿主验收：在同一 feature `bc-openCard-2/open-card-flow-v2` 重跑 testing，确认账本类失败不触发回退、一档回退不被削弱、无零进展的 `content_retry_exhausted` 收尾、无新 halt reason。
