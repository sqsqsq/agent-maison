# Claude Code — 用户确认 Widget（渐进增强 · BLOCKER）

> 与 [framework/skills/reference/user-confirmation-ux.md](../../framework/skills/reference/user-confirmation-ux.md) 配套；**Claude adapter 会话级 BLOCKER**。
> Widget 选项文案 SSOT：[widget-options/index.md](widget-options/index.md)（init.adapter 仍用 [adapter-widget-options.md](../../framework/skills/00-framework-init/templates/adapter-widget-options.md)）。

## Widget 工具（BLOCKER）

- 本工程 `agent_adapter=claude` 时，凡 **registry** 中 `class: gate | enum | freeform_approval` 及 **`artifact_checkbox` 的对话 gate 阶段**，须 **先** 调 **`AskUserQuestion`**（不是 Cursor 的 `AskQuestion`）。
- **options label 须逐字引用** [widget-options/](widget-options/) 对应文件；**禁止**自造 label / 路径。
- **同轮消息末尾仍须附** portable 编号菜单（`1` / `2` / `3` …），见 user-confirmation-ux Tier 2。
- Unicode / Markdown **大表不应作为唯一交互**；表格仅作 recap 或 gate 选 `2` 后的可读摘要。
- **`freeform_approval`**：须先展示完整提议 / 变更描述，再调 AskUserQuestion。
- **`artifact_checkbox`（如 `prd.terminology`）**：对话 widget 后 **须写回** PRD `[x]`；口头 OK 无效。
- 写入或进入下一步前须 **决策复述**（user-confirmation-ux §3.6）。
- **不替代** v2.9+ Research Sub-Phase / `context-exploration` harness。

## Registry 覆盖（Skills 0–6 · 22 点）

| registry id | widget SSOT |
|-------------|-------------|
| `catalog.staging_module` / `catalog.staging_glossary` / `catalog.seed_tech_word` | [skill0-catalog-options.md](widget-options/skill0-catalog-options.md) |
| `prd.feature_path` / `prd.terminology` / `prd.freeze` | [skill1-prd-options.md](widget-options/skill1-prd-options.md) |
| `design.scope_expansion` / `design.ok_to_code` / `design.arch_impact` / `design.split_table` | [skill2-design-options.md](widget-options/skill2-design-options.md) |
| `coding.scope_stop` / `coding.module_batch` / `coding.deps_abc` | [skill3-coding-options.md](widget-options/skill3-coding-options.md) |
| `review.module_name` / `review.report_save` | [skill4-review-options.md](widget-options/skill4-review-options.md) |
| `ut.plan_confirm` / `ut.mock_plan` / `ut.src_mutation` / `ut.dag_confirm` | [skill5-ut-options.md](widget-options/skill5-ut-options.md) |
| `testing.module_name` / `testing.packaging` / `testing.plan_confirm` | [skill6-testing-options.md](widget-options/skill6-testing-options.md) |

init 7 点（`init.adapter` 等）见 Skill 00 §0.2.5.1 / Step 3.x / §0.3.4 + [adapter-widget-options.md](../../framework/skills/00-framework-init/templates/adapter-widget-options.md)。

## 纪律

- 裸「好 / 继续 / ok」不构成 BLOCKER 确认（Skill 00 §0.3.4.3 等仍适用）。
- PRD 术语等 **artifact `[x]`** 仍须写回文件；对话 widget 不能替代。

## 与 slash 的关系

- 通过 `/framework-init` 且 slash frontmatter 已注入 `agent_adapter` 时，**勿再画 adapter 选型表**（Step 0.2.5.1 已由 slash 满足）。
- 各 Skill slash（`/prd-design` 等）正文含本 Skill registry 确认点 BLOCKER 段；与本 rules 文件 **同优先级**。

## BLOCKER 反模式

- widget 可用却仅给 Markdown 表 + 文本编号，未调 AskUserQuestion。
- option label 自造路径（含 `.claude/commands/skills/`）或 `(Recommended)` 标签。
- 跳过 Research Sub-Phase 直接写 PRD 正文大块（Step 2.5 仍 BLOCKER）。
