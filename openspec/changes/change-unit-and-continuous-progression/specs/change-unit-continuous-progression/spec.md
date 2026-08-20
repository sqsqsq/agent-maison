# Change Unit Continuous Progression Specification

## Purpose

定义 P2 Change Unit 最小契约、蓝图设计切片消费、设计可施工门、Feature ID-only 施工映射、ready/blocker 派生、既有 Goal Mode 单并发连续推进与滚动重派生的 provider-neutral 行为。该 capability 不实现 Component closure/P3，也不建立跨单元运行或完成权威。

## ADDED Requirements

### Requirement: Canonical Change Unit identity has one blueprint owner

凡归属复杂能力蓝图的 Change Unit MUST 使用 `change-unit@1` canonical YAML，唯一位置为 `<project_root>/blueprint/component/<component_id>/change-units/<change_unit_id>.yaml`。`component_id` 与 `change_unit_id` MUST 是安全单路径段；loader MUST 由两个 identity 确定性解析精确路径，不接受调用方任意 path，不扫描 Feature/legacy 目录，不新增全局 registry。按部件装载单元集合时只允许对该 canonical `change-units/` 目录的 YAML 做稳定排序枚举。

根 `component_id`/`change_unit_id` MUST 与 path 一致，并包含正整数 `revision`。`component_blueprint_ref` MUST 指向 `target.kind: blueprint`，且一个 CU MUST 只归属一份蓝图。根 `provenance` MUST 复用 P1 的 `source_kind/source_ref/source_revision?/observed_at/evidence_strength/extraction_method` 结构并指向正式蓝图/权威输入：`source_ref` MUST 是 owner blueprint canonical ref 或已由该 P1 blueprint 收录的来源；外部来源若声明 `authoritative`，MUST 位于 P1 authoritative provenance 覆盖下。Provider 身份不得冒充权威来源。根对象 MUST NOT 含可手改 `execution.feature_id`、`status`、`ready`、`completed`、P2 选择队列或 P3 closure 字段；蓝图 MUST NOT 反向登记 CU 运行状态。

P2 SHALL 以 `cu-` + `base64url(UTF-8(component_id + "\0" + change_unit_id))` 派生唯一 Feature identity，不接受 authored override。安全 identity 不含 NUL 且 base64url 可逆，因此不同 CU identity MUST NOT 复用同一 Feature；若派生 Feature 路径已绑定其它 `change_unit_ref`，或已有非空 Feature 未绑定当前 CU，identity gate MUST fail-closed，不得接管。

#### Scenario: Canonical CU resolves deterministically

- **WHEN** consumer 以 `component_id=ledger-app`、`change_unit_id=cu-ledger-write` 装载 CU
- **THEN** loader 只读取 `blueprint/component/ledger-app/change-units/cu-ledger-write.yaml`，并校验 path/YAML identity 与唯一 blueprint owner

#### Scenario: Manual status ledger is rejected

- **WHEN** CU YAML 自报 `ready: true`、`status: done` 或 `component_closure: pass`
- **THEN** schema/validator 必须 fail-closed，且这些字段不得影响 ready、完成或 closure 结论

#### Scenario: Duplicate Feature identity cannot be authored

- **WHEN** 两个 CU 试图通过 `execution.feature_id` 指向同一 Feature，或派生 Feature 路径已绑定另一 CU
- **THEN** schema 拒绝 override 或 identity gate 报绑定冲突；不得让两个 CU 共享一份完成事实

> **Enforced by (P2 implementation):** `harness/schemas/change-unit.schema.json`, `harness/scripts/utils/change-unit-path.ts`, `harness/scripts/utils/change-unit-validator.ts`

### Requirement: Change Unit minimum contract proves an independent bounded transformation

CU MUST 声明非空 `purpose`、至少一个 `provides`、至少一个 `design_ref`、`touches` 及所有权、`preserved_invariants`、`target_predicates`、`verification_refs`、非空 `safe_intermediate_state` 和 `priority`。`preconditions`、`requires`、`blockers` 允许在语义确实不存在时为空；需要前置或 blocker 却以空数组绕过 MUST 阻塞。CU MUST 定义稳定 `predicate_id`/`provide_id`、相关 design refs 和验证义务，但 MUST NOT 在 Feature plan 产生前要求或编造文件、符号、测试落点。

