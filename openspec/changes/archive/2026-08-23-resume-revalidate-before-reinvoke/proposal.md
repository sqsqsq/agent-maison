## Why

2026-08-22/08-23 宿主 run 1c95e3 实锤：testing 阶段 `repair_adjudication_pending` 停等后 `--resume` **无条件重调 agent**，白烧 51 分钟——实际只需 gate harness 一轮（2m41s）即 PASS：resume 通过的真实原因不是 agent 干了什么，也**未发生 visual-confirm 人签**（三屏 confirmed_by 全 undefined），而是新框架下那 3 条假 uncertain 信号在 producer 侧不再产生；i3 产物本就三屏 pass / must_fix 0。agent 那 51 分钟做了 4 轮真机、2 次 verifier、重写 test-report，重新推导出同一结论。

根因：`resolveResumeState` 在 halted 时把 phase 退回并丢弃 outcome，主循环无条件重调 agent；而"跳过 invoke 直接走验证边界"的机器（`resumePostAgentPhases`）**已存在**（goal-runner.ts 装载/消费，`retries===0` 且消费即删），只覆盖 backtrack 崩溃窗口。本 change 只做两件事：**resume 验证优先**（停等后若事件窗口证明 agent 已完成、只差验证，则跳过重新 invoke、直接进 gate harness 重验）与**一条聚焦的 1c95e3 事件序列回归**。归因经本侧独立核验 + codex 三轮复盘交叉一致；预期省约 48 分钟（约 27%）。review/ut 交付物体量、goal 模式单一 harness owner、M3 设备 execute/validate 分离各自另立，不叠进本 change。

## What Changes

- **资格判据 = 既有 `run_disposition` 投影 + 事件形状**，禁止用 `INCIDENT_REGISTRY.class` 或对 halt_reason 的再分类：最新 `phase_halt.run_disposition === 'WAITING'` ∧ 该 phase 最新执行事件是**有效 `agent_process_settled`**（带 `invoke_id`、非 `timed_out`/`kill_reason='agent_timeout'`）∧ 同一 invoke 之后已有 `harness_end` ∧ halt 位于其后的 harness 之后 ∧ 其后无更新的 `agent_invoke_start`/`agent_process_settled`/`phase_verdict` ∧ **halt 之后无更新的 `phase_backtrack_requested`/`phase_invalidated`**（新回退/失效窗口优先，资格完全交回既有 invalidation 回放）。
- **边界严格限定**：本 change 只决定"是否派生 validation-only 资格"；非 `WAITING` 投影、缺投影、窗口不完整一律只是"不从该 halt 派生资格"——后续完全由既有 resume/invalidation 路径决定（不承诺一定重新 invoke agent）；既有终态语义与人工 `--resume` 契约（含 `checkTerminalResumeGuard` cooldown / `--force-resume`）**原样不动**。
- **零新机制**：不新增事件类型、状态机、账本、receipt；复用既有 `resumePostAgentPhases` 机器（其 postAgentAttemptIds 复用原 settled invoke_id 身份）。
- **行为**：取得资格则 resume 直接进 gate harness → PASS 走既有唯一 closure owner 收工；gate FAIL 或仍 pending → 落回既有路径（调 agent 重试 / 原样快速再停等）。
- **t2 一条聚焦回归**（测试资产，不产 delta）：1c95e3 事件序列 `settled → harness_end → phase_halt(WAITING) → run_end` → `--resume` → 无新 `agent_invoke_start` → 复用原 invoke identity → 恰好一次 gate harness → PASS 收工。不扩 golden、不需真机、不重复既有覆盖（《添加银行卡/structured payload 落盘 → adjudicated-repair-loop；pending 不关环 → M2-1；人签正反例 → M2-3b/M2-3c；one-shot/no-op → R-8）。

## Capabilities

### New Capabilities

无（复用既有 `phase_halt` / `resumePostAgentPhases` / `run_disposition` 投影通道，不新增停止机制、状态机、事件类型与账本）。

### Modified Capabilities

- `goal-runner`：resume 对 WAITING 投影停等先重验（validation-only 资格派生）、不无条件重调 agent；`resumePostAgentPhases` 从仅 backtrack 窗口扩展为含普通 phase_halt 窗口；非 WAITING 投影/缺投影/窗口不完整一律不派生。

## Impact

- 代码：`harness/scripts/goal-runner.ts`（新增纯函数 `deriveHaltValidationOnlyEligibility` + resume 装载点并入）。
- 测试：`goal-runner-repair-convergence`（+13 纯函数用例）、`goal-runner-testing-integrity`（+1 集成回归）。
- 行为：WAITING 停等后 resume 若事件窗口证明 agent 已完成、只差验证 → 跳过重新 invoke、直接进 gate harness；PASS 收工或原样快速再停等。
- 消费者迁移：无（零新事件类型/字段；既有 resume 契约否定面不动）。

## Migration

无（零新事件/状态/账本；不改变既有 resume 契约的否定面）。