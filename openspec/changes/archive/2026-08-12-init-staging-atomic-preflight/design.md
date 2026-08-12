# Design: Init staging 原子 preflight

## Staging 契约

| 文件 | 生成者 | 消费者 | 销毁者 | 落点 |
|------|--------|--------|--------|------|
| `decision.json` | Skill S2 agent | `init-orchestrate.ts` S3 | Skill S4 agent | OS temp `<tmpdir>/framework-init-<stamp>/` |
| `context.json` | Skill S2 agent | `init-task-executor.ts` | Skill S4 agent | 同上 |

非项目资产；禁止落在 `framework/harness/` 或 repo 内持久路径。

## S3 执行顺序

```
parse decision/context (friendly JSON errors)
→ assertDecisionStructure
→ prepareInitExecutionPlanWithStaleIds + reconcile
→ preflightExecute
   ├─ fail → writeRunLog (audit only) + summary + exit 1
   └─ ok → executeInitPlan → writeRunLog + summary
```

## Preflight 原子性

`ensure-gitignore` 的 `deps: []` 使 executor 阶段 config failed 时仍会写 `.gitignore`。preflight 在 `executeInitPlan` 前校验所有写类任务的 payload 合法性，失败则零项目产物写盘。

允许的副作用：`<harnessRoot>/reports/_global/init-orchestrate/<stamp>/`（gitignored 审计 run-log）。

## Blocked run-log

- `validateDecisionJson` 失败：一条合成 `failed`（违规 task_id 或 `<decision-validation>`），plan 内任务全 `skipped`
- payload 违规：违规任务 `failed`，其余 `skipped`

## 纵深防御

`executeInitPlan` / `init-task-executor` 内原有 guard 保留；正常流 preflight 通过后不可达。