单元 MUST 能解释独立合入后为何可构建、兼容、受控隐藏或可恢复，且每项 target predicate MUST 有本单元 provide 与 verification obligation。CU design gate 只裁决该定义是否可施工；具体文件/符号/测试映射由 Feature mapping gate 负责。无法形成安全中间态、必须依赖未来单元才可解释当前正确性的工作 MUST 合并或重新拆分，不得取得设计可施工或 completion 资格。

#### Scenario: Vertical unit has a safe intermediate state

- **WHEN** CU 包含一次可独立验证的账目写入主链，并声明写集 owner、不变量、目标谓词和恢复边界
- **THEN** validator 接受其有界变换契约，后续 design gate 仍须验证蓝图 refs 与施工投影

#### Scenario: Layer-only shell cannot stand alone

- **WHEN** CU 只创建无人消费的 Store/EventBus/接口，且把真实 consumer 与验证推迟到未来单元
- **THEN** safe-intermediate-state/target-predicate 门必须失败，不能因 YAML 字段齐全而放行

> **Enforced by (P2 implementation):** `harness/schemas/change-unit.schema.json`, `harness/scripts/utils/change-unit-validator.ts`, `harness/scripts/utils/change-unit-design-gate.ts`

### Requirement: Design refs resolve through the current canonical blueprint

`design_refs` MUST 统一使用 P1 `component_blueprint_ref`，可引用 blueprint、view/node、relation、flow、decision、contract；MUST NOT 新增 per-view refs 或复制蓝图正文。对于尚未完成 CU，owner ref 与所有 design refs 的 component、blueprint、revision、`source_fingerprint`、`artifact_sha256` MUST 完全一致并指向当前 canonical blueprint；每个 target MUST 经 P1 canonical schema/完整性门和 stable address index 真实解析。

尚未完成 CU 的蓝图 revision/source/artifact 任一不匹配、target 悬空、relation/decision/contract 不存在、或 hash 匹配但蓝图结构非法时，CU MUST 标为 stale/invalid 并退出 ready set。已完成 CU 保留原始 binding，并按 Reconciliation requirement 对当前稳定 target 做“整体 carry-forward 或不满足依赖”的派生；P2 MUST 自行重派生，不要求 P1 修改 ready set。

#### Scenario: Mixed blueprint revisions are rejected

- **WHEN** 尚未完成 CU 的 owner ref 指向 blueprint revision 3，但某个 flow design ref 仍绑定 revision 2
- **THEN** design gate 必须报告 stale identity mismatch，不得解析到“同名”当前 flow 后继续

#### Scenario: A dangling decision ref blocks execution

- **WHEN** design ref 指向 `decision:not-real`，当前 canonical blueprint 没有该稳定对象
- **THEN** CU 不得进入 Feature spec/plan/Goal Mode，错误必须定位该 ref

> **Enforced by (P2 implementation):** `harness/scripts/utils/component-blueprint-path.ts`, `harness/scripts/utils/blueprint-addressing.ts`, `harness/scripts/utils/change-unit-design-gate.ts`

### Requirement: Design constructability is derived from the current delta closure

设计可施工门 SHALL 从 CU target predicates、touches 和 design roots 结合蓝图 stable address index/cross-view/runtime links 派生当前 delta 的必需引用闭包，不接受 `design_ready: true` 自报。每个 touches 写集 MUST 映射到 development owner/node；每个被改变节点的 design basis relation/decision/contract、相关关键 scenario 步骤、适用视图和因 delta 改变的跨视图关系 MUST 在闭包中可解析。

当前闭包内 unknown、open decision、blocker、无权威依据决定或未准入外部契约 MUST 阻塞；闭包外远期 CU 的 open decision 在具有 owner/needed-by 时 MUST NOT 阻塞当前 CU。施工发现足以推翻蓝图的新事实 MUST 返回 blueprint reconciliation，不得由 Feature plan 首次发明部件级模型、主链或外部契约。

#### Scenario: Omitted changed cross-view relation blocks

