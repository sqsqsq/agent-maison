# Skill 2 design — Widget 选项固定文案（SSOT）

> registry：`design.scope_expansion` / `design.ok_to_code` / `design.arch_impact` / `design.split_table`

---

## scope_expansion（Step 2.5 · freeform）

**须先展示完整 Scope 扩展提议正文**，再调 AskUserQuestion：

| # | value | label |
|---|-------|-------|
| 1 | `approve` | 已读并同意扩展 — 记录用户原话到 expansions_with_user_approval |
| 2 | `reject` | 拒绝扩展 — 在原 in_scope 内重新设计 |
| 3 | `revise` | 修改提议后再议 |

Portable：`1=已读并同意` / `2=拒绝` / `3=修改提议`

---

## ok_to_code（Step 13 / 产品闸门）

| # | value | label |
|---|-------|-------|
| 1 | `ok` | design OK — 可进入 Skill 3 编码 |
| 2 | `continue_design` | 继续改 design — 本轮不授权编码 |

Portable：`1=design OK，可编码` / `2=继续改 design`

---

## arch_impact（架构影响声明）

| # | value | label |
|---|-------|-------|
| 1 | `none` | impact=none — 无架构级变更 |
| 2 | `dsl_change` | impact=dsl_change — 需更新 architecture DSL |
| 3 | `other` | 其他 — 我在对话中说明 impact 类型 |

Portable：`1=impact=none` / `2=dsl_change` / `3=其他(说明)`

---

## split_table（功能拆分表）

| # | value | label |
|---|-------|-------|
| 1 | `confirm_split` | 确认拆分 — 按当前拆分表继续设计 |
| 2 | `edit_split` | 修改拆分 — 我要调整功能拆分 |

Portable：`1=确认拆分` / `2=修改拆分`
