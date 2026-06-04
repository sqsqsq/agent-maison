# Init staging JSON 示例（S2 → S3）

> **待补全模板**：`--emit-staging-template` 输出的 `decision.materialized_adapters` 默认为 `[]`，须用 S2 `init.materialized_adapters` 多选结果替换为非空数组，否则 preflight 阻断。
>
> **context 禁止**包含 `projectRoot`、`harnessRoot`、`plan`（由 CLI `--project-root` / harness 目录注入）。

## decision.json（project · schema 1.0）

```json
{
  "schema_version": "1.0",
  "scope": "project",
  "decision_mode": "smart",
  "plan_generated_at": "<来自 S1 InitTaskPlan.generated_at>",
  "materialized_adapters": ["claude"],
  "tasks": [
    { "task_id": "ensure-config", "action": "keep" },
    { "task_id": "backfill-config", "action": "run" },
    { "task_id": "materialize-adapter:claude", "action": "run" },
    { "task_id": "ensure-gitignore", "action": "run" },
    { "task_id": "harness-install", "action": "run" },
    { "task_id": "run-global-phases", "action": "run" },
    { "task_id": "write-architecture", "action": "skip" }
  ]
}
```

## context.json（仅 S2 收集的 payload）

```json
{
  "materializedAdapters": ["claude"],
  "configWritePayload": {
    "schema_version": "1.1",
    "project_name": "<实例工程名>",
    "materialized_adapters": ["claude"],
    "project_profile": { "name": "hmos-app", "sub_variant": "app" }
  }
}
```

## 生成骨架命令（emit）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --emit-staging-template
```

将 stdout 解析为 `{ "decision": {...}, "context": {...} }`，分别写入 OS 临时目录的 `decision.json` 与 `context.json`；**不要**在 emit 时附带不存在的 `--context-file`。

补全 `decision.materialized_adapters` 后，`context.materializedAdapters` / `configWritePayload.materialized_adapters` 须与 decision **集合一致**。