- **WHEN** CU touches 的 development node 改变某 runtime flow owner，但 design refs 未包含蓝图已声明的对应 cross-view relation
- **THEN** derived closure 必须报告缺失关系，不能用“其它视图无关”自报绕过

#### Scenario: A future decision does not block the current slice

- **WHEN** 蓝图存在一个仅供远期报表 CU 的 open decision，具备 owner/needed-by，且不在当前 CU 的引用闭包
- **THEN** 当前 CU 可在其它门均通过时进入 ready set，该远期决定仍原样保留

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-design-gate.ts`, `harness/scripts/utils/blueprint-cross-view.ts`, `harness/scripts/utils/runtime-data-flow-check.ts`

### Requirement: Feature artifacts bind the exact Change Unit revision

归属 CU 的派生 Feature MUST 在机器施工契约中携带 `change_unit_ref`，至少包含 `artifact: change-unit@1`、component/unit identity、正整数 revision 与 CU canonical YAML 原始字节 `artifact_sha256`。`contracts.yaml.change_unit` MUST 只按 canonical CU 的稳定 ID 保存施工映射：每个 `predicate_id`/`provide_id` 映射到真实 implementation/test refs，每个完整 `design_ref` 映射到 implementation/verification refs。Feature MUST NOT 复制或重新定义 CU purpose、predicate/provide 描述、verification obligation，也不得映射 canonical CU 中不存在的 ID。

`spec.md`/`acceptance.yaml` SHALL 以引用方式解释 purpose、用户可见语义和目标谓词；`plan.md` SHALL 精确展开当前 delta。CU design gate 负责 predicate/provide/design-ref/验证义务是否形成可施工设计；Feature mapping gate MUST 独立验证 canonical CU 中每个 required ID 都有具体文件/符号/测试落点且没有未知 ID。Feature 产物不得复制完整 review summary、全部 design views、全量 decisions/flows 或把 `contracts.yaml` 升级为第二蓝图。CU/派生 Feature/Goal Mode identity MUST 一致；CU revision/hash 变化后，旧 Feature mapping 即 stale。

#### Scenario: Feature projection is bound and minimal

- **WHEN** plan 阶段为 `cu-ledger-write` 生成施工产物
- **THEN** contracts 的 ID-only mappings 可精确追到 canonical CU 定义和真实文件/符号/测试，plan 解释当前 delta，且产物不复制 CU 定义或整份蓝图

#### Scenario: Feature cannot redefine a predicate

- **WHEN** contracts 为已有 `predicate_id` 复制一份不同描述，或映射一个 canonical CU 不存在的 predicate
- **THEN** Feature mapping gate 必须失败；修改定义只能发布新的 CU revision

#### Scenario: Old feature artifacts cannot satisfy a revised CU

- **WHEN** CU YAML 升至 revision 2 并改变字节 hash，而 Feature contracts/completion 仍绑定 revision 1
- **THEN** P2 必须把施工投影判为 stale，旧完成事实保留但不得满足 revision 2

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `specs/artifact-schemas/use-cases.schema.yaml`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`

### Requirement: Runtime flow construction projection preserves conditional closure

CU MUST 只保存 P1 runtime flow/design 的稳定 refs，不得新增或复制 `runtime_flow_slices`、trigger、mutation、publication、subscription、consumer 等运行时细节。Feature 施工阶段 SHALL 继续以既有 `contracts.state_management` 作为运行时事实唯一权威，并通过 `design_ref_mappings` 将其 owner、文件/符号和测试追到 P1 flow/node/relation/decision/contract 地址；use-case、plan 或 DAG 不得反向重定义这些事实。

对 CU-bound Feature，`use-cases.yaml` 的必需性 MUST 从 canonical CU/蓝图 refs、acceptance 与 `contracts.state_management` 机械派生，不接受 authored `required` boolean。存在任一事实即为必需：两个及以上有序用户/系统/外部步骤；失败、重试、恢复或补偿分支；同一状态有两个及以上消费者；生命周期、后台、定时或外部触发要求重建、恢复或新鲜度调和。`dag_required` MUST 独立从 unit/both 验证事实派生：目标跨至少两个有序实现/边界步骤、含分支/恢复/补偿，或运行时传播涉及多个 consumer 时，必须生成并链接对应 use-case/branch 的 ephemeral flow DAG；简单单步路径可继续使用直接 UT tags/AC coverage。

