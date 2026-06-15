# Init staging JSON 示例（S2 → S3 通用方式）

> **智能 UPDATE 推荐**：`plan.mode === "update"`、S2 选择 smart、且无需额外 `docWritePayload` 时，优先显式使用 `--smart-auto --materialized-adapters <list>`；该路径不写 OS 临时 staging 文件。CLI 对漏写 `--smart-auto` 的自动推断仅作兼容容错。本文件仅描述 CREATE、手动模式、或需要 `docWritePayload` 的通用 staging 方式。

> **待补全模板**：未传 `--materialized-adapters` 时，`--emit-staging-template` 输出的 `decision.materialized_adapters` 默认为 `[]`，须用 S2 `init.materialized_adapters` 多选结果替换为非空数组，否则 preflight 阻断。推荐命令直接传入 `--materialized-adapters <list>`。
>
> **UPDATE 预填**：`plan.mode === update` 时，emit 的 `context.configWritePayload` 可由 harness 从磁盘 `framework.config.json` 预填最小语义字段（`project_name` / `project_profile` / `architecture`）；**不得**预填 `materialized_adapters`（避免与 S2 decision 冲突触发 cross-check）。**勿**把 `state_machine` / `toolchain` 等写入 payload。execute 时 `decision.materialized_adapters` 为 SSOT，经 `deriveUpdateConfigWritePayload(..., decisionAdapters)` 写入 `configWritePayload.materialized_adapters`。
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
  --emit-staging-template \
  --materialized-adapters <S2 多选结果逗号分隔>
```

将 stdout 解析为 `{ "decision": {...}, "context": {...} }`，分别写入 OS 临时目录的 `decision.json` 与 `context.json`；**不要**在 emit 时附带不存在的 `--context-file`。

`--decision-file` / `--context-file` 执行时**须为绝对路径**（推荐 `<tmpdir>/framework-init-<stamp>/`）；CLI 拒绝相对路径与 `framework/harness` 内路径。

补全 `decision.materialized_adapters` 后，`context.materializedAdapters` / `configWritePayload.materialized_adapters` 须与 decision **集合一致**（cross-check 在 sync 前基于 raw context 检测冲突）。

## 推荐：CLI `--smart-auto`（智能 UPDATE 快捷路径）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --smart-auto \
  --materialized-adapters claude,generic
```

内部仍走同一套 preflight → `executeInitPlan`；**不**替代 S2 registry 多选纪律（须显式传 `--materialized-adapters`），且不创建外部 OS staging 目录。Agent 应显式传 `--smart-auto`；自动推断只用于兼容历史命令。
