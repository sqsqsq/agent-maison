# 同层策略（`intra_layer_deps`）逐层确认表

> 供 Skill `00-framework-init` S2 使用。写入 `framework.config.json.architecture` **之前**按下表 + registry **`init.intra_layer_deps`** gate/matrix 确认。
> **交互 SSOT**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · **禁止**对话问卷收集外层 id / 子层列表。

---

## 语义参考（`framework/harness/config.ts` → `IntraLayerDepsMode`）

| 取值 | 同层模块间依赖 |
|------|----------------|
| `forbid` | 同层模块之间不得 `import` |
| `dag` | 同层可 `import`，须无环（harness 扫描） |
| `sublayer` | 同层拆子层；**完整 `sublayers[]` 须在 preset 或手动编辑的 JSON 中**，init 不在对话补全 |

> preset 默认同层策略是**设计示例**，不是唯一答案；须 gate/matrix 显式确认。

---

## 确认表（AI 渲染时填充「当前值」列）

| 外层 id | `can_depend_on` | 当前值（preset / 磁盘快照） | 备注 |
|--------|-----------------|---------------------------|------|
| `<layer-id-1>` | `<layer-id-2>, …` | `<forbid \| dag \| sublayer>` |  |
| `...` | `...` | `...` |  |

---

## Gate（registry `init.intra_layer_deps`）

```text
请选择（回复编号；须先呈现确认菜单，同轮仍附下列编号）：
1. 全部维持「当前值」列所示策略（等价于每层「按默认」）
2. 我要调整某几层（进入 matrix 子菜单）
3. 先讨论 forbid / dag / sublayer 语义
```

- 选 **1** → 每层视为「按默认」；**不得**要求逐行打字。
- 选 **2** → 对需改层用 registry matrix：`1=按默认 2=dag 3=forbid 4=sublayer`。
- 裸「好 / 继续」**不构成**确认。

---

## `sublayer` 与手动编辑（BLOCKER）

若 matrix 对某层选 **`sublayer`**：

1. **preset / 磁盘 JSON 已含**该层完整 `sublayers[]`（id、`members_pattern_or_list`、`can_depend_on_sublayers`）→ 可继续 init。
2. **否则** → **STOP**（`init.architecture_preset=manual_edit_stop`）；指引 [手动编辑指引](./custom-architecture-questionnaire.md)；**禁止**在对话追问子层 id 或模块名列表。

完成 gate/matrix 且 DSL 校验通过后，方可写入 `configWritePayload.architecture`。