只读/首次加载 flow MUST NOT 为过门禁伪造 mutation/publication/subscription；一旦 `contracts.state_management` 声明 mutation，传播必须闭合到受影响 consumer；一旦声明 subscription，必须有当前快照/replay 与 cleanup；后台/外部写入必须有持久化和恢复裁决。

首次建立或重构共享运行时主链的 CU MUST 同时包含权威来源/持久化、状态 owner、发布或失效语义、至少一个真实 consumer 与可执行验证，不得拆出无消费者的空 Store/EventBus 横向单元。

#### Scenario: Read-only initial load stays honest

- **WHEN** 当前 CU 只实现首次加载与只读展示，蓝图 flow 没有 mutation 或 subscription
- **THEN** `contracts.state_management` 只需证明 load/owner/consumer/failure，不得制造虚假写入和订阅；若同时无多步/分支/共享/lifecycle 事实，use-case/DAG 可省略

#### Scenario: Publication without an affected consumer blocks

- **WHEN** CU 投影了 mutation 和新 publication，但没有任何受影响 consumer 订阅、失效重查或其它可追溯传播路径
- **THEN** runtime construction gate 必须失败并定位 orphan publication/consumer 链

#### Scenario: Recovery facts mechanically require use-case and DAG

- **WHEN** unit/both 目标含跨两个实现步骤的后台恢复分支
- **THEN** use-case 与 ephemeral DAG 均为 BLOCKER 级必需，并链接该恢复 branch；作者不能用 `required: false` 降级

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-ut.ts`

### Requirement: Requires, provides, and blockers are explicit construction facts

首版每个 `provides[]` 项 MUST 有部件内稳定 `provide_id`；每个 `requires[]` 项 MUST 显式声明精确 `provide_id` 与 `from_change_unit_id`。匹配 MUST 是同一 component/blueprint 下的精确 identity 对账，不得按名称相似、priority、实际执行顺序、plan `goal_requires` 或 capability seam 依赖推导。

`blockers[]` MUST 包含 id、影响门槛、owner、原因、解除条件和 source refs；机器可观测解除条件 MUST 有 probe，只有真正需要人类判断/授权的 blocker 才允许没有 probe。`file_exists` probe MUST 使用通过既有 project-relative path 校验的工程内引用，工程外路径不得解除 blocker。blocker 的活动性 MUST 从 probe/权威事实重算，不接受 `resolved: true` 或手工 done 台账。

#### Scenario: Exact provider completion satisfies a require

- **WHEN** B requires A 的 `provide_id=ledger-storage@1`，A 声明同一 provide、A 的派生 Feature completion 经权威入口为 VALID，且 A 的全部历史 design target 在当前蓝图仍可解析并获准
- **THEN** B 的该施工前置满足；临时执行顺序、同名字段和未通过全量 target 重校验的历史 provide 不参与满足判断

#### Scenario: Dependency namespaces cannot cross-match

- **WHEN** CU require 只在 plan `goal_provides` 或 Maison provider seam 中出现，而没有显式 CU provider
- **THEN** require 保持未满足并阻塞，工具不得把三个命名空间合成一张图

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-dependencies.ts`, `harness/scripts/utils/change-unit-blockers.ts`, `harness/scripts/utils/change-unit-validator.ts`

### Requirement: Completion observation distinguishes absence from stale or invalid evidence

P2 SHALL 先从 CU identity 派生 Feature identity，再只从既有权威解析 expected completion：workflow 由 `resolveWorkflowSpec()` 读取，track 由 `resolveFeatureTrack(loadFeatureTrackDecl())` 解析，chain 由 `featurePhasesFromWorkflow()` 解析。P2 MUST NOT 信任 completion artifact 自报的 chain/track。

