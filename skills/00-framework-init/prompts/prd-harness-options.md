# PRD Harness：`prd.visual_handoff_enforcement` 怎么选

供 **Skill `00-framework-init` Step 2** 展示给用户，也在 **UPDATE** 时提示「是否保留/追加 `prd` 段」。

配置位置：实例根 **`framework.config.json`** → **`prd.visual_handoff_enforcement`**，取值只为以下三者之一：

| 取值 | 行为 | 适用场景 |
|------|------|----------|
| **`warn`**（**推荐默认**） | `new_or_changed` 但 handoff 不合法 → **WARN**；完全没有 `ui_change` 块 → **WARN**。不阻断老 PRD。 | 初次接 framework、存量 PRD 多、或尚在推广 Visual Handoff。 |
| **`strict`** | 同上情况在脚本里可 **FAIL**（`check-prd`）；适合已全员按 [visual-handoff.md](../../1-prd-design/reference/visual-handoff.md) 写 PRD。 | 已规范协作、希望 PRD 像素/设计真源可追溯的团队。 |
| **`off`** | 不跑 Visual Handoff 相关脚本检查。 | 不用本套 PRD→设计稿对齐流程，或 UI 全部外置完成。 |

CLI 应急（不替代配置）：`harness-runner.ts --skip-visual-handoff`；建议设环境变量 `HARNESS_SKIP_VISUAL_HANDOFF_REASON`。

**与 PRD 的配合**：无论选哪档，只要在 PRD 里用 **`ui_change: none` / `reuse_only` / `impl_out_of_band`**，脚本**不要求** `authoritative_refs`。详见 [visual-handoff.md](../../1-prd-design/reference/visual-handoff.md)。

**UPDATE 模式**：若用户已有 `framework.config.json` 且**已含** `prd` → **保留用户值**；若没有 → 建议追加模板默认 **`warn`**，并在 Step 7 汇报中提示可阅读本文件后改为 `strict`。
