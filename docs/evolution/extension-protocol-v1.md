# Extension / Workflow / Hooks 协议演进（v1 起点）

本文件记录 **实例扩展（`doc/extensions/`）**、**workflow DAG（`framework/workflows/`）** 与 **lifecycle hooks** 三套协议的版本语义与演进纪律。

## schema_version

- 三套协议各自携带独立的 `schema_version`（互不绑定）。
- 当前起点：**三套均为 `1.0`**（见各 schema 文件首字段）。
- **Breaking**（主版本升）：删除字段、改字段类型、改变默认严重级别或默认合并行为。
- **Non-breaking**（次版本升）：仅新增可选字段且旧实例在无该字段时有明确默认。

Breaking / non-breaking 变更须同步写入 [`../../MIGRATION.md`](../../MIGRATION.md) 对应章节；实例升级优先 `merge-framework-config.mjs` 补缺字段。

## 相关资产

| 主题 | 路径 |
|------|------|
| Workflow schema | `framework/specs/workflow-schema.json` |
| Extension manifest schema | `framework/specs/instance-extension-manifest.schema.yaml` |
| Lifecycle hooks schema | `framework/specs/lifecycle-hooks-schema.yaml` |
| 实例升级备忘 | `framework/MIGRATION.md` |
| 扩展概念 SSOT | [`../concepts/extensibility.md`](../concepts/extensibility.md) |
| 端到端验收清单 | [`extension-e2e-acceptance.md`](extension-e2e-acceptance.md) |

---

## 维护同步（2026-05-22 · 对齐 2.0）

- 三套 schema 仍为 **1.0** 起点；`--phase extensions` 全局门禁不变。
- **render-agents-md** + `instance_skill_bridge` 为扩展 Skill 下发首选路径（弱模型强制，见 Skill 00 Step 4.1）。
- **workflow 默认**：`spec-driven.workflow.yaml`（11 phase：5 全局 + 6 feature）。
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml) 与 [`MIGRATION.md`](../../MIGRATION.md) 保持交叉索引一致。