P2 adapter SHALL 暴露 `ABSENT|VALID|STALE|INVALID`，但不持久化该 verdict。没有 completion projection，且既有 reducer/`run_end` 权威事实未表明成功跨过 completion 生成边界时，observation MUST 为 `ABSENT/not_completed`，覆盖从未启动、active、failed、paused 或 awaiting-human；若权威终局事实已声称完成但 projection/original 缺失，observation MUST 为 `INVALID`。projection 存在时，P2 MUST 以独立解析的 expected chain/track 调用既有 `verifyFeatureCompletion()`，并原样保留其 `VALID|STALE|INVALID` 结果。

#### Scenario: Never-run Feature is absent, not corrupt

- **WHEN** a derived Feature has no run and no completion projection
- **THEN** completion observation is `ABSENT/not_completed`, so the CU may be considered for ready derivation if all other gates pass

#### Scenario: Valid completion uses workflow and track SSOT

- **WHEN** a completion is valid for the track resolved from `feature.yaml` and the chain resolved from the current workflow
- **THEN** the adapter reports `VALID` only after `verifyFeatureCompletion()` passes with those independently derived expectations

#### Scenario: Tampered or missing completed evidence is invalid

- **WHEN** a completion projection is tampered, or an authoritative terminal run claims completion but the required projection/original is missing
- **THEN** the adapter reports `INVALID`, not `ABSENT`, and the provider CU cannot satisfy downstream requires

> **Enforced by (P2 implementation):** `harness/workflow-loader.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/change-unit-completion.ts`

### Requirement: Ready set is derived from blueprint, blockers, and authoritative completion

P2 SHALL 每次从有效 CU artifacts、当前 blueprint identity、design gate、blocker probes、派生 Feature 的现有 Goal Mode run 状态与四态 completion observation 重建 gate-specific ready set。execution-ready CU MUST 绑定当前 blueprint revision、设计可施工、全部 requires 已由 `VALID` 且对当前蓝图仍有效的 provider CU 满足、无 design/execution blocker、且同部件没有应优先恢复的 active Goal run。`ABSENT` 表示首次/继续执行候选；`STALE` 仅在当前 CU/design/Feature mapping 已重新校验后表示重执行候选；`INVALID` 表示证据完整性故障并阻塞，三者 MUST NOT 混成同一原因。

ready set MUST 只表示当前可选择，可以含多个单元，但 MUST NOT 表示并发授权。派生结果、报告或缓存 MUST 可删除后重建；provider 退出、蓝图/CU hash 变化或完成事实变化时 MUST stale 并重新派生。文件存在、Markdown 结论、CU 自报或未经验证的 completion MUST NOT 放行。

#### Scenario: Fake ready and fake done do not pass

- **WHEN** CU 自报 ready，或 Feature 目录存在 `feature-completion.json` 但验证入口返回 STALE/INVALID
- **THEN** 该 CU 不得被视为完成或 ready，结果必须给出对应权威失败原因

#### Scenario: Multiple candidates remain a set

- **WHEN** 两个 CU 都满足 execution 前置且互无严格依赖
- **THEN** 两者都出现在 ready set；selector 最终只选择一个，且不得回写虚假依赖边

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-progress.ts`

### Requirement: Execution-precedence cycles and silent stalls fail closed

由 `requires.from_change_unit_id` 派生的 execution-precedence 投影 MUST 无环。P2 SHALL 对该有向投影做确定性 cycle/SCC 检测，报告环成员和边，并阻止环内单元取得 ready；MUST NOT 对冲突、组合验证或描述性关系的概念并集误做同一环检。修复必须路由为冻结契约/可信 seed 或 fake、协调、合并/重拆 CU，不得靠写死执行顺序掩盖循环。

每个未完成目标 MUST 能追到 ready CU 或带 owner、门槛、解除条件和来源的合法 blocker。存在未完成目标但无 active run、无 ready CU、无合法 blocker时，P2 MUST 报 `silent_progress_stall`，不得把空集合解释为完成或进入 P3。

#### Scenario: Circular requires are rejected

- **WHEN** A requires B 的 provide，同时 B requires A 的 provide
- **THEN** execution-precedence 检测必须报告 A/B 环并不给任一 ready 资格

#### Scenario: Empty ready set is not completion

- **WHEN** 所有 CU 均未完成、ready set 为空且没有合法 blocker
- **THEN** P2 必须报告静默停滞，不得宣称 component ready/closed

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-dependencies.ts`, `harness/scripts/utils/change-unit-ready-set.ts`

