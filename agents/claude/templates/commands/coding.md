---
description: 进入编码阶段（Skill 3）
argument-hint: <feature-name>
---

# /coding — 编码落地

**用户输入**：$ARGUMENTS

## 唯一指令

完整读一遍 [framework/skills/3-coding/SKILL.md](../../framework/skills/3-coding/SKILL.md)，按其中的 Step 0 → Step N 严格执行，产物路径、harness 命令、完成标准、BLOCKER 清单**全部以 SKILL.md 原文为准**。

> - 全局约束在 `CLAUDE.md`（Claude Code 启动时已自动加载），不要假装没看见。
> - **本文件不复述任何规则 / BLOCKER / harness 命令 / 完成标准**——如发生冲突，以 SKILL.md 和 CLAUDE.md 原文为准。
> - 遇到"SKILL.md 没写但我觉得应该做"的念头 → 先停下来问用户，不要自行扩展。

## 阶段闭环必读（CLAUDE.md §5.1 SSOT，不可跳过）

> **本节是最后一秒强制重申**。
> Stop hook 会按本节四条件做物理拦截；缺一项 stop 都会被打回。

结束本次 `/coding` 前，主 agent **必须亲手**做完：

1. **自跑脚本 harness**：`cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature <name>`
2. **通过 Task 工具触发 verifier 子 agent**：`subagent_type: verifier`，prompt 中传入 feature/phase/脚本报告路径
3. **填写并校验完成回执**：
   - 模板：`framework/harness/templates/phase-completion-receipt.md`
   - 输出：`doc/features/<name>/coding/phase-completion-receipt.md`
   - 校验：`npx ts-node framework/harness/scripts/check-receipt.ts --feature <name> --phase coding`
4. **不要口头宣布"完成"**：Stop hook 会读 receipt + trace.json + verifier 报告，缺一项即注入提醒打回；这不是建议，是 BLOCKER。

**反假设条款（CLAUDE.md §6.5）**：若你打算用"我假设 / 通常这样 / 为安全起见"跳过以上任何一步——立即 quote 原文行号；quote 不出 = 该规则不存在 = 必须执行该步骤。
