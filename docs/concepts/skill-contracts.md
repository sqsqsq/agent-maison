# Skill 契约与能力解析

Skill contract 是 feature phase 的可执行输入声明。它定义产生的 artifact、验证入口，以及在 checker 开始前能够确定的能力输入；它不替代 phase rules、quality axes、closure 或 release 的既有裁决。

每个 feature Skill 在 `skills/feature/<skill>/contract.yaml` 中维护契约；`harness/scripts/utils/skill-contract.ts` 负责加载，`check-contract-consistency.ts` 负责静态一致性校验。新增或调整 phase 时，先调整 contract，再调整 checker 与 Skill 文档。

## 输入与 capability

一个 phase 的 `inputs` 只是输入目录：每项由稳定 `id` 和按顺序尝试的结构化 `sources` 组成。

- `artifact` source 精确引用已登记 artifact；不存在时记录为 `absent`，然后尝试下一 source。
- `derive` source 精确引用纯 provider id；不存在的目录或无法推导的输入同样是 `absent`；`invalid` 会停止该 input 的 fallback。
- 不存在字符串 DSL、交互式 ask source、动态 provider 匹配或 input 级 required/optional 政策。

`capabilities` 通过 input id 声明要验证的能力。1.0 包含 `id`、`axis`、`inputs`、`tracks`、可选 `applicability_provider_id` 和缺失策略 `on_missing`；1.1 不接受 `tracks`，改用 `obligation_kinds`，或对不绑定义务的能力显式声明 `input_role: base|enhancement`。base 必须 `on_missing: fail`。

```yaml
inputs:
  - id: acceptance
    sources:
      - kind: artifact
        artifact: acceptance@1
      - kind: derive
        provider_id: derive.requirement
capabilities:
  - id: capability_example_acceptance
    axis: evidence
    inputs: [acceptance]
    tracks: [full]
    on_missing: fail
```

1.0 先运行 track 与命名 applicability provider；1.1 消费调用方已经裁定的义务适用性，unknown（含缺失种类）blocked，not_applicable 不尝试 source。适用后 source 依声明顺序解析：resolved 停止成功，absent 回退，invalid 停止并使 capability blocked。1.1 required 义务缺输入时不能被旧 `on_missing: prune` 降级；可选增强仍可诚实 prune。

## 1.1 调用期内容与接线边界

当前默认 Feature contracts 保持 1.0；1.1 schema、reader 和共享消费接口已经提供，P2/P6 的真实范围/入口接线及 P3–P5 的 phase 契约迁移完成前不切换默认请求。

`resolveCapabilityInputs` 一次返回不可变 `report` 与调用期 `ResolvedPhaseInputs`。后者的 `values` 保存 `ResolvedInput<T>`，`artifacts` 按既有 artifact ID 提供经过同一 schema 和 SpecLoader 规范化的内容；不新增文件或万能 YAML。`InputBinding` 保留 input_id、artifact/derive source、实际 dependencies、source_refs 和规范化内容 SHA-256。报告只序列化 binding/attempts/诊断，不复制 value。每个 input 在一次调用内只解析一次。

`PhaseInputContext` 是 P2/P6 交给共享内核的调用参数，不是新持久状态：subject、已判定的义务、required_outputs、可选 expected_bindings/invalidated_sources。Feature 使用真实 Feature identity，request 使用 request_sha256，两者互斥。绑定不匹配或上游明确宣告来源失效时 blocked，回原有 stale/correction 责任路径；不在解析器内重规划。

artifact 内容先通过注册 schema 与 SpecLoader 既有字段校验。derive 返回实际内容而不是“project_root 可用”标志：requirement 只读当前调用文本，test-targets/codebase 只读显式且项目内的目标文件，adhoc-cases 使用既有用例归一化内核。静态 `DERIVE_PROVIDER_TYPES` 声明返回类型，1.1 每个 fallback 分支必须同类型；文本需求不能作为 acceptance 的等价替代。`derive.blueprint-acceptance/contracts` 的实际字段映射由 P3 实现，不在 P1 注册假 provider。

SpecLoader、CheckContext、verifier 上下文与材料指纹消费同一解析结果。新协议的输入读取面来自实际 attempts/bindings，输出来自本次 required_outputs；旧 REQUIRED/OPTIONAL 文件表只用于未提供新协议上下文的 1.0 路径。evidence 生成时来源已经变化必须报 stale，不能把重新读取的新字节绑定到旧内容。framework 文件不作为 consumer evidence 输入；contract 使用已有 fingerprint。

