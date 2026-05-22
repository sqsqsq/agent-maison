# Skill 1 PRD — Widget 选项固定文案（SSOT）

> registry：`prd.feature_path` / `prd.terminology` / `prd.freeze`

---

## feature_path（前置路径检查）

| # | value | label |
|---|-------|-------|
| 1 | `rename_feature` | 换 feature 名 — 使用新的 feature 目录名 |
| 2 | `fix_path` | 清理或恢复路径 — 修复 doc/features 下冲突路径 |

Portable：`1=换 feature 名` / `2=清理/恢复路径`

---

## terminology_gate（Step 1.5 · artifact gate）

| # | value | label |
|---|-------|-------|
| 1 | `all_confirm` | 全部确认 — 所有行写回 PRD [x]，进入后续 PRD 步骤 |
| 2 | `row_by_row` | 逐行确认 — 逐条确认，有问题可修改 |
| 3 | `row_edit` | 逐行修改映射 — 我要修改部分术语映射 |

Portable：`1=全部确认 high 行` / `2=逐行确认` / `3=逐行修改`

**artifact BLOCKER**：对话 widget 后须写回 PRD `## 0. 术语映射表` 的 `[x]` 列。

---

## terminology_row（Step 1.5 gate=2/3 逐行）

| # | value | label |
|---|-------|-------|
| 1 | `confirm_row` | 确认该行 — 写回本行 [x] |
| 2 | `edit_row` | 改映射 — 修改本行权威模块或消歧 |

Portable：`1=确认该行` / `2=改映射`

---

## freeze（Step 5 输出与归档）

| # | value | label |
|---|-------|-------|
| 1 | `freeze` | 冻结 PRD — 可进入 Skill 2 技术设计 |
| 2 | `continue_edit` | 继续改 PRD — 本轮不冻结 |

Portable：`1=冻结 PRD，可进 Skill 2` / `2=继续改 PRD`

---

## 反模式

- 口头 OK 未写回 `[x]` 即进入 Step 2 / Step 3 正文。
- Step 1.5 widget 不替代 Step 2.5 Research Sub-Phase。