### Requirement: Selection is deterministic and first-version execution is single-concurrency

首版 selector SHALL 按较小整数 `priority` 优先、再按 `change_unit_id` Unicode code-point 升序稳定选择；priority 仅是选择提示，MUST NOT 推导或回写依赖。一次 progression 决策最多选择一个 CU；存在 active/awaiting-resume Goal run 时 MUST 返回 resume/wait，不启动另一个 CU。

P2 不提供多 writer/distributed lock 保证，不新增锁或常驻 scheduler。只有真实宿主证明并发收益且写集、迁移、共享环境、契约和恢复风险可控后，才能另行立项增加实际并发。

#### Scenario: Stable tie-break selects one

- **WHEN** ready set 含同 priority 的 `cu-b` 与 `cu-a`
- **THEN** selector 只选择 `cu-a`，`cu-b` 保持 ready，结果不生成 `cu-a -> cu-b` 关系

#### Scenario: Active Goal run prevents a second launch

- **WHEN** 当前部件任一 CU 已有未终局 Goal Mode run
- **THEN** progression 返回该 run 的恢复/等待动作，不调用另一 Feature

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-selection.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`

### Requirement: Thin progression reuses Goal Mode facts and recovery

薄推进循环 MUST 只做“读取事实→派生→选择一个→调用既有 Goal Mode→重新读取”。选中 CU 的派生 Feature identity MUST 与 Goal manifest/Feature artifacts 一致；传给 Goal Mode 的 requirement MUST 绑定 canonical CU path/ref/hash，并要求 phase 读取正式 CU 与蓝图，而不是复制其正文。

单元完成 MUST 只认现有 `verifyFeatureCompletion()=VALID` 及与当前 `change_unit_ref` 一致的施工契约；失败、暂停、待人工、resume、retry 和 Feature 内 backtrack MUST 继续由既有 Goal Mode events/reducer/receipt/evidence 负责。循环中断后 MUST 可通过重读这些事实恢复，不得创建跨单元 checkpoint/ledger 或直接写 completion。

caller 返回 `completed` 后，薄循环 MUST 立即重读当前 CU completion；若结果不是 `VALID`，MUST 以 no-progress blocker 停止，且 MUST NOT 再次选择同一 CU。caller 返回值本身不得充当完成事实。

#### Scenario: Three dependent units progress continuously

- **WHEN** fixture 有 A→B→C 三个合法 CU，fake Goal Mode 每次为选中 Feature 产生可验证 completion
- **THEN** 薄循环依次派生并调用 A、B、C，每次只启动一个，且三次完成均由既有验证入口确认

#### Scenario: Failed unit stops the outer loop

- **WHEN** Goal Mode 对当前 CU 返回失败、暂停或 awaiting-human 且无 VALID completion
- **THEN** P2 停止选择新 CU，返回同一 run 的恢复/阻塞信息，不把失败投影成 provides 已满足

#### Scenario: Completed return without completion fact makes no progress

- **WHEN** caller 返回 `completed`，但重读后当前 CU completion 仍为 ABSENT、STALE 或 INVALID
- **THEN** P2 立即返回 no-progress blocker，只调用该 CU 一次，不循环重启同一 Feature

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

### Requirement: Reconciliation re-resolves stable targets without a semantic diff engine

蓝图 revision、`source_fingerprint` 或 `artifact_sha256` 变化时，尚未完成 CU 的旧 blueprint binding/design gate/ready projection MUST stale；CU revision/hash 变化时，旧 Feature projection MUST stale。下游 SHALL 从新 identity 自行重新派生，P1 MUST NOT 创建、修改或移除 P2 ready set。

已完成 CU 的 canonical artifact、原始 blueprint/design refs、Goal Mode events/receipt/evidence/completion MUST 保留，MUST NOT 因重新规划改回 pending 或原位升 revision。P2 SHALL 以历史 refs 的每个稳定 target `kind/id/view_id?` 构造当前 blueprint ref，并只复用当前 P1 resolver/admission：仅当全部 target 在当前有效蓝图中仍可解析且仍获准、无 unknown/open decision/blocker 时，整个 CU 的历史 provides 才 carry forward。任一 target 缺失、因替换而原 ID 不再解析、当前 disposition 为 unknown/open decision/blocker，或蓝图/相关设计未准入时，历史 provides MUST NOT 满足依赖，未来 CU MUST 阻塞并回到 P1 调和。

首期判定 MUST 是全有或全无的地址/准入重校验，不得假设 P1 存在 semantic diff、`invalidates` 或 decision-flip 引擎，也不得新增此类 registry/ledger。结果 MUST 可从正式产物和当前蓝图重建。纠正已完成结果 MUST 创建新的 `change_unit_id`，可通过 `revises`/`supersedes` 引用旧 `change_unit_ref`；只有尚未实施 CU 可在蓝图调和后原位升 revision。P2 MUST NOT 创建或修改 P3 closure 状态。

#### Scenario: Every historical target still resolves and remains admitted

- **WHEN** 蓝图升 revision 后，已完成 CU 的全部历史 target ID 在当前有效蓝图仍可解析且仍获准
- **THEN** 该 CU 的 provides 可整体 carry forward，同时保留原始 CU 和完成事实

#### Scenario: Missing or unresolved historical target returns to P1

- **WHEN** 任一历史 target ID 缺失/被替换，或当前对象为 unknown、open decision、blocker 或未准入
- **THEN** 该 CU 的 provides 不满足未来依赖，相关推进阻塞并请求 P1 调和；P2 不猜测语义等价

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-reconciliation.ts`, `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/utils/component-blueprint-path.ts`

