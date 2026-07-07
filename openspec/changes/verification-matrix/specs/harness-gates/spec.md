# Delta: Harness Gates — receipt/closure policy 化

## ADDED Requirements

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；lite feature MUST 整体返回 exit 0 + 顶层 `not_applicable` 机读标注。

#### Scenario: balanced 下 verifier off 的 receipt 通过
- **WHEN** full×balanced 的 review phase receipt 无 verifier 节
- **THEN** check-receipt 记 verifier=skipped_by_policy 且 exit 0

#### Scenario: strict 行为不变
- **WHEN** 缺省 strict 下 receipt 缺 verifier verdict
- **THEN** BLOCKER FAIL（与现状一致）

> **Enforced by:** `harness/scripts/check-receipt.ts`

### Requirement: Two-layer evidence snapshot

receipt frontmatter 与 `.current-phase.json` MUST 记录 `evidence_policy_snapshot`，每凭证项含两栏：policy 档（`required|optional|off|not_applicable`）与 `validation_status`（`provided|missing|skipped_by_policy|not_applicable`）。快照 MUST 带 `policy_schema_version` 并与 C0 fail-safe 语义共用 schema。

#### Scenario: receipt 保留但 trace opt-in 关闭可稳定校验
- **WHEN** full×balanced 的 receipt 声明 trace policy=optional、validation_status=missing
- **THEN** 校验通过且组合判据机读可查，不依赖散文 N/A

> **Enforced by:** `harness/scripts/check-receipt.ts`, `harness/harness-runner.ts`

### Requirement: Closure source dispatches by policy

closure MUST 按 policy 分派三态：full = receipt `passed`；lite = exit 报告 PASS + change.md checkbox 全勾（`closed_by_exit_report`）；`not_applicable` MUST NOT 映射为 receipt-passed。Resume Gate 对 not_applicable MUST 走 lite 闭环判据。

#### Scenario: lite feature 跨会话续跑不误判
- **WHEN** 新会话对已完成 lite feature 跑 Resume Gate（check-receipt 返回 not_applicable）
- **THEN** 闭环判定读 exit 报告 + checkbox，而非要求 receipt

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `agents/claude/templates/hooks/check-phase-completion.mjs`
