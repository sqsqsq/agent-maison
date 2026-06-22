# init.materialized_adapters / setup.adapter — Widget 文案（SSOT）

> **用途**：registry **`init.materialized_adapters`**（项目 init 多选物化）与 **`setup.adapter`**（个人 setup 从已物化列表单选）的 options 文案 SSOT；与 [confirmation-registry.yaml](../../../reference/confirmation-registry.yaml) 逐字对齐。
> **消费方**：framework-init S2、`/framework-init` slash（`init.materialized_adapters`）；内联 personal setup（`setup.adapter`，见 personal-setup-gate.md）。
> **路径权威**：与 [framework/agents/README.md](../../../../agents/README.md)「产物速查」对齐；**禁止** agent 自造 description 或要求用户「复述目录名」。

---

## 项目 init — `init.materialized_adapters`（多选 checkbox，须 ≥1）

<!-- adapter-candidates:start -->
（此段为候选菜单口径；成员来自 S1 `adapter_catalog`，门禁守护，禁止硬编码 adapter 名）

**选项 SSOT**：S1 `InitTaskPlan.adapter_catalog[]`（`[{ value, label, portable }]`）；S2 原样渲染，**禁止**在本文件或 Skill 正文写死 adapter 成员。registry [confirmation-registry.yaml](../../../reference/confirmation-registry.yaml) `options` 块保留 label/portable 文案真相（lint 排除区，非菜单候选副本）。

**generic 默认说明**（与 registry notes 对齐）：无额外配置时 harness 使用 `.agents`/bridge 默认物化；仅非标 bundle 根须手动编辑 `framework.config.json` 后重跑 init。

Portable 辅助（同轮仍须附编号/多选说明；catalog 每项一行）：

```text
请选择要物化的 adapter（多选，至少 1 项；widget 可用且 catalog.length ≤ `CURSOR_ASKQUESTION_MULTISELECT_MAX` 时直接勾选）：
（按 adapter_catalog 顺序编号 1..N，每行「N. {portable} — {label 摘要}」）
```

当 `adapter_catalog.length` > `CURSOR_ASKQUESTION_MULTISELECT_MAX`：以编号多选为主（见 user-confirmation-ux §4.1）。
<!-- adapter-candidates:end -->

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
- 自造与 [agents/README.md](../../../../agents/README.md) 速查表不一致的路径。
