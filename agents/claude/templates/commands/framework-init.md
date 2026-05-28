---
description: 接入或升级本工程的 Framework 配置与 agent 产物（Skill 00）
argument-hint: <optional-notes>
prompts:
  - name: adapter
    type: choice
    message: "本轮 framework-init 使用的 agent_adapter（须与 framework/agents/<name>/ 目录名一致）"
    options:
      - label: claude — Claude Code（CLAUDE.md + .claude/commands + .claude/agents + .claude/hooks；Skill 正文在 framework/skills/）
        value: claude
      - label: cursor — Cursor（AGENTS.md + .cursor/skills 跳板 + .cursor/rules）
        value: cursor
      - label: generic — 通用（AGENTS.md + {agent_bundle_root}/skills inline 或 bridge）
        value: generic
      - label: 保持当前 — 沿用 framework.config.json 的 agent_adapter（须在本轮复述目录名）
        value: keep_current
---

# /framework-init — Framework 工程初始化

**用户输入（自由文本）**：$ARGUMENTS

**slash 前置选择（agent_adapter）**：`$PROMPT_ADAPTER`

> **BLOCKER — adapter 已收齐**：若 `$PROMPT_ADAPTER` 为 `claude` / `cursor` / `generic`，本轮 **已选定** 该 `adapter_name`，**跳过** Skill 00 Step **0.2.5.1** 的 adapter 表格/枚举展示，直接进入 Step **0.3.0**（`check-init --adapter <name>`）。  
> 若值为 `keep_current`：读取 `framework.config.json` → `agent_adapter`，向用户 **决策复述** 目录名后进入 Step 0.3.0；复述须含具体字符串（如 `claude`），裸「好/继续」无效。  
> **禁止**在 slash 已注入 adapter 后再画 Unicode adapter 对照表。

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/00-framework-init/SKILL.md](../../framework/skills/00-framework-init/SKILL.md)**
