# Tasks — resume revalidate before reinvoke（plan b5f1d9c3 t1/t2/t3）

## 1. t1 resume 验证优先

- [x] 1.1 `deriveHaltValidationOnlyEligibility`（goal-runner.ts，与 applyInvalidationsToResume 同文件）：判据 = 最新 phase_halt.run_disposition === 'WAITING' ∧ 最新执行事件是有效 settled（带 invoke_id、非 timed_out/kill）∧ 同 invoke 后已有 harness_end ∧ settled 后无更新执行事件；**禁止用 INCIDENT_REGISTRY.class / halt_reason 再分类**
- [x] 1.2 装载点并入（applyInvalidationsToResume 之后）：派生结果进 resumePostAgentPhases + resumePostAgentAttemptIds（复用原 settle invoke_id 身份）；invalidation 已覆盖的 phase 不再重复派生
- [x] 1.3 反例矩阵 7 条 + 边界（纯函数层，一律只断言"不进入 resumePostAgentPhases"）
- [x] 1.4 既有契约不回归：非 WAITING 投影/缺投影/窗口不完整 = 只是不派生资格；checkTerminalResumeGuard cooldown/--force-resume 一字不动；零新事件/状态/账本

## 2. t2 一条聚焦回归（1c95e3 事件序列）

- [x] 2.1 集成测试（goal-runner-testing-integrity）：settled → harness_end → phase_halt(WAITING) → run_end → --resume → 无新 agent_invoke_start → 复用原 invoke identity → 恰好一次 gate harness → PASS 收工
- [x] 2.2 不新增 golden 产物、不扩 golden-bc-opencard、不需真机；不重复既有覆盖（M2-1/M2-3b/M2-3c/R-8）

## 3. t3 delta 与收口

- [x] 3.1 OpenSpec delta（specs/goal-runner/spec.md）：ADDED「WAITING-projected halts revalidate before re-invoking the agent」——SHALL 消费 run_disposition 投影与事件形状、SHALL NOT 按 halt_reason/incident class 再分类、本 change SHALL NOT 为非 WAITING 投影派生 validation-only eligibility
- [x] 3.2 收口：typecheck + `cd harness && npm test` + `openspec validate --strict`