## Why

开卡宿主第四轮（候选包 5acd53e2，run be091c）的只读取证显示三类可恢复问题仍需外部救场或白耗调用：coding 合法改模块资源文件（`string.json`）后，facts 归属按源码后缀筛掉它，门禁判 `context_exploration_facts_source_stale`，逼出两次只重建 facts 的空转轮（2 次调用、28 m 40 s）；testing 一轮里视觉 provider 缺席的事实没有传到责任归属，证据义务门、P0 覆盖门、报告 writer 与 `testing_run_status` 把它重新变成产品 FAIL——产品修好后只剩外部缺席的一轮会按 FAIL 重试到耗尽；返修窗口的局部诊断只在 testing 来源时给出且标为可选，修复效果只能等下一次完整 testing。另有两处展示准确性问题：冷却期"原停止说明"会跳过无指引的新停机引用旧指引；金丝雀 invoke 失败且无终态信封时原因全丢。本变更按 `docs/overview.md §1.2.1` 的简单优先与协作可恢复原则，复用写边界裁决与既有 `externalBlocked` / `capability_missing` 投影、既有 `DEFERRED_CAPABILITY_MISSING` 终态，不新增停机原因、状态、字段、注册表、门禁或场外状态。

## What Changes

- facts 来源 owner 复用运行时写边界裁决：写边界判给实现阶段源码域的文件不看后缀即归该阶段；写边界外仍只认 profile 源码后缀；无施工绑定时不扩大归属。
- provider 缺席投影在既有 `structured` 上补既有读取器已在读的 `evidence_block_owner: 'capability'`；证据义务门与两项 P0 覆盖门在阻断来源全部是能力缺席时复用同一投影；`testing_run_status` 按装机外部阻塞同款降级；报告 writer 把能力缺席的 P0 视觉用例留在分母、记「跳过」+"未验证（能力缺席）"、总体「有条件达标」+ 暂缓 gap；共享裁决给 `INCOMPLETE`。OCR 执行能力缺口经同一判据同样投影（归因由 `toolchain` 变为 `external_block`）。
- 运行时：testing 延迟停在本阶段或链尾时，outcome 带与设备停放同形的 WAITING(external) 投影并补发同形 `phase_halt`，恢复能力后重发同一请求接回同 run、testing 重新入队；不加探针、不声称 `external_condition_ready`。
- 返修复看要求：coding 收到任何来源的候选且本 run 有效阶段链含需要设备的阶段时给出，改为执行要求（条件具备时交回前复现并检查；条件不足记入交回说明；一次复看可覆盖多条候选），不设门禁。
- 冷却期原停止说明只看最近一次停止窗口；金丝雀 invoke 失败无终态摘要时附 stderr 最后一行非空文字。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: facts 来源归属按写边界；外部能力缺席沿 testing 裁决链一次投影。
- `goal-runner`: 能力缺席延迟的停放与同 run 接回；返修复看要求扩到所有返修窗口；冷却原停止说明的取值窗口；金丝雀失败原因。

## Impact

生产代码：`harness/scripts/utils/capability-resolution-entry-input.ts`、`harness/scripts/check-testing.ts`、`harness/scripts/utils/p0-semantic-gates.ts`、`profiles/hmos-app/harness/test-report-writer.ts`、`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/repair-candidates.ts`、`harness/scripts/utils/goal-run-creation.ts`、`harness/scripts/utils/goal-preflight.ts`；Skill：coding、device-testing；文档：`MIGRATION.md`、`docs/operations/goal-mode-runbook.md`、`docs/operations/harness-runbook.md`；观察记录：`scripts/reliability/observations/b7d2e9f4-host-start0928-5acd53e2.json`。

消费者不需要迁移旧 run、旧报告或旧 facts。宿主续跑 be091c（返修在真机上是否通过）与 09-28 起点的完整对照由用户在本变更完成后安排。提交、推送、打包与宿主运行不属本变更。
