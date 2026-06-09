# Goal 模式运行手册（维护者 / agent 参考）

> **宿主入口 SSOT**：[goal-mode/SKILL.md](../../skills/project/goal-mode/SKILL.md)（slash `/goal-mode` 或自然语言「目标模式 / 全自动」；**禁止**要求用户手跑 harness）。
> 裁决 SSOT：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)（`goal_mode` **优先于** `batch_authorized`）

## 概述

`goal-runner` 是 Maison 工具无关的确定性全链路编排器：按 phase DAG 逐阶段 headless 调 agent → 跑 harness → 裁决 → 续行/重试/停止。运行证据落在 `doc/features/<feature>/goal-runs/<run-id>/`。

原生 Claude/Codex `/goal` 仅为可选加速层；闭环裁决以 harness `summary.json` + runner 为准。

## 宿主怎么用（产品面）

| 入口 | 说明 |
|------|------|
| `/goal-mode <feature> [需求]` | Claude slash（路由到 Skill） |
| 自然语言 | 「目标模式 / 全自动 / 无人值守全自动」→ agent 读 goal-mode Skill |
| Codex/Cursor/generic | skills-bridge 跳板（skill id `goal-mode`）→ 完整 Skill |

「全链路 / 从 PRD 到真机」等属于 **batch_authorized**（对话内多 phase），不是 goal 模式触发词。

用户**不**直接执行 `goal-runner`；主 agent 按 Skill 内「Agent 必须执行」自跑。

## 维护者 / CI 调试（非宿主默认路径）

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "需求描述" \
  --adapter claude \
  --dry-run
```

去掉 `--dry-run` 前须确认 `unattended` 契约（manifest 或 adapter `goal_capability.external_runner.unattended`）。

续跑：`--resume <run-id> --feature <feature-slug>`（或 `--manifest <path>`）。

证据：`doc/features/<feature>/goal-runs/<run-id>/manifest.json`、`events.jsonl`、`goal-report.{md,json}`。

## 状态语义

| 最终状态 | 含义 |
|----------|------|
| `COMPLETED` | 全链 PASS，无 DEFERRED |
| `DEFERRED` | 到达 end 但存在外部阻塞未闭环 |
| `PARTIAL` | 中途停止或未到 end 且有 DEFERRED |
| `HALTED` | FAIL 重试耗尽或 policy 拒绝续行 |

**DEFERRED ≠ 完成**：不得宣称 UT/真机已闭环。

## 两级校验

- **check-init**：`goal_capability` 缺失仅 WARN
- **goal-runner preflight**：`goal_capability` + `unattended` + `feature` 缺失为 BLOCKER

## Headless 路径（MVP 硬化）

- Claude：`claude -p` + `--permission-mode dontAsk` / `--allowedTools`（结构化 argv，不经 shell tokenize）
- Codex：`codex exec --sandbox workspace-write --ask-for-approval never|on-request`