## Facts 1.1

首个实际 Skill 的 Research 在写代码、审查、UT 规划或设备动作之前建立 `context/facts.md`，`established_by` 记录真实 phase。Feature facts 绑定 feature/run_id；request facts 只绑定 request_sha256，位置为调用方指定的 report-dir/context/facts.md。`FactsInvocationContext` 来自 P2/P6，不能从 facts 自报内容反推建立资格。

后续或成功前驱的基线通过 baseline fingerprint 与来源 dependencies 核验，保留真实 established_by/run 来源，只追加当前 phase_delta。已有 1.0 facts 可经显式 baseline 承接，不能因文件存在自动满足。继续检查 Code Facts、当前目标覆盖、源码可读性、ready_to_produce 和覆盖风险；复用基线不重施后续阶段的全量探索阈值。新建立阶段使用实际 phase 的规则/profile snippets，不冒充 spec。

本次新增调查路径可写在当前 phase_delta 内的「路径 / 事实 / 影响」表，不改写原基线 frontmatter；checker 同时核对原来源绑定及当前实际目标的可读性。

Feature evidence/恢复/verifier 使用同一 facts 路径；request 不调用 Feature receipt/completion writer。旧 pass snapshot 已退役，P1 不恢复它或增加场外状态；旧 backfill 与旧 per-phase exploration reader 保持兼容。

新 facts evidence 条目在既有 manifest 内以 `facts_phase` 标明基线＋本阶段增量投影，后续无关增量不改变它；旧条目仍按原始字节核验。发布前，baseline.dependencies 与 resolved-input 来源共用 exists/sha256 比对，来源变化或删除报既有 stale，不重签新字节。

## 输入读取矩阵与迁移责任（P1）

以下为实施时的读取合同；不是运行状态表。来源列的 `@1` 指 inventory，derive 指静态 provider。所有上游输入都不要求本次重产；需要新裁决/操作时才形成控制依赖，不能把现有 requires 全部改名为 control。当前阶段自己的产物仍需检查。

| 消费面 | 内容/字段 | 现有 reader | 来源与缺失行为 | 本次新产出/真实先行操作 | 绑定与 owner |
|---|---|---|---|---|---|
| spec | 需求原文、范围、代码和视觉参考 | capability-resolution、check-spec、verify-spec | 当前 requirement、源码、参考图；缺必需预期/参考则 blocked | 验收不明确才补 spec；正式需求先蓝图 | binding + 实际输出；P1/P3 |
| plan | spec、criteria/boundaries、源码、ui-spec | SpecLoader、check-plan、verify-plan | 有效验收/获准切片；新设计缺口回责任方 | 仅未满足施工设计要求新 plan；共同决策不能在此重裁 | contracts/design_refs；P1/P3 |
| coding | files/modules/interfaces/state_management、验收、use_cases、视觉契约 | SpecLoader、check-coding、verify-coding | 当前 contracts/验收与源码；required 缺失 blocked | 首次写入前 facts 与真实授权；不要求本次新 plan/spec | binding、源码和写集；P1/P4，投影 P3 |
| review | diff/源码、对照契约、plan、验收、ui-spec | SpecLoader、check-review、verify-review | 真实审查目标；可选设计增强缺失诚实降级 | 已有代码可独立审查；review-report 是本阶段输出 | 输入 binding 与审查证据；P1/P4 |
| ut | criteria/boundaries/ut_layer、use_cases/branches、目标符号、contracts | SpecLoader、check-ut、verify-ut | 有效验收或专项明确目标；不能从代码猜预期 | 必需单元证据；mock/确认等真实控制保留 | 目标与覆盖证据；P1/P5 |
| testing | 用例意图、分层、contracts、review-report、设备/视觉目标 | SpecLoader、check-testing、verify-testing | 有效验收或 adhoc cases；必要输入缺失 blocked | 有设备义务才执行；构建/安装等操作先后保持 | 来源与实际设备输出；P1/P5 |
| change/exit | change 原文与实现 | 旧 capability/SpecLoader/check-change/check-exit | 旧出生协议 artifact/derive | 仅旧运行兼容 | 旧 evidence；P7 |
| 全局知识 | catalog/glossary/Graph/conventions/extension | 各 project checker、profile 与 collectContextFiles | 既有各自真源；optional 缺失不强造 bootstrap | 只完成请求的知识责任 | 实际引用；P6 |
| 首 Skill facts | Code Facts/source_code_paths、ready/risk | context-facts、context-exploration、exploration-strategy | 当前调用 subject 与目标、真实调查；缺/坏 blocked | 写主产物前必须建立或承接 | facts 与来源；P1 内核，P2/P6 派发 |
| 后继 facts/恢复 | 基线、phase_delta、来源新鲜度 | context-facts、goal-checkpoint | 显式 baseline；旧字段缺失不当零义务 | 保留原建立身份，只补当前增量 | 原基线 + 当前源；P1/P2 |
| 静态契约 | inputs/capabilities/produces、provider 返回类型 | check-contract-consistency | 每个分支注册、类型和 producer；1.1 不要求 producer 祖先 | 无运行时结果，不把 producer 存在当本次执行 | contract fingerprint；P1 |
| evidence/closure | 读取路径、输出、来源 fingerprint | phase-evidence-manifest、phase-closure-finalizer | 新协议 attempts + required_outputs；旧表仅兼容 | 真实输出必须存在；request 不签 Feature 凭证 | 同次报告；P1/P2，完成聚合 P7 |
| verifier/hook | 真实内容、facts 路径、材料/范围快照 | collectContextFiles、verifier-material、既有 Stop hook | 调用期内容与同源材料绑定；不另读固定上游文件 | verifier 独立判断；hook 只读 runtime 快照 | P1 内容/材料，P2 快照，P3–P5 prompts |

