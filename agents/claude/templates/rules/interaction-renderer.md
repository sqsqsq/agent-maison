# 用户交互渲染器（Claude Code · BLOCKER）

> 与 [framework/skills/reference/user-confirmation-ux.md](../../framework/skills/reference/user-confirmation-ux.md) 配套；**Claude adapter 会话级 BLOCKER**。
> 选项文案 SSOT：[confirmation-registry.yaml](../../framework/skills/reference/confirmation-registry.yaml)。

## 全局规则（BLOCKER）

任何需要用户做选择的场合——无论是 registry 已登记的确认点还是 ad-hoc 临时交互——**必须先调 `AskUserQuestion`**，禁止仅展示 Markdown 表或文本编号作为唯一交互。

## 已登记确认点

- 读取 `framework/skills/reference/confirmation-registry.yaml`
- 用 entry 的 `options[].label` **逐字**构造 AskUserQuestion 选项
- `dynamic_label.lookup` 存在时，按当前 phase 替换 label 中的占位符（如 `{next_skill_label}`）
- `requires_preamble` 非空时，须先展示完整正文再调 AskUserQuestion
- 选项含 `side_effect` 时，选择后须执行声明的副作用（写回 artifact、记录用户原话等）
- `matrix_options` 用于 gate=2 后的逐行/逐层子菜单

## 未登记 ad-hoc 交互（fallback · BLOCKER）

临时需要用户选择时，也必须构造 AskUserQuestion，选项至少 2 个有意义的选择；同轮仍附 portable 编号。

## 同轮 portable 编号（向后兼容）

调 AskUserQuestion 的**同轮消息末尾**仍须附 `1=` / `2=` / `3=` … 编号菜单（见 registry `options[].portable` 或 entry `portable_menu`）。

## 决策复述

写入磁盘或进入下一步前须 **决策复述**（user-confirmation-ux §3.6）。

## Registry 覆盖（Skills 0–6 · 33 点）

所有确认点见 [confirmation-registry.yaml](../../framework/skills/reference/confirmation-registry.yaml)；init 系列（`init.adapter` 等）options 亦在该文件。

## 纪律

- 裸「好 / 继续 / ok」不构成 BLOCKER 确认（Skill 00 §0.3.4.3 等仍适用）
- PRD 术语等 **artifact `[x]`** 仍须写回文件；对话 widget 不能替代
- **不替代** v2.9+ Research Sub-Phase / `context-exploration` harness

## 与 slash 的关系

- 通过 `/framework-init` 且 slash frontmatter 已注入 `agent_adapter` 时，**勿再画 adapter 选型表**（Step 0.2.5.1 已由 slash 满足）
- 各 Skill slash 正文含本 Skill registry 确认点 BLOCKER 段；与本 rules 文件 **同优先级**

## BLOCKER 反模式

- widget 可用却仅给 Markdown 表 + 文本编号，未调 AskUserQuestion
- option label 自造路径（含 `.claude/commands/skills/`）或 `(Recommended)` 标签
- 跳过 Research Sub-Phase 直接写 PRD 正文大块（Step 2.5 仍 BLOCKER）
- 阶段四件套 PASS 后在同一执行流自动 Read 下一 Skill（须 `phase.next_step` 停等，见 user-confirmation-ux §8）
