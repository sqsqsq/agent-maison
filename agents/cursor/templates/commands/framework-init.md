---
description: 首次接入 Maison 发布件、创建或迁移 framework.config、集成新发布件后刷新 adapters，或显式执行 /framework-init；Git/SCM status、diff、add、stage、commit、push 保持 L0 direct
argument-hint: [UPDATE]
---

# /framework-init

**用户输入**：$ARGUMENTS

<!-- framework-init-applicability-gate -->
> **第一执行动作（BLOCKER）**：完整读取 [canonical framework-init Skill](../../framework/skills/project/framework-init/SKILL.md)，先执行其中“适用性与最新意图门”。若结果为 Git/SCM L0 或退出 init，立即返回，不运行 readiness/S1/planner/harness；只有明确 init 或合法本轮 S2 continuation 才继续 canonical S0→S4。

> 运行身份：cursor（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/framework-init.md` 误导）
