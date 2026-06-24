---
name: goal-mode
description: 目标模式 goal-runner 薄入口（完整流程见 framework/skills/project/goal-mode/SKILL.md）
---

<!--
  维护说明（goal-mode 专用）：
  - 本文件仅用于 adapter.yaml skill_bridge 目录扫描 / init 目标注册；**物化到宿主时不逐字拷贝**。
  - 非 Claude 宿主：init syncTemplateTarget 对 goal-mode/SKILL.md 改调
    harness/scripts/utils/materialize-agent-bundle-skills.ts → renderBridgeSkillStubMarkdown，
    程序化生成 stub 并注入「运行身份（RESOLVED_ADAPTER）」行。
  - Claude 宿主：builtin slash 走 agents/claude/templates/commands/goal-mode.md 静态模板，与本文件无关。
  - 改身份 wiring / 跳板文案 → 改上述生成器或 Claude 静态模板，勿改本文件 expecting 生效。
-->

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/project/goal-mode/SKILL.md](../../../framework/skills/project/goal-mode/SKILL.md)**
