---
description: 首次接入 Maison 发布件、创建或迁移 framework.config、集成新发布件后刷新 adapters，或显式选择/调用 framework-init；Git/SCM status、diff、add、stage、commit、push 保持 L0 direct
argument-hint: [UPDATE]
---

# /framework-init

**用户输入**：$ARGUMENTS

<!-- framework-init-applicability-gate -->
> **第一执行动作（BLOCKER）**：完整读取 [canonical framework-init Skill](../../framework/skills/project/framework-init/SKILL.md)，先执行其中“适用性与最新意图门”。无否定或竞争主动作的显式 `/framework-init` 直接进入 canonical Tier_1 readiness→S1，S3 仍须 S2 批准；若门要求退出 init，只停止 init 子流程而不结束本轮用户任务：存在 Git/其它主动作时立即继续并完成最新获授权主动作，纯取消才等待。不得输出 init 规则解释、不得询问是否执行 init、不得运行 readiness/S1/planner/harness；明确有序多动作必须按 canonical 顺序全部完成。

> 运行身份：cursor（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/framework-init.md` 误导）
