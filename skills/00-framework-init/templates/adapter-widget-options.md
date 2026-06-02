# init.materialized_adapters / setup.adapter — Widget 文案（SSOT）

> **用途**：registry **`init.materialized_adapters`**（项目 init 多选物化）与 **`setup.adapter`**（个人 setup 从已物化列表单选）的 options 文案 SSOT；与 [confirmation-registry.yaml](../../reference/confirmation-registry.yaml) 逐字对齐。
> **消费方**：Skill 00 S2、`/framework-init` slash（`init.materialized_adapters`）；内联 personal setup（`setup.adapter`，见 personal-setup-gate.md）。
> **路径权威**：与 [framework/agents/README.md](../../../agents/README.md)「产物速查」对齐；**禁止** agent 自造 description 或要求用户「复述目录名」。

---

## 项目 init — `init.materialized_adapters`（多选 checkbox，须 ≥1）

| value | label（registry / widget 共用） |
|-------|----------------------------------|
| `claude` | `claude — 物化 Claude Code 入口与 .claude/ 产物` |
| `cursor` | `cursor — 物化 Cursor AGENTS.md 与 .cursor/ 产物` |
| `generic` | `generic — 物化 generic bundle 入口与 skills` |

**generic 默认说明**（与 registry `init.materialized_adapters` notes 对齐；label 表逐字不动）：无额外配置时 harness 使用 `.agents`/bridge 默认物化；仅非标 bundle 根须手动编辑 `framework.config.json` 后重跑 init。

Portable 辅助（同轮仍须附编号/多选说明）：

```text
请选择要物化的 adapter（多选，至少 1 项；widget 可用时直接勾选）：
- claude
- cursor
- generic
```

---

## 个人 setup — `setup.adapter`（enum，仅从已物化项中选）

| value | label |
|-------|--------|
| `from_materialized` | `从已物化列表选择 — 编号对应 materialized_adapters 条目` |

未物化 adapter **不得**出现在选项中；须引导 `/framework-init`。

---

## BLOCKER 反模式（widget / slash / 对话中不得出现）

- legacy **`init.adapter`** 单选 + `keep_current` +「须复述目录名」——已下线。
- `.claude/commands/skills/` — **不存在**；claude slash 在 `.claude/commands/`，Skill 正文在 `framework/skills/`。
- `(Recommended)` / `Recommended` — 推荐值仅可口头说明，不得写入 option label。
- 自造与 [agents/README.md](../../../agents/README.md) 速查表不一致的路径。
