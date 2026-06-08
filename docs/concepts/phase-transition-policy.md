# 阶段边界推进策略（Phase Transition Policy）

> **SSOT（对话 UX）**：[user-confirmation-ux.md §8](../../skills/reference/user-confirmation-ux.md)  
> **SSOT（batch / goal 解析）**：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)  
> **运行手册**：[goal-mode-runbook.md](../operations/goal-mode-runbook.md)

Harness **不是**开发流水线；阶段四件套 PASS 只证明**当前 phase 完成**，不授权下一 Skill（`manual` 默认）。

## 策略枚举

| `transition_policy` | 含义 | 典型来源 |
|---------------------|------|----------|
| `manual` | **默认**。闭环后须 `phase.next_step` 或 `*.ok_to_*` 停等 | 无 batch / goal 声明 |
| `batch_authorized` | 用户一条指令声明多阶段范围 | 「coding 并 review」「全链路交付」 |
| `goal_mode` | `goal-runner` 确定性编排 | `goal-runner.ts` + manifest |

## workflow manifest 字段

[`spec-driven.workflow.yaml`](../../workflows/spec-driven.workflow.yaml) 已支持：

```yaml
transition_policy: manual
auto_chain: [prd, design, coding, review, ut, testing]
```

`auto_chain` 可省略；`goal-runner` 从 DAG 推导，manifest `chain_override` 可覆盖。

## goal_mode 裁决（DEFERRED）

- `PASS` → 进入下一 phase
- `FAIL` → 重试（未超预算）或 `HALTED`
- `INCOMPLETE`（可 defer 的外部阻塞）→ 标 **DEFERRED**，按 `dependency_policy` 决定是否续行；**禁止** completed 伪装

下游 phase prompt 须携带 upstream DEFERRED 清单。详见 [goal-mode-runbook.md](../operations/goal-mode-runbook.md)。

## 相关 registry id

| id | 边界 |
|----|------|
| `phase.next_step` | 任一 feature phase 闭环后（通用） |
| `design.ok_to_code` | design → coding |
| `coding.ok_to_review` | coding → review |
| `review.ok_to_ut` | review → UT |
| `ut.ok_to_testing` | UT → testing |

## 反模式

- 读完 `phase-completion-receipt.md` 后在同一执行流自动 Read 下一 Skill
- 把「可进入 Skill N」当成「现在就进入 Skill N」
- `prd.freeze` / 上游闭环 alone 当作下游授权（除非 `batch_authorized` 或 `goal_mode` manifest）
- 将 INCOMPLETE / DEFERRED 软通过为 PASS 或 completed
