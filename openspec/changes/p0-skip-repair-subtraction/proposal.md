# p0-skip-repair-subtraction

> Supersession note (2026-08-26): `autonomous-recovery-without-human-gates` retains this change's P0 repair routing and supersedes its waiver/generic human-release clauses. The delta specs have been reconciled accordingly; the pending host replay remains pending.

## Why

宿主实锤（SimulatedWalletForHmos / bc-openCard，run `20260818T035420Z-f555c2`）：testing 已完成真机执行并产出 FAIL，summary 同时存在 3 个可信 coding 类 `repair_candidates`，assess 也已推荐 `rerun_phase:coding` / `backtrack_to_phase`，但 goal-runner 先被专用 `await_human_p0_skip` 分支截获写死 halt，最终落 WAITING / human。根因不是缺少回退能力，而是把「agent 不能自行签发 P0 skip waiver」错误扩大成「agent 不能选择修复」，并让专用人工 halt 抢在既有 `repair_candidates → assess → backtrack_to_phase` 通路之前执行。同期还有一条 testing 自相矛盾：goal 路径恒带 `--skip-assert-expected`，`report_trace_reconciliation` 要求报告逐条复写 trace 的「通过」，`pass_rate_calculated` 却禁止报告出现任何「通过」——agent 无法写出同时满足两条 BLOCKER 的诚实报告。

## What Changes

- **P0 未豁免 skip 默认修复（简单优先，fail-closed 不变）**：`p0_coverage_integrity` 保留 BLOCKER FAIL/全分母；gate 分别计算既有 `explicit_skip_tc_ids` 登记、trace 明确 skip、status 为空三组。本轮未豁免缺口**全部属于 explicit skip 集合**时才复用既有 `failure_kind=code_regression` + `actionability=agent_fixable`；testing summary writer 消费该机器合取（id + FAIL + code_regression）产普通 `RepairCandidate(category=coding)`，经 assess 唯一 `backtrack_to_phase` 回 coding。status 为空或未经登记的 trace skip 不产 coding 候选（留 testing 修复）；外部条件继续由既有 envBlocked / DEFERRED 优先处置；有效 `p0_skip_waiver` 仍走 WARN + AWAITING_HUMAN_REVIEW（降低标准只能真人授权）。
- **删除 `await_human_p0_skip` 主动路由**：goal-runner 首触 halt/专用 guidance、failure classifier 的专用 kind 与 cumulative/人类专属分类扩散全部移除；adjudication 仅保留历史事件只读解释。决策顺序冻结：完整性/越权/硬预算等安全终止优先 → 可信 repair_candidates 优先回责任阶段 → 零候选且 blocker 全 human_only 才走通用 `await_human_gate_deferral`。复用既有回退预算、整轮指纹、失效事务与 `backtrack_target_absent`，不新增 resume/supersede/supervisor 或第二个 driver。
- **report_validity 收窄**：只抑制依赖报告自由文本的 review 候选；机器 check / verifier 合取候选（含 `p0_coverage_integrity`）不得因产品负面结论被整体清空——负面结论恰恰是回修候选最需要存活的时刻。
- **P0 优先级对齐锚**：`acceptance_to_test_case` 复用既有 `parsePlanTcEntries`，要求每个 device/both 的 P0 AC 至少被一条 priority=P0 的 TC 引用；TC P0→P2 降档不得令其退出 P0 分母并假绿。不新立 check id/failure kind/candidate。
- **弱化旗标报告口径**：`pass_rate_calculated` 将「表里出现 trace 合法状态'通过'即 FAIL」原位替换为「命令含弱化旗标且报告结论='达标'即 FAIL」（复用既有结论解析器）；trace 状态表继续逐条投影、`report_trace_reconciliation` 保持严格。不新增第五状态、第二张表或验收分子 sidecar。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-gates`：P0 skip 语义（explicit-only → code_regression 默认修复；`await_human_p0_skip` halt 退役）、P0 优先级对齐锚（`acceptance_to_test_case` 原地断言）、弱化旗标结论规则（`pass_rate_calculated`）、report_validity 职责边界（只约束报告派生候选）。
- `goal-runner`：决策梯删除 P0 专用求人特例，P0 修复事实走统一候选路由。

## Impact

- 影响 runtime：`harness/scripts/utils/p0-semantic-gates.ts`（三组分别计算 + explicit-only 合取写 code_regression）、`harness/scripts/utils/repair-candidates.ts`（testing P0 生产点 + report_validity 收窄；不注册整个 check）、`harness/scripts/check-testing.ts`（P0 优先级对齐 + 结论=达标规则）、`harness/scripts/goal-runner.ts`（删专用 guard）、`harness/scripts/utils/goal-failure-classifier.ts`（删专用 kind/家族/分类）、`harness/scripts/utils/adjudication.ts`（只读兼容）。
- 影响规格/文档：`specs/phase-rules/testing-rules.yaml`、`skills/reference/device-testing-workflow-detail.md`、`docs/operations/goal-mode-runbook.md`。
- 不修改宿主产品代码、不新增/复制/脱敏落盘 `bc-openCard-1` fixture、不自动替操作者确认清理、`--force-resume` 只确认旧版进程清理不构成 `p0_skip_waiver`。
