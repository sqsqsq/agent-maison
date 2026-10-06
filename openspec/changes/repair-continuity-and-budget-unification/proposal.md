## Why

2026-10-05 开卡审计与当前源码共同证明：中断的返修会被普通静态 PASS 错误收口，固定两次回退会阻止仍有资源的同任务继续，而 provider minor 意见会在 gate 阻断却没有修复出口。本变更在 3.1.0 沿现有返修窗口、资源账本和视觉裁决修正这三类确定性失败，落实 `docs/overview.md §1.2.1` 的效率、简单、回退重签与协作可恢复原则。

## What Changes

- 区分 invocation 已退出、返修尝试完成与缺陷经验证解决；中断保留当前 request 的候选和原始输入基线，在原 run/窗口继续，不重复发产品回退。
- 总阶段调用与总活跃时长作为同交付周期的硬资源边界，取消固定 `DEFAULT_MAX_BACKTRACKS=2` 的硬停机资格；回退次数保留观测和事务序号用途。
- 重复缺陷的无进展判断复用既有相关输入快照与验证事实；换 run/说明文本不刷新总调用、总活跃时长与已继承 round 事实，signal one-shot 和阶段 retry 保留基线 per-run 语义，真实授权、拒修反驳和其它有界恢复不改。
- 从公开接续入口重评当前周期中未完成、未被承接且有原硬资源余量的 backtrack_limit-only run；其它入口前提照查，不另加 latest 限制，不解除真实终局，旧事件/候选/拒修/资源用量保留。
- 将授权、severity、保真档位的有效视觉结论收编到既有 `effectiveScreens` 与 gate 产物，使 gate、channel evidence、候选、debt 和报告同源。minor 只披露，真实 blocker 继续回 coding；缺证走 testing 重采/重评。
- 同步生产说明、Skill/规则与 `MIGRATION.md` 的行为兼容说明。无消费者文件格式强制迁移、无新增依赖、无新状态机/协议/注册表。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: 返修中断接续、按相关输入判断重复尝试、资源预算与历史停机的公开接续兼容。
- `visual-diff`: 原始观察与有效裁决分离，minor/provider/T8/legacy 意见沿授权和保真规则统一消费。

## Impact

主要涉及 `harness/scripts/goal-phase-runtime.ts`、`utils/goal-runner-phase.ts`、`goal-run-creation.ts`、`adjudication.ts`、`scope-replan.ts`、`phase-transition-policy.ts`、`assess.ts`，以及 `profiles/hmos-app/harness/visual-{provider-review,diff-check}.ts` 和现有 evidence/debt/report 消费者。影响 spec/plan/coding/review/ut/testing 的现有 owner 回退与接续入口，不改变消费者只集成发布件的拓扑。

无须人工改宿主产物。历史事件保持原字节，消费时按当前规则重评；`MIGRATION.md` 说明两次回退不再是硬额度以及旧停机接续条件。网络 Reconnecting 早停、真机反馈提速、宿主 TC-007 声明不一致、宿主运行/升级、提交、推送、打包均不属于本批。
