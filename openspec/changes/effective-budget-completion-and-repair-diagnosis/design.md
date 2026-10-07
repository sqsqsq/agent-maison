## Context

本 change 对应 3.1.0 plan `预算有效值与完成输出同源_返修局部诊断与接续冷却归一_a2f7c9e4`（基线 98434b6f），实施分四批：批一 t1/t2（预算有效值、仅预算接回、冷却归一），批二 t3/t5（完成输出与报告同源、小项），批三 t4（返修局部诊断、§3.7 驱动方材料），批四 t6/t7（真实进程中断回归、文档与本 change）。设计细节与正反例以 plan §3、各批实施记录（§8）为准；本文只记录决定与放弃的准确性。

## Goals / Non-Goals

**Goals:** 授权的预算调整一次生效且不越权；条件改变后不强制冷却；完成状态、下一步与缺口同源；报告陈述与结构化证据一致；返修修法在 coding 内拿到改后设备反馈。

**Non-Goals:** 不改 `DEFAULT_BUDGET`、冷却时长、可信完成边界算法；不改 review / UT 在返修圈内是否可跳过；不新建出包 / 装机 / 采集管线；不提供 coding 内的 provider 视觉筛查；不新增停机原因、状态、登记字段、注册表、场外状态或协议。

## Decisions

### 1. 后继预算 = 本周期最新授权摘要对应的现有数值

事件只存预算摘要，数值只在各 run 的 `manifest.budget`。出生时按 `run_created`（legacy 取首个带身份字段的 `run_start`）与预算摘要变化的 `manifest_identity_rebase` 定本周期最新授权摘要 D（跨 run 同毫秒取 run id 较大者，同 run 取事件序靠后者），再在本周期各 run、合同来源与出生输入的现有 budget 里找摘要等于 D 的那份。周期复用 `foldBudgetLineage` 的 `cycleBoundary`（边界计算提成 `resolveDeliveryCycleBoundary`，算法不变）；`ancestorRuns` 为空才是新周期，取出生输入预算。本次 `--override-manifest` 时承接目标上偏离基线的当前预算即本次授权。找不到匹配数值、events 缺失或含损坏行、拿不出出生摘要时，在既有后继 manifest 构造块内抛出（建 run 之前），不回退默认值或较旧授权。只改两处出生点；运行期上限读本 run 快照，因出生即有效值、resume 漂移授权保证快照恒为已授权值而同值。

拒绝"取最大值 / 剔除不匹配候选后回退"：反例"授权 10 → 手改 99 → 需求增量不带 override"会得到默认 30，"旧 42 / 新 20 → 漂移"会回选 42。

### 2. 仅预算变化在结构终局上接回原 run

`decideRunContinuation` 结构终局分支：变化恰为 `budget_changed`、停机原因 ∈ {`budget_turns`, `budget_wall_clock`}、身份差集恰为 budget 时返回 rejoin（内部标记 `budgetOnly`，不落盘）；已完成持有者仅预算变化保持停止。自动接回时若同时传了 `--manifest`：文件只是重复原 run（写出的字段逐项摘要相等）就读原 run manifest；文件另带改动则采用文件、预算取原 run 当前值，统一走既有身份漂移授权与 rebase 登记。

### 3. 显式 resume 只定目标

资格取 `decideLaunchContinuation`（call 不含 resume）对同一 run 的 rejoin；决策为 successor 且 targets 含目标时 `checkTerminalResumeGuard` 冷却置 0、仍要 `--force-resume`；hold 照旧。守卫签名不改。

### 4. assess 已完成投影

`a.complete` 已蕴含记录 VALID、无 blocking、义务全覆盖，直接返回 `feature_completed` 投影，`requires_driver_authorization` 改布尔，`feature_completion` 增 `VALIDATED`；无 runId 且完成记录（ok 或 broken）带 run_id 时以该 run 观察。记录存在但校验失败推荐验证；记录缺失保持既有观察（宿主回放为回责任阶段），属调度裁决的已知取舍。

### 5. 报告同源

断言按 trace `role=assertion` 计 passed / skipped；视觉轴读 `effectiveScreens`；内容 / 样式"已复核"要求定稿判定、未过期（截图 hash + 构建指纹）、规范回执通过门禁同一结构校验（`criticReceiptShapeError`）且 `image_inputs[].hash` 覆盖当前截图；总体 FAILED 取 testing gate 本轮视觉块内结果（`visualChecksOfRound`）经 `isBlockingCheck` 的阻断结论，报告不另推第二套结论。弱化旗标在场恒记一条缺口，与 `checkSkipFlagDisclosure` 同口径。

### 6. 返修局部诊断只编排既有能力

`--install-current-build` 只编排 `runDeviceTestAppBuild` + `installDeviceTestApp`（feature=`_adhoc`、phase=`testing`、进程内强制真装，product / build mode 由 provider 内同一解析器解析）；`--measure-screen` 用纯计算 `measureScreen` 与既有取材函数，产物落 `_adhoc`；均在既有入口设备门之后。返修提示词只在 coding 且本阶段候选由真机 testing 报出时出现。`--repair-notes` 只随调用方原始参数里的 `--resume` 生效，进当前返修窗口提示词，不进 manifest / 需求 / 接续决策。provider 筛查超出"三个函数组合"已裁掉。

### 7. 中断回归用真实子进程

脚本化执行者（回放真实 codex JSONL 样本）经生产 `invokeAgentHeadless`（Windows guardian containment）运行，覆盖外部 kill、无终态退出、完成后宽限内不退被收口 kill 三形态；只证明 spawn、终止与事件解析。

## Risks / Trade-offs

- 新周期不继承来源 run 的预算快照：只在首次 `--manifest` 设过的 feature 级预算需重新给出。
- `--override-manifest` 是整体授权，承接目标上的任何预算改动都随之被授权；本版之前出生的后继不追溯修正。
- 未授权调低不静默生效（须带 override）；找不到授权数值时停下而非猜测。
- 自动仅预算接回时文件省略的字段不重置为默认值（显式 `--resume --manifest` 语义不变）。
- 报告不核导航配置 hash；几何轴不看判定新鲜度；缺陷统计表"数量"可能大于各状态列之和。
- 设备证据判据用 `source_phase === 'testing'`；显式 `--dump-ui-out` 不限落点；`--install-current-build` 会改写工程构建输出与设备上的应用；返修诊断的全部单测为替身，真机反馈链待宿主验收。
- 中断回归不等于真实 Codex CLI 中断已通过；turn.completed 之后进程自行非零退出（非框架收口）仍按既有规则判未完成。

## Migration Plan

更新发布件即生效，无数据迁移；行为变化见 `MIGRATION.md`「3.1.0：预算有效值、接续冷却、完成输出同源与返修局部诊断」。归档须晚于 `task-continuation-recovery-loop`（本 change 对 goal-runner「Wall-clock budget accumulates active runtime across resume sessions」「Re-issuing the same request continues the same task through one decision」「Human-facing halt guidance states the four recovery facts」出 MODIFIED，文本以该 change 的版本为底；后两条在该 change 里是 ADDED、尚未进主规范）。
