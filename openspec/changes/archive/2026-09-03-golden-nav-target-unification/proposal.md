# Proposal: Golden / nav / capture target 集合统一

## Why

c4e8b1d3 Todo 3 重新打开（2026-08-12）的集成缺陷：golden 显式 P1 / negative targets
已被 capture 采集，但 check-testing 的 nav 校验只消费 `collectP0VisualTargetIds`
（纯 P0 集合），`validateNavConfigV2` 又要求与 target 集合**严格集合相等**——golden
点名的 P1 屏（bank_card_list_sheet）与 forbidden 负向屏（HomeTab）无处声明导航步骤，
一写入 nav 配置即被判「多余/错写屏名」（宿主 bank_card_detail 实测命中）。capture
函数层通了，check-testing 入口层没通。

## What Changes

- check-testing 的 visual_diff 采集入口改为**单次解析** golden contract
  （`MAISON_GOLDEN_CONTRACT`，经既有 `loadGoldenContractFromEnv` 单次 JSON.parse，
  两个既有 loader 收敛为委托），解析后的 canonical target 集合
  `P0 targets ∪ golden positive capture targets ∪ golden forbidden nav targets`
  同时供 nav 校验（`validateNavConfigV2`）、identity 解析（`resolveIdentityForTargets`）
  与 capture（`goldenTargets`/`goldenForbidden` 显式传入，capture 不再各自重读 env）。
- 复用既有三件套（`loadGoldenContractTargetsFromEnv` / `loadGoldenContractForbiddenFromEnv` /
  `resolveGoldenCaptureTargets` + 新增 `collectGoldenPositiveTargetIds` 帮助函数），
  不新增第二套 golden contract 解析器或平行 SSOT。
- 普通模式（env 未设）target 集合仍为纯 P0：普通 P1 屏写进 nav 配置仍判
  「多余/错写屏名」，capture 不扩面采集 P1——行为逐字节不变。
- golden declared 缺失 / 形态漂移 → 在 check-testing 入口 fail-closed
  （nav 门禁 BLOCKER/FAIL 点名 golden_contract 失败，不靠跳过 nav 校验解决）；
  slug 冲突继续由 capture 层 fail-closed（t2b 既有行为不变）。
- 新增入口级测试（经 check-testing 生产接线，非注入 captureVisualDiff opts）：
  golden P1 屏合法进 nav 并进入采集 / forbidden 屏进 nav 到达集合并产出负向证据 /
  无 golden 严格 P0-only / golden 缺失或形态不符 fail-closed / identity 集合与
  nav、capture 相同（含 forbidden 屏纳入 identity 需求集）。

## Capabilities

### Modified Capabilities

- `harness-gates`: check-testing 的 device visual_diff 入口按统一 canonical target
  集合（P0 ∪ golden positive ∪ golden forbidden nav）执行 nav 校验/identity 解析/
  capture；golden contract 单次解析、显式传递；普通模式 P0-only 行为不变。
- `visual-diff`: golden contract 装载收敛为单解析入口（`loadGoldenContractFromEnv`，
  既有两个 loader 委托同一实现）。

## Impact

- 生产代码：`harness/scripts/check-testing.ts`（抽取 `runDeviceVisualDiffCapture`
  入口，统一 target 集合）、`profiles/hmos-app/harness/visual-diff-capture.ts`
  （单一装载器）、`profiles/hmos-app/harness/visual-diff-targets.ts`
  （`collectGoldenPositiveTargetIds` 帮助函数）。
- 单测：`harness/tests/unit/golden-nav-capture-wiring.unit.test.ts`（新增，入口级
  8 用例，注册入 run-unit CORE_SUITES）。
- 兼容不变式：无 MAISON_GOLDEN_CONTRACT 的普通模式行为零变化；capture 既有
  env 装载回退（非 check-testing 调用方直呼 captureVisualDiff 时）保持不变；
  golden contract 文件 shape 契约（positive_screens / forbidden 条目字段与校验）
  不变。
- 消费方（evaluator / 宿主流程）零改动；无 schema 变更。