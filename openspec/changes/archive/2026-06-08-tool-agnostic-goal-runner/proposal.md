# Proposal: 工具无关 Goal Runner（收敛 MVP + 运行证据层）

## Why

AgentMaison 的阶段化工作流（PRD→design→coding→review→UT→testing）已有 harness 门禁与 Skill 指导，但阶段间默认 `manual` 推进，无法把「一个需求从头做到尾」交给任意 agent 工具无人值守执行。Claude Code / Codex 虽有原生 `/goal`，但不可移植；需要 Maison 自身的确定性编排器作为 SSOT，原生 goal 仅作可选加速。

## What Changes

- 新增 `goal-runner.ts` 确定性外层编排器：按 workflow DAG 逐 phase 调 agent（fresh context）→ harness 门禁 → 裁决 → 续行/重试/停止
- 新增 `goal-manifest` 契约、`goal-runs/<run-id>/` 运行证据层（manifest、events、每 phase 产物、最终 report）
- 扩展 `phase-transition-policy.ts`：`resolveAutoChain`、`classifyPhaseVerdict`（INCOMPLETE→DEFERRED 续行，禁 completed 伪装）
- 扩展 `workflow-schema.json` / `workflow-loader`：`transition_policy`、`auto_chain`
- 扩展 `adapter-schema.yaml`：`goal_capability`（optional）；check-init WARN、goal-runner preflight BLOCKER
- 各 adapter 填 `goal_capability` metadata；新增 `goal-orchestration` 薄入口 Skill
- 第一版 headless 硬化 `claude -p` 与 `codex exec`；不改 Stop hook

## Capabilities

### New Capabilities

- `goal-runner`: 工具无关全链路编排、运行证据层、裁决与 DEFERRED 语义
- `goal-orchestration-skill`: 薄入口 Skill，指导调用 goal-runner

### Modified Capabilities

- `agent-adapters`: 新增 optional `goal_capability` 字段与两级校验
- `harness-gates`: workflow manifest 扩展 `transition_policy` / `auto_chain`；phase-transition goal_mode 实现

## Impact

- Affected: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/utils/agent-invoke.ts`, `workflows/`, `specs/workflow-schema.json`, `agents/`, `skills/project/goal-orchestration/`, `docs/operations/goal-mode-runbook.md`
- Consumer: 可选使用 `goal-runner`；默认 `manual` 行为不变
