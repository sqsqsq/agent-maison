# 实例扩展协议与时点

本文件记录 **实例扩展（`doc/extensions/`）**、**workflow DAG（`framework/workflows/`）** 与 **lifecycle hooks** 三套协议的版本语义与演进纪律。

## schema_version

- 三套协议各自携带独立的 `schema_version`（互不绑定）。
- 当前版本：extension manifest 支持 `1.0` / `1.1` / `2.0`，新宿主骨架使用 `2.0`。workflow 当前为
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
- Feature phase 从 active workflow 的 Feature phase 集解析。`usage` 只供阅读。M7 类型和有效性由原消费者判定。

### Extension manifest 2.0

`bindings.<能力ID>.<绑定ID>` 指定 `at`、`kind` 和 `ref`。来源可声明 `enabled_by_default`。Feature 或 harness 时点另用对应的 `phase`。完整字段以 [扩展清单 schema](../../specs/instance-extension-manifest.schema.yaml) 为准。

```yaml
schema_version: "2.0"
name: example
provides:
  skills: [contract-examples]
bindings:
  contract-examples:
    intake:
      at: component-design.before_discovery@1
      kind: knowledge
      ref: skills/contract-examples/reference/intake.md
      enabled_by_default: true
    draft-examples:
      at: component-design.before_discovery@1
      kind: action
      ref: contract-examples
      enabled_by_default: true
```

| 时点 | 原消费者与资源 |
| --- | --- |
| `component-design.before_discovery@1` | 蓝图 ID、需求来源和写入范围绑定后，在 P1 事实发现和首次写作前。直达和受管作者使用同一准备逻辑。准备返回知识正文或回读路径、已发放动作的 Skill 路径、需求原件、显式补充材料和参考图。扩展资源定义何时适用及怎样处理材料。 |
| `feature.before_phase_work@1` | Feature 作者在动笔前使用知识文件、Skill 或 MCP 动作。MCP 产生物由原 checker 消费。 |
| `feature.before_phase_verify@1` | 普通 Feature checker 运行前，由原 harness 检查声明的 MCP 产物。 |
| `feature.after_phase_verify_before_close@1` | Feature 验证后、收口前，由原 receipt gate 检查声明的 MCP 产物。 |
| `harness.<既有事件名>@1` | `.mjs` 结果沿原 checker。Markdown 及脚本片段由实际组装的本轮 verifier 提示消费。 |

普通检查末尾依次发出 `pre_verifier → on_context_load → post_verifier → post_phase`，随后才判断签发 verifier 的资格。特别是 `post_verifier` 的事件名不代表验证者已经运行。 [时点及事件定义](../../specs/lifecycle-hooks-schema.yaml)

`1.0` 按目录发现 Skill，`1.1` 与 `2.0` 按 `provides.skills` 选择。旧 `phase_bindings`、`provides.hooks` 及变更前知识保持既有消费边界。旧 `skill_assets.component-design.knowledge` 先按 extension 覆盖同键 profile 的优先级解析，独立的新知识追加到作者输入。手写链接沿原用途读取，动作授权取本次发放的绑定。

已知具体条目的未知时点、缺资源和坏引用会带绑定 ID 与原因，健康贡献照常交付。整份无法解析或协议版本不支持时，实例清单整体不可用。要求该绑定的工作报告所缺依赖，在下次请求按当前配置重新解析。

### 本地安装与请求证据

在宿主的 `framework/harness` 运行 `npx ts-node scripts/extension.ts install <本地目录> [能力ID] --project-root <宿主根> --json`。其他动作及自然语言见 [extension Skill](../../skills/project/extension/SKILL.md)。初装采用声明默认选择，更新保留宿主开关和文件归属，新自动绑定待显式启用。持久选择同已安装资源的来源和导入指纹写入宿主清单。卸载等待已签请求交回，之后只清理独占且指纹未变的管理副本。

检视区分当前可用、按时点调度、以及对应请求的实际证据。已签请求原件保留本次绑定、来源、知识送达方式和写入范围。直接作者可在 `--prepare-design` 重复传入 `--requirement-source` 和 `--material-source`。作者在原交回中按 `extension-result` 逐条记录真实取用、复用、生成、跳过或失败及具体原因。扩展资源规定产物校验和业务采用的依据。仅查询 `--design-knowledge` 可读取当前知识。历史原件缺失时可报告当前配置和缺失的记录。

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

- extension manifest 支持 **1.0 / 1.1 / 2.0**。`--phase extensions` 沿用原全局扩展校验。
- `install` 使用与 `materialize` 相同的 `instance_skill_bridge` 刷新项目入口。
- **workflow 默认**：`spec-driven.workflow.yaml`（canonical phase：`spec` / `plan` / …；legacy `prd` / `design` alias 见 MIGRATION §v2.3）。
- **扩展 skill 安全性（UPDATE cleanup）**：`cleanup-deprecated` 仅删除框架历史 phase 约定名（含 `prd-design` 等），**不会**误删实例 extension skill（如 `wallet-sdk-onboarding`）。实例升级操作备忘见 [`../../MIGRATION.md`](../../MIGRATION.md) §v2.3 实例根 adapter 跳板；勿跳过 `cleanup-deprecated`。（本条为 inventory 时间戳连带同步，**不改变**上文三套 schema 的 `schema_version` 或字段语义。）
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml) 与 [`MIGRATION.md`](../../MIGRATION.md) 保持交叉索引一致。
