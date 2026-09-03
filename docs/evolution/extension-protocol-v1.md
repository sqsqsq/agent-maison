# Extension / Workflow / Hooks 协议演进（v1 起点）

本文件记录 **实例扩展（`doc/extensions/`）**、**workflow DAG（`framework/workflows/`）** 与 **lifecycle hooks** 三套协议的版本语义与演进纪律。

## schema_version

- 三套协议各自携带独立的 `schema_version`（互不绑定）。
- 当前版本：extension manifest 支持 `1.0` / `1.1`；默认 skeleton 为 `1.1`。workflow 当前为
  `1.1`，lifecycle hooks 保持其自身版本。三者互不绑定。
- **Breaking**（主版本升）：删除字段、改字段类型、改变默认严重级别或默认合并行为。
- **Non-breaking**（次版本升）：仅新增可选字段且旧实例在无该字段时有明确默认。

Breaking / non-breaking 变更须同步写入 [`../../MIGRATION.md`](../../MIGRATION.md) 对应章节；实例升级优先 `merge-framework-config.mjs` 补缺字段。

### Extension manifest 1.1

- knowledge 支持 `{path, summary, audience}`；旧字符串在 1.1 中只进入全部 Feature phase 的动态
  索引，不进入 AGENTS.md。
- 新增 `provides.mcp_actions`（宿主执行、仓内 produces、Maison 验证）与顶层 `phase_bindings`；
  不接受 server、URL、token、command 或登录配置。
- 三槽位仅为 `before_phase_work` / `before_phase_verify` /
  `after_phase_verify_before_close`，只管 Feature phases。
- 1.1 Skill 物化以 `provides.skills[]` 为 SSOT；1.0 仍目录驱动，行为不变。
- Feature phase 取 active workflow full/lite 并集；非法 manifest 选择零 Skill 并在 Feature/receipt
  复用同一诊断 BLOCKER。`usage` 不参与 M7 类型判断。

## 相关资产

| 主题 | 路径 |
|------|------|
| Workflow schema | `framework/specs/workflow-schema.json` |
| Extension manifest schema | `framework/specs/instance-extension-manifest.schema.yaml` |
| Lifecycle hooks schema | `framework/specs/lifecycle-hooks-schema.yaml` |
| 实例升级备忘 | `framework/MIGRATION.md` |
| 实例根遗留跳板清理（UPDATE 操作） | [`../../MIGRATION.md`](../../MIGRATION.md) §v2.3 实例根 adapter 跳板 |
| 扩展概念 SSOT | [`../concepts/extensibility.md`](../concepts/extensibility.md) |
| 端到端验收清单 | [`extension-e2e-acceptance.md`](extension-e2e-acceptance.md) |

---

## 维护同步（2026-09-03 · 3.1.0）

- extension manifest 当前支持 **1.0 / 1.1**；`--phase extensions` 仍是同一全局门禁。
- **`/extension materialize`** + `instance_skill_bridge` 是扩展 Skill 下发路径；1.1 以 manifest skills 为真源。
- **workflow 默认**：`spec-driven.workflow.yaml`（canonical phase：`spec` / `plan` / …；legacy `prd` / `design` alias 见 MIGRATION §v2.3）。
- **扩展 skill 安全性（UPDATE cleanup）**：`cleanup-deprecated` 仅删除框架历史 phase 约定名（含 `prd-design` 等），**不会**误删实例 extension skill（如 `wallet-sdk-onboarding`）。实例升级操作备忘见 [`../../MIGRATION.md`](../../MIGRATION.md) §v2.3 实例根 adapter 跳板；勿跳过 `cleanup-deprecated`。（本条为 inventory 时间戳连带同步，**不改变**上文三套 schema 的 `schema_version` 或字段语义。）
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml) 与 [`MIGRATION.md`](../../MIGRATION.md) 保持交叉索引一致。