具体 Feature contract 输入见下表；缺失策略列记录当前 1.0 声明供逐项迁移，1.1 必须再服从本次义务。

| phase | input | 有序来源 | 当前 capability / on_missing |
|---|---|---|---|
| ut | code | derive.codebase | capability_ut_core_context / fail |
| ut | acceptance | acceptance@1 | capability_ut_core_context / fail |
| ut | use_cases | use-cases@1 | capability_ut_use_case_context / prune |
| ut | plan | plan@1 | capability_ut_design_context / prune |
| ut | contracts | contracts@1 | capability_ut_design_context / prune |
| ut | test_targets | derive.test-targets | capability_ut_design_context / prune |
| change | requirement | derive.requirement | capability_change_context / fail |
| change | codebase | derive.codebase | capability_change_context / fail |
| exit | change | change@1 | capability_exit_context / fail |
| exit | implementation | derive.codebase | capability_exit_context / fail |
| review | code | derive.codebase | capability_review_code_context / fail |
| review | spec | spec@1 | capability_review_design_context / prune |
| review | plan | plan@1 → derive.test-targets | capability_review_design_context / prune |
| review | contracts | contracts@1 | capability_review_design_context / prune |
| review | acceptance | acceptance@1 | capability_review_acceptance_context / prune |
| review | ui_spec | ui-spec@1 | capability_review_visual_context / prune |
| coding | codebase | derive.codebase | capability_coding_full_context / fail；capability_coding_lite_context / fail |
| coding | plan | plan@1 | capability_coding_full_context / fail |
| coding | contracts | contracts@1 | capability_coding_full_context / fail |
| coding | acceptance | acceptance@1 | capability_coding_full_context / fail |
| coding | change | change@1 | capability_coding_lite_context / fail |
| coding | spec | spec@1 | capability_coding_spec_context / prune |
| coding | use_cases | use-cases@1 | capability_coding_spec_context / prune |
| coding | ui_spec | ui-spec@1 | capability_coding_visual_context / prune |
| coding | visual_parity | visual-parity@1 | capability_coding_visual_context / prune |
| testing | cases | acceptance@1 → derive.adhoc-cases | capability_testing_cases / fail |
| testing | tested_code | derive.codebase | capability_testing_code_context / fail |
| testing | spec | spec@1 | capability_testing_design_context / prune |
| testing | plan | plan@1 → derive.test-targets | capability_testing_static_plan_context / prune |
| testing | contracts | contracts@1 | capability_testing_design_context / prune |
| testing | use_cases | use-cases@1 | capability_testing_design_context / prune |
| testing | review_report | review-report@1 | capability_testing_design_context / prune |
| plan | spec | spec@1 | capability_plan_context / fail |
| plan | acceptance | acceptance@1 | capability_plan_context / fail |
| plan | codebase | derive.codebase | capability_plan_context / fail |
| plan | ui_spec | ui-spec@1 | capability_plan_visual_context / prune |
| spec | requirement | derive.requirement | capability_spec_requirement / fail |
| spec | codebase | derive.codebase | capability_spec_codebase / prune |
| spec | visual_reference | derive.visual-reference | capability_spec_visual_reference / fail |


