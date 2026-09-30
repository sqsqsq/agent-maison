## Why

停机之后"谁来带走"大面积缺位：停机原因虽有注册表与处置投影，但故障类别没有入册、四个原因未登记；外部与框架阻断会落到"代码回归"；
等待外部条件的停机多数没有探针，有探针的也因 `run_end` 不带探针而唤不醒；supervisor 的后继分支没有生产产出方；模型不受支持时
没有获准替代；同一 feature 有失败 run 时新开被守卫拒绝，要用户自己在恢复、接续、强制新开之间选、逐个枚举 run 并拼旗标。
实施蓝本：`.cursor/plans/按故障类别的恢复闭环与同任务接续_分类入册与归因修正及接续入口_4e6fb3b6.plan.md`（总纲 272acb5f 的 P3）。

## What Changes

- 停机原因注册表条目增加可选的故障类别（六类，默认解释，不改任何处置）；补登 `budget_turns`、`receipt_missing`、
  `legacy_run_requires_manual_cleanup`、`guardian_termination_failed`；元门禁补扫启动期阻断实参与预算停机变量。
- 需要人介入的停机说明读得出影响、谁能修、怎么恢复、怎样确认已恢复；首选"补上缺的输入后重新发起同一请求"，已填好的完整命令只作备选。
- 归因修正：外部阻断看全部 blocker；非超时轮存在框架阻断即按框架缺陷停、内容 blocker 保留；正式调用硬失败的归因取值改为取值范围内的 `toolchain`。
- codex 终态失败信封按状态码区分：429 / 5xx 走瞬时重试，401 / 403 计入 CLI 硬失败，400 保持现状；真实样本与合成变体分开标注。
- 带探针的三种停机（设备未就绪、能力预检缺口、候选写回不可用）停放前先在进程内有界等待；探针与责任阶段贯通到 HALTED 的 `run_end`，
  supervisor 接受带探针的 `run_end` 作来源；删除 supervisor 没有生产产出方的后继分支，旧 run 的 `successor_required` 按恢复同一 run 读取。
- 获准替代模型：`framework.local.json adapters.<adapter>.approved_models`；模型不受支持且用户没有显式钉型号时按序换型号重探，
  留事件、受同一墙钟预算与截止时刻约束；模型钉值记录来源，旧 manifest 读作用户钉值且不改变身份摘要。
- 预算与截止时刻提前到启动期探测之前建立；金丝雀单次时长取 120 秒与剩余额度的较小者；启动期提前退出与正式会话之前的启动耗时计入会话分段。
- 同任务接续：一个只读决策函数（新开 / 重新接入 / 起后继 / 保持停止）在选择入口与生成出生范围之前执行，前台、detach、有人在场三个入口
  及孤儿守卫、出生范围解析、接续守卫、`createGoalRun`、恢复守卫、模型钉值裁决全部消费它；三个显式旗标行为不变，真实的锁与授权检查保留。

## Impact

- 规范：`goal-runner`、`runtime-policy`、`framework-local-config`、`agent-adapters`、`harness-gates`（框架阻断归因）、`correction-routing`（完成之后再提需求，重发即从已完成 run 起后继；调度方 2026-09-29 裁定加入）。
- 代码：`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/goal-mode-entry.ts`、`harness/scripts/goal-supervise.ts`、
  `harness/scripts/utils/{adjudication,goal-failure-classifier,goal-headless-sentinel,vision-canary,condition-wait,goal-supervisor,goal-run-creation,goal-runner-phase,goal-manifest,goal-manifest-cli,framework-local-config,config-field-ownership,await-confirm-guidance}.ts`、
  `specs/framework.local.schema.json`。
- 文档：`docs/operations/goal-mode-runbook.md`、`skills/project/goal-mode/SKILL.md`、`skills/reference/goal-mode-operations.md`、
  `skills/reference/agents-entry-detail.md`。
- 迁移：2026-08-08～09-05 之间打的 3.0.0 包写出的 `successor_required` / `successor_start_phase` 不再生效，supervisor 恢复同一个 run。
