# 同层策略（`intra_layer_deps`）逐层确认表

> 本模板供 Skill `00-framework-init` 的 Step 3.x 使用。AI 在写入 `framework.config.json.architecture` **之前**，按下表逐层展示并获取用户显式回复。**只要有一行未被显式确认，就不得落盘。**

---

## 语义参考（来自 `framework/harness/config.ts` → `IntraLayerDepsMode`）

| 取值 | 同层模块间依赖 |
|------|----------------|
| `forbid` | **完全禁止**：同层模块之间不得 `import`。适合用来「逼横向协作下沉到下面对应层」。 |
| `dag` | **允许但需无环**：同层模块可互相 `import`，但必须形成 DAG；由 `check-coding` 等按模块扫描。 |
| `sublayer` | **拆子层**：同层内部再分子层，按 `sublayers[*].can_depend_on_sublayers` 判定；需要同时填 `sublayers` 数组。 |

> **重要**：参考实例 preset 里各层的默认同层策略组合（例如典型的 `01/02/04 = forbid、03 = dag、05 = sublayer`）是**有意的设计选择**，不是「唯一正确答案」。务必先把选择权交还用户。

---

## 确认表（AI 渲染时填充「当前值」列，其余保持空白供用户写回复）

| 外层 id | `can_depend_on` | 当前值（preset / 问卷） | 你的选择（`按默认` / `dag` / `forbid` / `sublayer(+ 子层定义)`） | 备注 |
|--------|-----------------|------------------------|--------------------------------------------------------------|------|
| `<layer-id-1>` | `<layer-id-2>, <layer-id-3>` | `<forbid | dag | sublayer>` | ` ` | 例：是否希望同层 DAG |
| `<layer-id-2>` | `<layer-id-3>` | `<forbid | dag | sublayer>` | ` ` |  |
| `...` | `...` | `...` | ` ` |  |

---

## AI 在展示此表时必须随表提示的话术（模板）

> 上表列出了本次即将写入 `framework.config.json` 的各外层同层策略。`forbid` / `dag` / `sublayer` 三者语义如上。**默认值只是推荐**，请**逐行**明确回复 `按默认` 或一个具体取值；笼统的「好」「继续」不构成逐层确认，我会继续追问直到每一行都有显式回复。

## 用户选择 `sublayer` 时的追加问卷

若任一行选择 `sublayer`，必须继续追问该层的 `sublayers`：

- 每个子层 `id`；
- `members_pattern_or_list`（模块名列表，与 catalog 对齐）；
- `can_depend_on_sublayers`（允许依赖的兄弟子层 id，不得自引用，整图无环）。

完成上述追问后，回到生成前强制自检（见 `SKILL.md` Step 3），确认通过后才能写入 `framework.config.json`。