### Requirement: First host evolution seam lands as one vertical Change Unit

当 CU 首次落实蓝图中获批的宿主演进接缝 decision 时，同一 CU MUST 覆盖稳定契约、首个真实 Provider、真实 Consumer 与契约测试，且具备真实 target predicates、touches 与 verification refs；空接口横向 CU MUST 被拒绝。后续 Provider MAY 是独立 CU，但 MUST 继续引用该权威 decision，并以精确 `requires.from_change_unit_id + provide_id` 消费已落地稳定契约。前置 CU MUST 引用同一 evolution decision，且该 `provide_id` MUST 由其 contract predicate 单独绑定；被所有 predicates 共用的整单元 outcome 不得冒充稳定契约。P2 MUST NOT 以 priority 或 Consumer/Provider 描述字符串推断 Provider 演进顺序；若契约或 Consumer 必须变化，该 delta MUST 由当前获准 design/decision refs 明示，否则先触发蓝图调和、契约版本化或迁移裁决。

#### Scenario: First seam slice is complete

- **WHEN** 蓝图批准把记账来源作为接缝且当前尚未落地
- **THEN** 首个 CU 同时施工 contract、首个真实来源 Provider、实际记账 Consumer 和 contract test，不能只提交 interface/factory

#### Scenario: Provider evolution is not inferred from prose or priority

