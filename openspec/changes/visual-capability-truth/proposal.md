# Proposal — visual-capability-truth

## Why

2026-07-18 宿主 SimulatedWalletForHmos goal run `20260718T063943Z`（cursor adapter）首次实测
blind-visual-hardening（a9d4c7e2/c643f9a8）：**治理层全面生效**——「不达标」被
`negative_verdict_closure` 拦截、ut 翻 FAIL 被 `upstream_verdict_gate` 拦截、review 后改码被
`review_closure_attestation` 拦截、8/9 屏采集失败被 `visual_diff_capture` 拦截、goal 正确
HALTED 无假 PASS。但暴露五层新缺陷（plan e9c4a7f3，codex 五轮 review 冻结）：

1. **能力真值层（最根源）**：视觉能力判定 = adapter `multimodal: true` 声明 + run 前一次性
   canary（tool_read 4/4）——但 cursor 可路由多模型，探针时与各 phase 干活时可以不是同一
   模型实例；对产出又无反证检测。结果：ui-spec 把「等内多园人更多」「攻上上人上日」等 OCR
   乱码固化为元素文本，却自签 `verified_method: vl_multimodal`；盲档地板（UI kit 强制声明/
   确定性反馈）该启动而未启动。
2. **真机基建层**：hylyre 链路中文被破坏（`by_text: '����'`，Python/wheel 侧编码边界）；
   唯一"成功"截图实为错误页面（添加卡片类型页冒充银行列表页）仍计入 captured——capture
   层无页面身份断言。
3. **规约一致性层**：spec/plan 同时表达「WalletMain/Phone 禁改」与「功能必须经
   WalletMain/Phone 接入」，门禁未识别矛盾 → coding 做孤岛模块，testing 期补胶水。
4. **编排层**：testing/ut 改产品源码后 goal 只会阶段内重试（无回退编排，attestation FAIL
   不可自愈）；attempt 内 agent 合法中途重跑 harness 写入的 ledger 中间行被判孤儿 →
   `visual_ledger_integrity` 误熔断（本次 halt 的直接触发器）。
5. **度量真实性层**：结构分基于 struct 声明而非挂载树；locator 覆盖 0% 因宿主
   `visual_parity_enforcement: warn` 降档而无约束；TC 单 session 状态链使 1 个根故障级联成
   7 个"独立失败"。

## What Changes

- **d1 视觉能力真值（P0-A）**：`capability_scope` 三级信任（adapter_declared / run_probed /
  invocation_bound，runner 签发：路径 A 可信模型路由全等绑定 / 路径 B 同 invocation 内嵌
  canary）；`resolveEffectiveVisionContext` 唯一解析器**三轴分算 + fail-closed meet**
  （visionCapability / artifactAttestation / effectivePolicy——invocation_bound 只提升能力，
  不解除 artifact 降级；supersede/clear 为 append-only runner event，仅绑定新 artifact hash
  的 verified attestation 可解除对应降级）；`vl_multimodal` 终签硬化（invocation_bound +
  authoritative refs 逐张验读 provenance，复用 critic-receipt 结构化工具事件机制，无解析器
  adapter 结构性不可签）；`vision_output_counterevidence` 反证器（contradicted 与
  unverified/evidence_gap 分立；启发式首版 observe-only）；`artifact_visual_attestation`
  独立 runner-owned receipt；blind-safe 策略降级贯通全 phase。
- **d2 真机执行基建（P0-B/C）**：hylyre Python/wheel UTF-8 边界（`PYTHONUTF8=1` +
  `PYTHONIOENCODING=utf-8` env 注入 + wheel steps 读取审计）+ 真实链路中文 round-trip
  doctor（BLOCKER 阻断 device testing）；visual-diff-nav **schema 2.0**（screens/steps/
  identity `all_of|any_of|none_of`，旧数组格式兼容读取，独特文本 df=0 机器判据，候选
  `proposed` 不自动生效）；采集顺序改 `navigate → dump uitree → identity gate →
  screenshot → canonical write`，身份不匹配 → `screen_identity_mismatch` 不计 captured。
- **d3 阶段回退编排（P0-D）**：runner 级 source drift reconciliation（review 后各可变阶段
  统一对账，不只 testing check）；改码分类五分支决策表（授权三源 human / runner_policy /
  pre_run_manifest——`run_started` 冻结 manifest hash；拒收 agent 自签 `approved_by`）；
  持久化回退状态机（`phase_invalidated` / `phase_backtrack_*` 事件集，resume 从 events
  重建，回退上限 1 次并消耗预算，invalidation 十消费面矩阵）；环境类失败 `failure_layer:
  environment` 标注。
