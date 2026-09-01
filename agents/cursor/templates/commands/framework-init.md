---
description: 显式选择或调用 framework-init、首次接入 Maison 发布件、创建/补齐/迁移 framework.config，或集成新发布件后刷新 config、adapters 与 materialized artifacts
argument-hint: [UPDATE]
---

# /framework-init

**用户输入**：$ARGUMENTS

<!-- framework-init-applicability-gate -->
> **第一执行动作（BLOCKER）**：完整读取 [canonical framework-init Skill](../../framework/skills/project/framework-init/SKILL.md)，先执行其中“适用性”。显式 `/framework-init` 直接进入 canonical Tier_1 readiness→S1，S3 仍须 S2 批准；明确取消只终止尚未完成的 init，不产生 S3/报告。若本命令上下文被错误加载而最新消息并非正向 init 意图，则按 canonical 立即停止、零 init 副作用：不运行 readiness/S1/planner/harness，不生成或复述 init 结果，不询问是否执行 init；普通任务由主 Agent 正常处理。
> **结果只属于当前 turn**：S4 只证明产生它的那次 S3 run；本 turn 未新建 init run/报告时，不得宣称本轮 init 已完成、复述旧计数或列出旧报告路径。

> 运行身份：cursor（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/framework-init.md` 误导）
