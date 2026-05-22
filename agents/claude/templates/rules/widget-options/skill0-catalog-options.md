# Skill 0 catalog — Widget 选项固定文案（SSOT）

> registry：`catalog.staging_module` / `catalog.staging_glossary` / `catalog.seed_tech_word`

---

## staging（Phase A Step 5 / Phase B Step 3）

| # | value | label（AskUserQuestion 逐字引用） |
|---|-------|----------------------------------|
| 1 | `confirm` | 确认 — 按当前 staging 汇总写入 catalog / glossary |
| 2 | `edit` | 修改 — 我要调整 staging 内容后再确认 |
| 3 | `skip` | 跳过 — 本模块/词条本轮不写入 |
| 4 | `void` | 作废 — 放弃本轮 staging |

Portable：`1`/y 确认 · `2`/e 修改 · `3`/s 跳过 · `4`/q 作废

---

## seed_tech_word（glossary 种子守门）

| # | value | label |
|---|-------|-------|
| 1 | `delete` | 删词 — 从种子清单移除该词 |
| 2 | `rephrase` | 改自然语言 — 修改词条表述 |
| 3 | `allowlist` | allowlist — 保留为技术词并登记 |

Portable：`1=删词` / `2=改自然语言` / `3=allowlist`

---

## 反模式

- 裸 y/e/s/q 在多题并存时不构成确认（须 widget 或编号对应上表 value）。
