## Why

宿主 bc-openCard（chrys goal-mode，2026-07-13，run 20260713T031029Z）事故链暴露四层根因（plan d9b4f7e2，六轮双审定稿）：(1) `agent_timeout`/`transient_api_error` 重试不递增 `retries`，而 prompt 回喂开关是 `retries > 0`——超时重试永远拿零上下文冷 prompt，checkpoint/续作机制被整体短路（spec 5×45m 超时被杀 + 第 6 次 43.8m 险过，共烧 4.5h）；(2) 门禁脚本 `?? []` 对 agent 产 YAML 非数组真值不兜底，TypeError 升 `[Harness 内部错误]` BLOCKER 后 agent 误当自身问题反复修；(3) 宿主（用户批准）修 framework 发布件与 `framework_integrity` 门禁拉锯——`code_regression` 回喂话术 "revert first" 指挥 goal agent 回滚宿主真修复（plan 期烧 2h+）；(4) 超时无独立熔断且 wall 预算不硬（限 585m 实跑 612m），连续超时烧到 wall 才停。

## What Changes

- **P0-5 integrity 归因收编**：`blocking_class==='integrity'` 家族（6 subtype：drift / foreign_file / manifest_corrupt / manifest_empty / manifest_tampered / manifest_sidecar_missing，可共存）统一归 runner 侧 `framework_integrity_block`，`integrity_subtypes[]` 多值收集（blocker.classification 通道 + blocking_class 过滤 + 顶层带过滤回落），全 subtype 一律首触 halt、guidance 按 subtype 分补救；goal agent 对 framework 发布件的自动写操作（含回滚）全面禁止。
- **P0-3 门禁内部错误诚实归因**：check 层 `safeRun` 程序员错误置 `failure_kind='framework_bug'` + `blocking_class='framework_internal'`（复用既有字段，零 schema 变更）；classifier 增 `framework_bug`，首触 halt。
- **freshness 决策表（P0-5/P0-3 共同 SSOT）**：超时轮按 `stale_summary` 条件化——stale→`agent_timeout`；fresh+含任意 integrity→`framework_integrity_block`；fresh+非空全 framework_bug→`framework_bug`（`blockers.length>0` 防真空真值）；fresh+混装/纯 content→`agent_timeout`。
- **P0-1 continuation 双维度**：`{cause: agent_timeout|transient_api_error|content_retry|unknown, process_resumed: boolean}`，派生收敛到"当前 phase 最近 attempt 五态窗口"（无 start→null / 有 start 无 end→unknown / end timed_out 无 verdict→agent_timeout / end 正常无 verdict→unknown / 有 verdict→其 classified cause）；`harness_start`/`harness_end`/`phase_verdict` 事件补 `invoke_id`；回喂四缺口修复（PASS+timeout 也出续作块 / resume kind 不丢 / 断流块头不谎称 TIMED OUT / 续作块注入有效预算）。
- **P0-2 agent 产 YAML 形状防崩溃**：`asArray()` 工具按"源 artifact→loader→字段→consumer"inventory 表清扫（batch1 = agent 可写入口），与形状结构化 FAIL 配对（不静默洗形状），四类形状 fixture 矩阵。
- **P0-4 硬预算全链路**：连续超时计数（签名无关）第 2 次升档 ×1.5、第 3 次 halt `agent_timeout_repeated`；wall deadline 制——**硬上界覆盖 agent/harness/backoff 三路径**（agent 与 harness **双侧 zero-budget 禁 spawn**：timeout 0 = 禁用 timer，绝不传 0；backoff 剩余装不下配置值即直接终局）；run_end 后收尾为 **pre-check 拦截的 best-effort**（`finalize_skipped` 前置跳过 + `finalize_overrun` 越界留痕——同步 fs 收尾无进程内可执行 bound，worker 隔离列开放项，见 plan d9b4f7e2 rev8 偏离①）；Windows bounded tree-kill（异步 execFile + 有界等待 + 超时结束 helper 并释放 handle）+ kill 一律配对 `armForceSettleAfterKill`；`effective_timeout_ms` 写入 `agent_invoke_start` 供 runner/progress/status/dead-man 共读；`resolveKillGraceMs()` 由 termination 契约四常量同源派生；验收"**agent/harness/backoff 三路径总时长** ≤ wall 限 + resolveKillGraceMs()"。
- **P1-6/7/8**：宿主修 framework 正规通道话术 + `framework.config.template.json` 过期 integrity field_notes 修正；`output_delivery` 静态能力进 adapter-schema、`adapter_version` 每 run 一次短超时动态探测、kill 诊断走 `agent_invoke_end` 事件字段（agent-output.log 保持 agent 原始输出）；PASS 事件省略 `failure_kind_classified`、facts.md 门禁报错带模板。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: 失败归因（framework_integrity_block / framework_bug / freshness 决策表）、continuation 双维度回喂、连续超时熔断与升档、wall deadline 全链路硬预算、bounded kill、effective_timeout_ms 单一事实源。
- `harness-gates`: check 层内部错误结构化归因（framework_bug）、agent 产 YAML 形状防崩溃（asArray + 形状 FAIL 配对）。

## Impact

- runtime：`harness/scripts/goal-runner.ts`、`harness/scripts/utils/goal-failure-classifier.ts`、`goal-runner-phase.ts`、`goal-timeout.ts`、`agent-invoke.ts`、`goal-progress.ts`、`check-{spec,plan,coding,review,ut}.ts`（safeRun）、`profiles/hmos-app/harness/*`（inventory 表点位）、`harness/scripts/utils/types.ts`（GoalRunEvent 可选字段）。
- 配置/文档：`templates/framework.config.template.json`（integrity field_notes）、`agents/adapter-schema.yaml` + 各 adapter（output_delivery）、AGENTS.md 模板与 framework 写保护 skill reference（宿主通道话术）。
- 测试：`goal-failure-classifier` / `goal-runner-phase` / `goal-timeout` / `agent-invoke`（bounded kill stub）/ profiles fixtures 矩阵；E4 既有单测回归。
- 兼容：events schema 只增可选字段（`invoke_id` on harness/verdict、`effective_timeout_ms`、`kill_reason` 等），旧日志按事件顺序分窗 fallback；summary schema 零变更（复用 classification/blocking_class）。