- **d4 ledger 单写者（P0-E）**：goal 态 agent 侧 harness 改写 intermediate journal proposal
  （hash 链）；`evaluateVisualRound` 逻辑历史 = committed ledger + 本 invoke journal；
  runner 收编 = 从基线顺序重放重算（不信任 journal 自带 decision）；尾部截断为已声明
  非密码学边界。修改 critic-loop-hardening 既有 ledger 对账规格。
- **d5 规约一致性与可达性（P1-F/G）**：contracts.yaml `integration_points` 机器块 +
  `integration_scope_consistency`（requires_modification 的 consumer ∉ in_scope → FAIL；
  零修改接入点须验证实际 consumer binding）+ headless 决议矛盾 halt；
  `host_entry_reachability`（coding 期宿主入口→路由→页面静态走查）。
- **d6 度量真实性（P1-H/I、P2-J）**：locator-required 七类分母 + calibrate→两宿主 run→
  enforce 三步（enforce 前保持观察）；test-plan `test_case_flow` YAML machine block +
  Markdown 一致性门禁 + `BLOCKED_BY` 硬边界（非 PASS、进分母、阻 completion，仅根因归类）；
  结构保真拆轴（static_structure_conformance + runtime_mount_conformance）；asset 轴
  provenance 引用继承（hash/fingerprint 全一致才继承，否则 STALE）；资产实例绑定四段
  通用链（去业务化）。

显式非目标：BYO-VL/外置 VL（用户硬约束仍在）；OCR 引擎更换；hylyre 功能扩展；
宿主工程修复（用户按恢复路径重跑）；ledger 密码学防协同篡改（尾部截断锚定为
后继项，本 change 只如实声明边界）。

## Capabilities

### New Capabilities

- `vision-capability-truth`：三轴视觉真值模型（能力/产物证明/有效策略）、runner 签发
  协议、唯一解析器、反证器与 blind-safe 降级贯通。

### Modified Capabilities

- `visual-diff`：nav schema 2.0 + screen identity gate + 采集顺序；UTF-8 round-trip
  doctor；locator calibrate→enforce。
- `goal-runner`：source drift reconciliation + 改码分类 + 持久化回退状态机 +
  invalidation 消费面；ledger 单写者/journal 协议（修改 critic-loop-hardening 引入的
  对账规格）；manifest 授权冻结。
- `harness-gates`：`vision_output_counterevidence` / `integration_scope_consistency` /
  `host_entry_reachability` / `test_case_flow` 一致性 / 拆轴 / asset 轴 provenance 继承 /
  资产实例绑定。
- `feature-artifact-layout`：新 artifacts（vision-capability receipt / artifact-attestation
  receipt / intermediate-rounds journal / test_case_flow block / nav 2.0 迁移产物）。

## Impact

- Affected specs: vision-capability-truth（新增）、visual-diff、goal-runner、harness-gates、
  feature-artifact-layout
- Affected code:
  `harness/scripts/goal-runner.ts`（backtrack 状态机/drift reconciliation/manifest 冻结/
  journal 收编）、`harness/scripts/utils/{visual-rounds-ledger,critic-receipt-producer,
  vision-capability,confirmation-receipt,verify-feature-completion,quality-axes}.ts`、
  新 utils `{effective-vision-context,intermediate-rounds-journal,mutation-authorization}.ts`、
  `profiles/hmos-app/harness/{visual-diff-nav,visual-diff-hylyre-screenshot,hylyre-spawn,
  hylyre-doctor*,coding-visual-parity-check,spec-ui-spec-check}.ts`、
  `harness/scripts/check-{spec,coding,testing}.ts`、`harness/schemas/*`、
  `specs/phase-rules/*.yaml`、`skills/`（盲档/能力话术对齐）
- **Breaking / MIGRATION.md**：①`vl_multimodal` 终签从此要求 invocation_bound + 逐张验读
  provenance——无解析器 adapter（当前除 claude 外）自动回落 human_gate/盲档；②visual-diff-nav
  2.0：pixel_1to1 P0 屏缺已确认 identity → FAIL（旧数组格式可读但候选未确认前不判过）；
  ③goal 态 agent 侧 harness 不再直写 visual-rounds ledger（journal 代之，交互态不变）；
  ④testing/ut 期产品源码 drift 未命中可信授权链 → HALT（不再仅 testing check FAIL）；
  ⑤`approved_src_mutations` 仅认三源授权 receipt，存量 agent 自签 `approved_by` 失效。
