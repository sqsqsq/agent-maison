# testing-generated-source-and-device-backtrack — testing 生成物误伤根治与真机缺陷回修接入

## Why

2026-07-28 宿主 bc-openCard run（`20260728T031459Z-e19c6b`）testing 阶段 HALTED
（`testing_write_violation`）复盘定性为两个 framework 缺口（实证链见 plan `d9e4b7c1`）：

1. **构建生成物被误判为源码篡改**：hvigor `CreateHarBuildProfile` 任务在 agent invoke 窗口内
   合法重写模块根的 `BuildProfile.ets`（agent 跑 harness 自检触发 `device_test.build`，属设计内
   工作流），纯 fs 快照写保护判为"agent 改产品源码"→ run 终止态（拒 resume）。快照故意
   git 盲，宿主 `.gitignore` 已含 `**/BuildProfile.ets` 也无效。只要 invoke 内发生一次真实
   构建且生成内容与 invoke 前不同，必然误伤——结构性复发。
2. **普通真机确定性缺陷没有回 coding 的通路**：本轮真实缺陷（真机 UI 缺 `hc_bank_row_cmb`
   spec 锚点、trace 确定性失败）不属于回修环冻结的 `visual_diff | crash` 两源，只会在
   testing 原地 retry 耗尽预算 HALT。

## What Changes

- **T1 生成物分类降级（纯内容校验，无账本）**：goal-runner 在 invoke 前后快照 diff 的消费处
  （violation 裁决时刻，早于 receipt/harness）逐项过 profile 分类器，三判据全中才降级为新
  事件 `testing_generated_file_change`（不 halt、不进终止态）：(a) 路径等于根
  build-profile.json5 某 `modules[].srcPath + '/BuildProfile.ets'`；(b) 变化仅
  added/modified；(c) 内容为合法 hvigor 模板且四常量值与 attempt 冻结配置推导逐值一致。
  removed/type-changed/值不符/额外语句 → 仍 violation；混合场景 violation 只列真违规、
  生成物单列 `generated_changed`。分类器由 hmos-app profile 持有，取不到 → 全部 violation
  （fail-closed）。
- **attempt 级 device-test 配置冻结**：`HARNESS_DEVICE_TEST_PRODUCT/BUILD_MODE` 是公开覆盖
  env，agent 子进程临时覆盖不回传 runner——goal-runner 在 testing attempt 开始时解析并冻结
  {product, buildMode}，经 env 同发 agent 与 gate harness、直传分类器（三方同源）；注入前
  对键做大小写无关清理再写唯一大写键。
- **T2 正式 gate 强制安装 + 单一覆盖式 evidence**：goal testing 的外层 gate harness 内
  build（保留 reuse）→ 强制 `hdc install -r`（复用既有 `HARNESS_DEVICE_TEST_FORCE_INSTALL`，
  仅 runner 注入 gate env）→ run → 由 check-testing 协调层统一写覆盖式
  `device-test-evidence.json`（身份 + device_target 冻结元组 + full HAP sha + install/run
  执行事实 + written_at + 结构化 cases）。runner spawn gate 前先删除该文件（agent 已退出，
  窗口内无其他写者——最小防伪，非账本）。
- **collector 扩输入接既有回修环**：`ActionableDefect.source` 增 `'device_test'`；只消费
  正式 gate evidence，校验 run/attempt 身份、设备元组、install/run 执行、trace 一致性与
  时间窗；**仅 `target_kind==='physical'` 且 `classification==='product_actionable'`（三条件：
  selector 归 spec 锚点推导 expected screen + 失败 UI dump 命中该屏其他 identity 锚点 +
  仅目标 selector 缺失/形态不满足）进回修环**；environment 只消费结构化
  RunFailureKind/install diagnosis；其余进泛化后的 unverified 通路（entries 带 source，
  文案分支；事件名 `unverifiable_must_fix` 保留）。消费面零新增：既有
  `backtrack_to_coding` 与 roundFingerprint 无进展熔断。
- **普通模式零变化**：evidence 写入门槛含 `MAISON_GOAL_GATE_HARNESS===1` 与完整 goal 身份；
  无 flag 时 install reuse 策略与现状一致。

显式非目标（v7-v9 被判过度设计后删除，禁回潮）：build/install history 账本、安装状态
resolver、event 引用/作废体系、跨 attempt 安装回溯、nonce；设备无关缺陷（emulator/unknown）
判据；Hylyre wheel trace schema 扩展。

## Capabilities

### Modified Capabilities

- `goal-runner`：生成物分类降级事件与终止态边界、attempt 配置冻结、device_test 缺陷进回修环
  （evidence 消费校验、physical-only 白名单、unverified 泛化）。
- `harness-gates`：goal 正式 testing gate 强制安装与 evidence 统一写入（coordinator 单写者、
  写入门槛、written_at 唯一时间裁决字段）；hmos-app 生成物分类器契约。