- **WHEN** 两个 Provider CU 的 priority 或 Consumer 描述字符串暗示先后，但没有权威 decision ref 与精确 contract require/provide 关系
- **THEN** P2 不得推断 Provider 演进；只有明确依赖和当前获准 design refs 参与施工与调和裁决

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-evolution-seam.ts`, `harness/scripts/utils/change-unit-design-gate.ts`, `harness/scripts/check-review.ts`

### Requirement: P2 capability seams have explicit provider lifecycle contracts

P2 稳定内核 MUST 只依赖以下 capability seams；首期每个 seam 只接一个静态内置 Provider，不建立动态 loader、registry 或插件包。Seam Card 如下：

| 接缝 | Definition | Consumer | Provider | required/optional | 缺失行为 | 替换、退出与冲突 | 权威、来源与冲突规则 |
|---|---|---|---|---|---|---|---|
| CU decomposition | 输入已准入 blueprint 与近期目标，只输出内存/临时报告中的候选；consumer 校验 schema、设计闭包、provenance 与来源权威后才写 canonical CU | P2 Skill/设计者 | 内置纵切拆分策略 | optional | 不自动拆分；人工/Agent 可直接提交候选并走同一 consumer validator，不得把缺失当已拆分 | 替换只影响未接受候选；退出清理候选/临时报告，不删除已接受 canonical CU；同一请求多 Provider 冲突即失败 | 蓝图/权威事实是来源，canonical CU provenance 复用 P1 结构；Provider 只可记入 extraction method，不得自称权威或直接写 canonical/完成事实 |
| Relation and ready analysis | 输入合法 CU、当前蓝图 identity、blocker probes 与既有 Goal Mode 完成事实，输出 dependencies/ready/blocker 派生 | progression core | 内置 exact requires/provides analyzer | required | 自动推进形成带 owner/解除条件 blocker，不自报 ready | 替换后所有派生结果失效重算；退出不删除 CU/完成事实；重复权威 analyzer fail-closed | CU/蓝图/Goal Mode facts 分别保持权威；analyzer 不写回任何真源，不跨三个依赖命名空间匹配 |
| Candidate selection | 输入 ready set，输出最多一个 selected 及解释 | thin progression loop | 内置 priority + stable id selector | required（自动推进） | ready set 可展示，但自动启动阻塞，不随机选择 | 替换只改变未来选择，不改依赖或历史；退出清理派生建议；重复权威 selector fail-closed | ready set 是 analyzer 派生；priority 来自 CU，实际顺序只进 Goal Mode 执行轨迹，冲突不得 last-write-wins |

required provider 缺失 MUST 形成结构化 blocker；optional provider 缺失 MUST 诚实降级。任何 provider MUST NOT 直接修改 canonical CU、Goal Mode events/receipt/evidence/completion；只有 consumer validator 可接受候选并原子写正式 CU。provider 退出时，未接受候选被清理，正式 CU 保留，派生 ready/建议失效重算。

#### Scenario: Optional decomposition provider is absent

- **WHEN** 自动拆分 provider 不可用，但仓内已有人工评审并通过 validator 的 CU artifacts
- **THEN** P2 可继续设计门与 ready 派生，同时明确没有自动拆分能力，不得丢弃正式 CU

#### Scenario: Provider exit removes only unaccepted candidates

- **WHEN** decomposition Provider 退出且同时存在临时候选与已被 consumer 接受的 canonical CU
- **THEN** 临时候选被清理，canonical CU 连同 provenance 保留；不得因 Provider 生命周期删除正式契约

#### Scenario: Required analyzer conflict fails closed

- **WHEN** 同一推进请求被接入两个都声称权威且结果冲突的 relation analyzer
- **THEN** consumer 必须拒绝推进并报告双方，不能按注册或调用顺序采用后者

> **Enforced by (P2 implementation):** 本 capability spec 的 Seam Card、`harness/scripts/utils/change-unit-provider-boundary.ts`, `skills/project/change-unit-progression/SKILL.md`

### Requirement: Compatibility and P2/P3 boundaries remain explicit

无 `change_unit_ref` 的既有独立 Feature MUST 保持现有 spec/plan/Goal Mode 行为，不因 P2 缺蓝图而失败；它在显式归属前 MUST NOT 参与 Component closure。P2 SHALL 输出 `ready_for_component_closure` 作为“没有未完成 CU 且当前事实可交给 P3 评估”的派生动作，但 MUST NOT 宣称 closure pass、创建 closure artifact 或聚合跨单元覆盖。

P2 MUST NOT 创建跨单元 ledger、常驻 daemon、全局事件日志、第二恢复目录、通用图执行器或动态 provider 系统。framework fixture 通过只证明机械契约；真实宿主语义验收必须使用 AI 记账真实蓝图、真实依赖 CU、真实 build/test/evidence。

#### Scenario: Legacy standalone Feature remains valid

- **WHEN** 消费者运行一个不属于复杂能力蓝图的既有小 Feature
- **THEN** 其现有 Goal Mode/phase 门行为不变，P2 不要求补造 CU；该 Feature 也不会被 P3 当作某蓝图单元

#### Scenario: Last CU completion is not component closure

- **WHEN** 当前蓝图所有登记 CU 都有 VALID completion
- **THEN** P2 只返回可进入 P3 评估，不能自行宣称目标/风险/跨视图/运行时边已经全部闭环

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-progress-loop.ts`, `skills/project/change-unit-progression/SKILL.md`; P3 enforcement 由后续独立 change 承担
