# 同层策略（`intra_layer_deps`）逐层确认表

> 本模板供 Skill `00-framework-init` 的 Step 3.x 使用。AI 在写入 `framework.config.json.architecture` **之前**，按下表展示并获取用户显式回复。**交互 SSOT**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · registry `init.intra_layer_deps`。

---

## 语义参考（来自 `framework/harness/config.ts` → `IntraLayerDepsMode`）

| 取值 | 同层模块间依赖 |
|------|----------------|
| `forbid` | **完全禁止**：同层模块之间不得 `import`。适合用来「逼横向协作下沉到下面对应层」。 |
| `dag` | **允许但需无环**：同层模块可互相 `import`，但必须形成 DAG；由 `check-coding` 等按模块扫描。 |
| `sublayer` | **拆子层**：同层内部再分子层，按 `sublayers[*].can_depend_on_sublayers` 判定；需要同时填 `sublayers` 数组。 |

> **重要**：参考实例 preset 里各层的默认同层策略组合（例如典型的 `01/02/04 = forbid、03 = dag、05 = sublayer`）是**有意的设计选择**，不是「唯一正确答案」。务必先把选择权交还用户。

---

## 确认表（AI 渲染时填充「当前值」列；交互以 Step 3.x.0 gate 为主）

| 外层 id | `can_depend_on` | 当前值（preset / 问卷 / 快照） | 备注 |
|--------|-----------------|-------------------------------|------|
| `<layer-id-1>` | `<layer-id-2>, …` | `<forbid \| dag \| sublayer>` |  |
| `...` | `...` | `...` |  |

---

## AI 展示此表时必须附带的 gate（模板）

```text
请选择（回复编号；须先呈现确认菜单，同轮仍附下列编号）：
1. 全部维持「当前值」列所示策略（等价于每层「按默认」）
2. 我要调整某几层（进入 matrix 子菜单）
3. 先讨论 forbid / dag / sublayer 语义
```

- 用户选 **1** → 视为每层已显式「按默认」；**不得**再要求逐行打字。
- 用户选 **2** → 对需改层使用 `1=按默认 2=dag 3=forbid 4=sublayer` 子菜单。
- 笼统的「好」「继续」**不构成**确认。

## 用户选择 `sublayer` 时的追加问卷

若任一行选择 `sublayer`，必须继续追问该层的 `sublayers`：

- 每个子层 `id`；
- `members_pattern_or_list`（模块名列表，与 catalog 对齐）；
- `can_depend_on_sublayers`（允许依赖的兄弟子层 id，不得自引用，整图无环）。

完成上述追问后，回到生成前强制自检（见 `SKILL.md` Step 3），确认通过后才能写入 `framework.config.json`。
