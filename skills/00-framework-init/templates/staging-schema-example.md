# Init staging JSON 示例（S2 → S3）

> **待补全模板**：`--emit-staging-template` 输出的 `decision.materialized_adapters` 默认为 `[]`，须用 S2 `init.materialized_adapters` 多选结果替换为非空数组，否则 preflight 阻断。
>
> **context 禁止**包含 `projectRoot`、`harnessRoot`、`plan`（由 CLI `--project-root` / harness 目录注入）。
>
> **可选 staging 元数据**：`schema_version`、`scope` 可写在 `context.json` 便于人工审计；`normalizeStagingContext` 会在 S3 前剥离，**不**进入执行上下文。

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

## context.json（仅 S2 收集的结构化输入；结构默认由 config-builder 注入）

```json
{
  "materializedAdapters": ["claude"],
  "configWritePayload": {
    "project_name": "<实例工程名>",
    "materialized_adapters": ["claude"],
    "project_profile": { "name": "hmos-app", "sub_variant": "app" },
    "architecture": {
      "outer_layers": [{ "id": "01-Product", "can_depend_on": [], "intra_layer_deps": "forbid" }],
      "module_inner_layers": ["shared", "data", "domain", "presentation"],
      "inner_dependency_direction": "upward",
      "cross_module_exports_file": "index.ets"
    }
  }
}
```

勿在 payload 中写 `schema_version` / `state_machine` / `toolchain.hvigor` / 默认 `paths.*`；S3 `prepareConfigWriteForTask` 会按 profile 合成完整 `framework.config.json`。

## 生成骨架命令（emit）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --emit-staging-template
```

将 stdout 解析为 `{ "decision": {...}, "context": {...} }`，分别写入 OS 临时目录的 `decision.json` 与 `context.json`；**不要**在 emit 时附带不存在的 `--context-file`。

补全 `decision.materialized_adapters` 后，`context.materializedAdapters` / `configWritePayload.materialized_adapters` 须与 decision **集合一致**。
