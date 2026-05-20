# Claude Code — 用户确认 Widget（渐进增强）

> 与 [framework/skills/reference/user-confirmation-ux.md](../../../../skills/reference/user-confirmation-ux.md) 配套；**Claude adapter 会话级补充**（SHOULD，非 Skill 逐步 BLOCKER）。init 专用 BLOCKER 见 Skill 00 §0.2.5.1 / Step 3.x / §0.3.4。

## Widget 工具

- 本工程 `agent_adapter=claude` 时，呈现 **gate / enum** 类确认须 **优先调用 `AskUserQuestion` 工具**（不是 Cursor 的 `AskQuestion`）。
- **同轮消息末尾仍须附** portable 编号菜单（`1` / `2` / `3` …），见 user-confirmation-ux Tier 2。
- Unicode / Markdown **大表不应作为唯一交互**；表格仅作 recap 或 gate 选 `2` 后的可读摘要。
- 写入或进入下一步前须 **决策复述**（user-confirmation-ux §3.6）。

## 纪律

- 裸「好 / 继续 / ok」不构成 BLOCKER 确认（Skill 00 §0.3.4.3 等仍适用）。
- PRD 术语等 **artifact `[x]`** 仍须写回文件；对话 widget 不能替代。

## 与 slash 的关系

- 通过 `/framework-init` 且 slash frontmatter 已注入 `agent_adapter` 时，**勿再画 adapter 选型表**（Step 0.2.5.1 已由 slash 满足）。
