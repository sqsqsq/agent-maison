# 阶段边界推进策略（Phase Transition Policy）

> **SSOT（对话 UX）**：[user-confirmation-ux.md §8](../../skills/reference/user-confirmation-ux.md)  
> **SSOT（batch / goal 解析）**：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)  
> **调和 SSOT**：[skill-contracts.md](./skill-contracts.md) + [reconcile-loop.md](./reconcile-loop.md)
> **运行手册**：[goal-mode-runbook.md](../operations/goal-mode-runbook.md)

Harness **不是**开发流水线；阶段闭环（closed）只证明**当前 phase 完成**，不授权下一 Skill（`manual` 默认）。

## 策略枚举

| `transition_policy` | 含义 | 典型来源 |
|---------------------|------|----------|
| `manual` | 独立请求到本次终点；推进需已有范围授权或相应确认，不重复询问已有授权 | 无 batch / goal 声明 |
| `batch_authorized` | 用户一条指令声明多阶段范围 | 「coding 并 review」「全链路交付」 |
| `goal_mode` | `goal-runner` 确定性编排 | `goal-runner.ts` + manifest |

## workflow manifest 字段

[`obligation-driven.workflow.yaml`](../../workflows/obligation-driven.workflow.yaml) 已支持：

```yaml
transition_policy: manual
auto_chain: [spec, plan, coding, review, ut, testing]
```

现代 workflow 的 auto_chain 仅是候选排序；实际执行由 P2 execution_scope 决定，chain_override/start/end 必须同值投影。已有有效信息不自动安排生产阶段，unknown 不当作不适用。旧 spec-driven run 仍按冻结旧链恢复。

## goal_mode：推荐与授权分离

goal driver 不再维护独立的 verdict→next-phase 表。每个 phase 边界统一执行：

1. `assess@1` 从 summary 1.2、closure、evidence freshness 与 `ReconcileObservation@1` 推荐工作；
2. driver 校验授权、预算、fencing、device、trust、write guard 等硬门禁；
3. 只执行一个推荐 phase；
4. 重跑 assess。

通常 PASS+closed 会使 assess 推荐下一个 gap，FAIL 推荐同 phase，可信 testing 确定性缺陷推荐 coding。外部阻塞由 assess 标识为 deferred gap，是否向下游传播仍由 driver 的 `dependency_policy` 授权。`INCOMPLETE` / `DEFERRED` 禁止伪装为 completed。

`phase-transition-policy.ts` 仍承载 manual/batch 授权和 runner 的安全 guard action vocabulary；跨阶段目标由 assess 唯一选择。下游 prompt 须携带 upstream DEFERRED 清单。详见 [goal-mode-runbook.md](../operations/goal-mode-runbook.md)。

## 相关 registry id

| id | 边界 |
|----|------|
| `phase.next_step` | 任一 feature phase 闭环后（通用） |
| `plan.ok_to_code` | design → coding |
| `coding.ok_to_review` | coding → review |
| `review.ok_to_ut` | review → UT |
| `ut.ok_to_testing` | UT → testing |

## 反模式

- 读完 `phase-completion-receipt.md` 后在同一执行流自动 Read 下一 Skill
- 把「可进入 Skill N」当成「现在就进入 Skill N」
- `spec.freeze` / 上游闭环 alone 当作下游授权（除非 `batch_authorized` 或 `goal_mode` manifest）
- 将 INCOMPLETE / DEFERRED 软通过为 PASS 或 completed
