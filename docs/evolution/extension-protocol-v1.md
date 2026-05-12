# Extension / Workflow / Hooks 协议演进（v1 起点）

本文件记录 **实例扩展（`doc/extensions/`）**、**workflow DAG（`framework/workflows/`）** 与 **lifecycle hooks** 三套协议的版本语义与演进纪律。

## schema_version

- 三套协议各自携带独立的 `schema_version`（互不绑定）。
- 当前起点：**三套均为 `1.0`**（见各 schema 文件首字段）。
- **Breaking**（主版本升）：删除字段、改字段类型、改变默认严重级别或默认合并行为。
- **Non-breaking**（次版本升）：仅新增可选字段且旧实例在无该字段时有明确默认。

详细 breaking vs non-breaking 矩阵维护在仓库 **plan「Framework 可演进性重构」§十**（implementation 完成后同步回本文件的表格）。

## 相关资产

| 主题 | 路径 |
|------|------|
| Workflow schema | `framework/specs/workflow-schema.json` |
| Extension manifest schema | `framework/specs/instance-extension-manifest.schema.yaml` |
| Lifecycle hooks schema | `framework/specs/lifecycle-hooks-schema.yaml` |
| 实例升级备忘 | `framework/MIGRATION.md` |
