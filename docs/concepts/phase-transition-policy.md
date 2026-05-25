# 阶段边界推进策略（Phase Transition Policy）

> **SSOT（对话 UX）**：[user-confirmation-ux.md §8](../../skills/reference/user-confirmation-ux.md)  
> **SSOT（batch 解析）**：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)

Harness **不是**开发流水线；阶段四件套 PASS 只证明**当前 phase 完成**，不授权下一 Skill。

## 策略枚举

| `transition_policy` | 含义 | 典型来源 |
|---------------------|------|----------|
| `manual` | **默认**。闭环后须 `phase.next_step` 或 `*.ok_to_*` 停等 | 无 batch / goal 声明 |
| `batch_authorized` | 用户一条指令声明多阶段范围 | 「coding 并 review」「全链路交付」 |
| `goal_mode` | **预留**。adapter / workflow manifest 注入 unattended pipeline | Claude Code / Codex goal 模式（未实现） |

## 预留：workflow manifest（未实现）

以下字段为 **goal 模式** 预留，当前 harness **不读取**；adapter 实现后应复用同一套 registry id（`phase.next_step`、`coding.ok_to_review` 等），无需改 Skill 正文：

```yaml
# future (spec-driven.workflow.yaml or adapter session manifest):
# transition_policy: goal_mode | batch_authorized | manual
# auto_chain: [prd, design, coding, review, ut, testing]
```

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
- `prd.freeze` / 上游闭环 alone 当作下游授权（除非 `batch_authorized`）
