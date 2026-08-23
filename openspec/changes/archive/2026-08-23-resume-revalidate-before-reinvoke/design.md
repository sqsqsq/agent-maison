# Design — resume revalidate before reinvoke（plan b5f1d9c3 t1）

## 1. 背景与根因链

run 1c95e3（候选包 ee13bbf = 6c5b100 + d6afee4 closure 修复 + OCR 聚合行修复）两段合计 2h58m，
agent 占 96.6%。其中 resume 段 51 分钟是**纯废**：新框架下 3 条假 uncertain 不再产生、i3 产物
本已三屏 pass / must_fix 0，重验即 PASS（gate harness 实测 2m41s）。根因 = `resolveResumeState`
（goal-runner-phase.ts:902）在 `last.halted` 时把 startIndex 退回该 phase 并丢弃 outcome，主循环
随即重新 `agent_invoke_start`。

而"跳过 invoke、直接走验证边界"的机器**已存在**：`resumePostAgentPhases`（goal-runner.ts 装载 /
消费，`retries===0` 且消费即删）——只由 `applyInvalidationsToResume` 从 backtrack/invalidated
事件派生，普通 `phase_halt` 不覆盖。

## 2. 资格判据（只消费既有投影 + 事件形状）

最新一条 `phase_halt` 事件（events.jsonl append 序）：

1. `run_disposition === 'WAITING'`（字段在场；RECOVERY_PENDING/TERMINAL/缺字段 → 不派生）；
2. halt phase 的最新执行事件（`agent_invoke_start`/`agent_process_settled`/`phase_verdict` 倒序
   首条）是**有效 settled**——带非空 `invoke_id`、`timed_out !== true`、
   `kill_reason !== 'agent_timeout'`；
3. 同一 `invoke_id` 之后、halt 之前已有 `harness_end`（agent 退出后 gate harness 已跑过）；
4. 该 settled 之后该 phase 无更新的执行事件（避免旧 settled 误判）。

**禁止**用 `INCIDENT_REGISTRY.class`（class 表达责任归属而非"agent 是否已完成"；operator 类含
8 条 `structurally_terminal`，按 class 切分会把结构终态纳入重验资格）。**不做第二张分类表**：
仓库明令下游只读 `run_disposition` 投影、不得按 halt_reason 再分类。

## 3. 边界（严格限定）

- 本 change 只决定"是否派生 validation-only 资格"；非 `WAITING` 投影、缺投影、窗口不完整
  一律只是"不从这个 halt 派生资格"——后续完全由既有 resume/invalidation 路径决定
  （新窗口的 settled 仍可能由 applyInvalidationsToResume 独立派生资格，不承诺一定重新 invoke）。
- `TERMINAL`/`RECOVERY_PENDING` 投影的终态语义与人工 `--resume` 契约
  （`checkTerminalResumeGuard` cooldown / `--force-resume`）**一字不动**。
- 不新增事件类型、状态机、账本、receipt。

## 4. 实现（复用既有机器）

- 新纯函数 `deriveHaltValidationOnlyEligibility(events)` → `{ phase, invoke_id } | null`，
  与 `applyInvalidationsToResume` 同文件（goal-runner.ts）。
- resume 装载点（`applyInvalidationsToResume` 之后）：返回非 null 且该 phase 尚未被 invalidation
  窗口覆盖时，`resumePostAgentPhases.add(phase)` +
  `resumePostAgentAttemptIds[phase] = invoke_id`（复用原 settled invoke 身份）。
- 消费点零改动：主循环 `resumePostAgent`（`retries===0` 且消费即删）→ 跳过 agent invoke、
  伪造 invoke 结果（exitCode 0）、仍走 gate harness；PASS 走既有唯一 closure owner 收工；
  gate FAIL / 仍 pending → 落回既有路径。

## 5. 反例矩阵（7 条，一律只断言"不进入 resumePostAgentPhases"）

| # | 反例 | 原因 |
|---|------|------|
| ① | settled 之后出现 FAIL `phase_verdict` | 已判定失败，正常恢复 |
| ② | settled 之后出现更新的 `agent_invoke_start` | 最新工作是新的，非完成态 |
| ③ | settled 带 timeout/kill（`timed_out`/`kill_reason='agent_timeout'`） | 超时半成品，须重新 invoke |
| ④ | settled 缺 `invoke_id` | 身份不完整，不可复用 |
| ⑤ | halt 缺 `run_disposition` 投影 | 投影缺席，fail-closed |
| ⑥ | halt 投影为 `TERMINAL`/`RECOVERY_PENDING` | 终态语义本 change 不动 |
| ⑦ | halt 之后出现更新的 `phase_backtrack_requested`/`phase_invalidated` | 新回退/失效窗口优先，资格交回既有 invalidation 回放 |

## 6. 测试

- **t1 纯函数**（goal-runner-repair-convergence）：正例 1 + 反例 7 + 边界 5（缺 harness_end /
  不同 invoke 的 harness_end / 最新执行事件是 invoke_start / 无 halt / halt phase 无执行事件）。
- **t2 集成**（goal-runner-testing-integrity）：1c95e3 事件序列回归——首 run 产 uncertain →
  halt `repair_adjudication_pending`（WAITING/human）→ **无人签**（1c95e3 真实事实：confirmed_by
  全 undefined）→ events 插入同 invoke 的 `agent_process_settled`（win32 语义模拟；测试宿主非
  win32 不自动 emit）→ resume（cooldown 回拨 10 分钟 + `--force-resume`，人工 resume 契约一字
  不动）→ 第二次 gate 产 clean（框架升级后 producer 不再产 uncertain）→ 断言：无新 testing
  `agent_invoke_start`、gate harness 恰好一次且复用原 invoke_id、**无人签** PASS 收工。
- **不重复既有覆盖**：M2-1 uncertain 判停、M2-3b/3c 人签正反例、R-8 one-shot/no-op。

## 7. 收益预期

t1 省约 48 分钟（约 27%）；不得宣称把 3 小时压到 20 分钟——review/ut 的 59 分钟与 goal 模式
单一 owner 各自另立解决。