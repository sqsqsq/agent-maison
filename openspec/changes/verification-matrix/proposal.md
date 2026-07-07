# Proposal: Verification Matrix — 证据档位收敛

## Why

现状每个 feature phase 固定 4 重闭环凭证（trace + 脚本门禁 + LLM verifier + receipt），按"内网弱模型会说谎"设防；对交互态强模型是固定 token 税（verifier 子 agent 每阶段重读全上下文）。证据应按风险叠加，而非所有阶段的固定税——但降档必须机器可判、headless 恒不降档、防作弊红线恒开。

## What Changes

- `framework.config.json` 增顶层可选 `evidence_profile: strict|balanced`（缺省 strict = 现状零变化；`minimal` 为 lite track 的 resolved 档，不可全局声明）
- headless / goal-runner 运行时强制 resolve 为 strict（实现在 C0 `resolveEvidencePolicy`，不靠 skill 文本自觉）
- 证据矩阵（SSOT，唯一消费入口 = C0）：full×strict 全现状；full×balanced 仅 {spec, coding} 保留 verifier（可 config 覆写）、receipt 保留、trace 降 opt-in；lite resolved=minimal——exit 一次脚本门禁、无 per-phase receipt/verifier
- check-receipt 五个硬必需块（verifier :333 / invoked_via :341 / trace :365 / context_exploration :402 / self_check :551）改按 policy 分派；lite feature 返回显式 `not_applicable`（exit 0 + 机读标注）
- **机读契约两层分离**：policy 档（C0 输出）`required|optional|off|not_applicable`；校验层 `validation_status: provided|missing|skipped_by_policy|not_applicable`——receipt frontmatter 与 `.current-phase.json` 的 `evidence_policy_snapshot` 记两栏
- closure 来源按 policy 分派：full = receipt passed；lite = exit 报告 PASS + checkbox 全勾（not_applicable 不映射为 receipt-passed，Resume Gate 三态显式）
- 不降档红线机器可查清单（integrity / 伪签验真链 / diff_within_scope / goal 凭证链）由单测锁死

## Impact

- Affected specs: runtime-policy、harness-gates
- Affected code: `templates/framework.config.template.json`、`specs/framework.config.schema.json`、`harness/scripts/utils/runtime-policy.ts`、`harness/scripts/check-receipt.ts`、`harness/templates/phase-completion-receipt.md`、`harness/harness-runner.ts`（closure :664 / next_step :776）、`agents/claude/templates/hooks/*`
- 兼容不变式：缺省 strict → 现有行为与夹具零回归；旧 state 无快照按 full+strict 解释
