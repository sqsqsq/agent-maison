# init.adapter — Widget 选项固定文案（SSOT）

> **用途**：registry `init.adapter` 的 `widget_options_ref`。  
> **消费方**：Skill 00 §0.2.5.1 调 `AskUserQuestion` / `AskQuestion` 时；[framework-init.md](../../../agents/claude/templates/commands/framework-init.md) slash frontmatter `options.label` 须与本表 **措辞一致**。  
> **路径权威**：与 [framework/agents/README.md](../../../agents/README.md)「产物速查」对齐；**禁止** agent 自造 description。

---

## 固定选项（逐字引用）

| # | value | label（AskUserQuestion / AskQuestion / slash 共用） |
|---|-------|-----------------------------------------------------|
| 1 | `claude` | `claude — Claude Code（CLAUDE.md + .claude/commands + .claude/agents + .claude/hooks；Skill 正文在 framework/skills/）` |
| 2 | `cursor` | `cursor — Cursor（AGENTS.md + .cursor/skills 跳板 + .cursor/rules）` |
| 3 | `generic` | `generic — 通用（AGENTS.md + {agent_bundle_root}/skills inline 或 bridge）` |
| 4 | `keep_current` | `保持当前 — 沿用 framework.config.json 的 agent_adapter（须在本轮复述目录名）` |

---

## UPDATE 说明（B1 脚注，展示 adapter enum 时同轮附在菜单下方）

若 `framework.config.json` 中 `agent_adapter` 已是某值（例如 `claude`），则选项 **1（显式选该 adapter）** 与选项 **4（保持当前）** 在本轮 **落地效果相同**；仍须显式选择其一。推荐值可在对话中口头说明，**不得**在 widget label 上加 `(Recommended)` 等标签。

---

## BLOCKER 反模式（widget / slash / 对话中不得出现）

- `.claude/commands/skills/` — **不存在**；claude 的 slash 在 `.claude/commands/`，Skill 正文在 `framework/skills/`；skill **跳板目录**是 cursor 专属（`.cursor/skills/`）。
- `(Recommended)` / `Recommended` — 推荐值仅可口头说明，不得写入 option label。
- 自造与 [agents/README.md](../../../agents/README.md) 速查表不一致的路径或合并 cursor/claude 目录布局。

---

## Portable 编号（同轮仍须附，registry `init.adapter`）

```text
请选择（回复编号；widget 可用时可直接选）：
1. claude
2. cursor
3. generic
4. 保持当前 config 中的 adapter（须复述目录名）
```
