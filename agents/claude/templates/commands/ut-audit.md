---
description: UT 可测性预检（Skill 5 自 Step 1.5 起）
argument-hint: <feature-name>
---

# /ut-audit — 可测性预检（及随后的 mock-plan）

**用户输入**：$ARGUMENTS

## 唯一指令

完整读一遍 [framework/skills/5-business-ut/SKILL.md](../../framework/skills/5-business-ut/SKILL.md)，**从 Step 1.5（可测性预检）切入执行**：

- Step 1「UT 规划清单」与规划确认门**尚未完成则必须先补齐**，禁止越过确认直接进入 Step 1.5/1.6。
- Step 1.5 / 1.6 的全部 HARD STOP、用户二选一、`testability-audit.md` / `mock-plan.yaml` 产物——**仅以 SKILL.md 与当前 `project_profile` 对应的 `framework/profiles/<profile>/skills/5-business-ut/templates/` 原文为准**（`hmos-app` 见该目录下文件），本路由不复述。
- **仅做完 1.5/1.6 不等于 UT 阶段完成**：若没有继续执行 Skill 5 后续步骤，不得宣称整块 `/business-ut` 已闭环；完整 UT 阶段仍须满足 `CLAUDE.md` §5.1 所列四条件。
- 若用户明确要求在本会话内走完全部 UT：**与 `/business-ut` 相同**，结束前必须完成 harness `ut` + verifier + 回执 + trace 等闭环。

> - 全局约束在 `CLAUDE.md`。
> - 本文件不与 SKILL.md / `CLAUDE.md` 争辩；发生冲突以二者原文为准。
> - 遇「正文没写但觉得该做」→ 停下问用户，勿自扩 scope。