### `derive.requirement` 来源表（plan c8e5b3f1 t1）

`derive.requirement` 是 spec 阶段 `capability_spec_requirement` 的唯一来源，按序尝试三段；前一段 `absent` 才落入下一段：

| 顺序 | 来源 | 判据 | resolved 依赖绑定 |
|---|---|---|---|
| ① | goal manifest | `options.requirement` 非空（goal 模式经 `MAISON_GOAL_RUN_ID` 注入） | 空（goal 需求由 manifest 身份与 closure 独立绑定） |
| ② | fidelity-intent SSOT | `state==='valid'` ∧ `requirement_provenance==='explicit_cli'` ∧ `execution_identity === phase:<feature>:spec`（不跨身份导入历史 goal 残留） | 只绑 `spec/reports/fidelity-intent.json`（真实 path + sha256） |
| ③ | `change.md`（legacy） | 文件存在 | `change.md` path + sha256 |

**不解锁**：`intent_fallback` provenance、缺 `requirement_provenance` 字段的旧版 SSOT（legacy 兼容、不判 corrupt）、`state==='corrupt'`（按 absent 继续，不升 invalid）、SSOT 身份与当前阶段不符、feature 根宽泛文本（README/笔记/`spec.md`）——这些都不是权威需求来源。三段全无时 input 为 `absent`、capability 因 `on_missing: fail` 变 `blocked`，`detail` 会列出已尝试来源与两条修复路径（goal 模式经 manifest；手动模式带需求文本重跑 Step 1 的 `fidelity-intent-init --requirement(-file)`）。

## 一次性报告、保证等级与新鲜度

phase runner 在 checker 之前只生成一次不可变 `CapabilityResolutionReport`。报告只描述 artifact/derive 的前置可用性；build、install、device run、trace 等运行时事实仍由 checker 的 `CheckResult` 与 holder 管理，绝不回写报告。

报告据 capability 状态机械计算全局保证等级：`blocked < degraded < full`。`summary.json` 1.2 持久化 `assurance`、`capability_resolutions` 及 `capability_resolution_contract_fingerprint`；不再输出 `summary.depth` 或 quality-depth/missing-input 镜像字段。

为保证 fallback 可审计，evidence manifest 只绑定项目内的 applicability 输入，以及从第一个 source 到 resolved/invalid 终止 source 的每一次实际尝试；framework contract 不以文件路径进入 consumer manifest，而以 `capability_resolution_contract_fingerprint` 留在 summary/closure provenance。缺失的高优先级文件按 `exists:false` 绑定，因此随后出现文件也会使旧 closure stale；未尝试的低优先级 source 不进入绑定。

## 质量轴、closure 和 assess

Capability report 是进入质量轴的唯一桥接：

- `pruned` 不改写 quality axis；它保留在 `assurance`、`capability_resolutions`、报告降级段和 `assess.observed.degradations` 中，后者的 `reason_code=capability_pruned` 仅用于 assess 溯源。
- `blocked` 强制对应轴为 `UNVERIFIED`，并令 release 为 `BLOCKED`、投影视图至少 `INCOMPLETE`；这不能被 visual/asset 的 advance 豁免绕过。其 axis resolution 继续复用既有 `needs_fix/agent/current_phase` 路由。

这些投影不会新增公开 `PRUNED` 状态，也不会覆盖任何既有质量、phase advance、closure 或 release 规则。runner 收尾会以 `assertCapabilityConsumption(report, checks)` 双向对账：每个 active `resolved` capability 恰有一个同 ID `CheckResult`，其他状态没有；重复或反向矛盾均为错误。

Goal manifest 可选提供稀疏的 `minimum_assurance`：`{ phase: degraded|full }`。它只会给 `assess@1` 增加 `insufficient_assurance` gap，绝不成为 release 或 closure waiver。满足 floor 的 `pruned` 会列入 `observed.degradations`，不另造 gap；但若带 producer 指针的上游裁剪令下游 `on_missing: fail` capability 变为 `blocked`，assess 会产生 `pruned` gap 并把回补定向到该 producer phase。

## 维护清单

1. 更新 contract schema 与七个 feature contracts。
2. 确保 input source/provider、capability track/axis 和 artifact producer 可由静态 gate 验证。
3. 确保 resolver report 在同一 phase 内只解析一次，并由 summary、质量轴、evidence 和 assess 共用。
4. 为 fallback、invalid、N/A、blocked、freshness 与双向消费分别提供负例回归。
5. 运行 `cd harness && npm test`。
