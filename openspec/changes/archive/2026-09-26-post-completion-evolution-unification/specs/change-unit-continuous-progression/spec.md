## MODIFIED Requirements

### Requirement: Completion observation distinguishes absence from stale or invalid evidence

CU completion SHALL 先从 CU identity 派生 Feature identity，再独立验证真实 Goal run 的冻结执行范围、出生绑定与当前 CU 目标覆盖，解析 expected completion；MUST NOT 信任 completion artifact 自报的范围或按当前 workflow/track 重算新协议 expected chain。旧出生协议才沿既有 `resolveWorkflowSpec()`、`resolveFeatureTrack(loadFeatureTrackDecl())`、`featurePhasesFromWorkflow()` 兼容路径解析。

P2 adapter SHALL 从唯一完成评估入口 `assessFeature` 投影 `ABSENT|VALID|INCOMPLETE|INVALID`，但不持久化该结果。评估入口给出记录三态（`absent` / `ok` / `broken`）与逐义务 `covered|uncovered`：没有 completion projection，且既有 reducer/`run_end` 权威事实未表明成功跨过 completion 生成边界时，observation MUST 为 `ABSENT/not_completed`，覆盖从未启动、active、failed、paused 或 awaiting-human；若权威终局事实已声称完成但 projection/original 缺失，或记录为 `broken`（凭证不可信），observation MUST 为 `INVALID`；记录 `ok` 且 `complete` 时为 `VALID`；记录 `ok` 但存在 uncovered 义务或 blocking 世界事实时为 `INCOMPLETE`，并原样附 uncovered 清单（义务、责任阶段、`binding|evidence|result|unknown` 类别与原因）。输入过期（绑定 stale、复用证据失效、Feature↔CU 精确绑定失配）只表现为 uncovered 义务，MUST NOT 判成 `INVALID`。projection 存在时，P2 MUST 以独立验证的 expected scope（旧协议为 chain/track）调用评估入口，不另跑第二道投影门。

#### Scenario: Never-run Feature is absent, not corrupt

- **WHEN** a derived Feature has no run and no completion projection
- **THEN** completion observation is `ABSENT/not_completed`, so the CU may be considered for ready derivation if all other gates pass

#### Scenario: Valid completion uses independently verified scope

- **WHEN** a completion is valid for the real run's independently verified frozen scope and current CU target coverage
- **THEN** the adapter reports `VALID` only after `assessFeature` finds the record `ok` and every required obligation `covered` under those independently derived expectations

#### Scenario: Tampered or missing completed evidence is invalid

- **WHEN** a completion projection is tampered, or an authoritative terminal run claims completion but the required projection/original is missing
- **THEN** the adapter reports `INVALID`, not `ABSENT`, and the provider CU cannot satisfy downstream requires

#### Scenario: Changed inputs make obligations uncovered, not invalid

- **WHEN** a completed CU's blueprint pointers were bumped in place, or its acceptance input changed, while the completion record itself is intact
- **THEN** the adapter reports `INCOMPLETE` with the affected obligations `uncovered` (for example the plan obligation as `binding` when `contracts.yaml` `change_unit_ref` no longer matches the canonical CU), not `INVALID`

> **Enforced by (P2 implementation):** `harness/workflow-loader.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/feature-assessment.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/change-unit-completion.ts`

### Requirement: Ready set is derived from blueprint, blockers, and authoritative completion

P2 SHALL 每次从有效 CU artifacts、当前 blueprint identity、design gate、blocker probes、派生 Feature 的现有 Goal Mode run 状态与四态 completion observation 重建 gate-specific ready set。execution-ready CU MUST 绑定当前 blueprint revision、设计可施工、全部 requires 已由 `VALID` 且对当前蓝图仍有效的 provider CU 满足、无 design/execution blocker、且同一 `blueprint_id` 工作区没有应优先恢复的 active Goal run。`ABSENT` 表示首次/继续执行候选；`INCOMPLETE` 表示完成后修正候选，合法重执行范围只取评估入口给出的 uncovered 义务及其责任阶段；`INVALID` 表示证据完整性故障并阻塞，三者 MUST NOT 混成同一原因。

ready set MUST 只表示当前可选择，可以含多个单元，但 MUST NOT 表示并发授权。派生结果、报告或缓存 MUST 可删除后重建；provider 退出、蓝图/CU hash 变化或完成事实变化时 MUST stale 并重新派生。文件存在、Markdown 结论、CU 自报或未经验证的 completion MUST NOT 放行。

#### Scenario: Fake ready and fake done do not pass

- **WHEN** CU 自报 ready，或 Feature 目录存在 `feature-completion.json` 但评估入口判为 INCOMPLETE/INVALID
- **THEN** 该 CU 不得被视为完成或 ready，结果必须给出对应权威失败原因

#### Scenario: Multiple candidates remain a set

- **WHEN** 两个 CU 都满足 execution 前置且互无严格依赖
- **THEN** 两者都出现在 ready set；selector 最终只选择一个，且不得回写虚假依赖边

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-progress.ts`

### Requirement: Thin progression reuses Goal Mode facts and recovery

薄推进循环 MUST 只做“读取事实→派生→选择一个→调用既有 Goal Mode→重新读取”。选中 CU 的派生 Feature identity MUST 与 Goal manifest/Feature artifacts 一致；传给 Goal Mode 的 requirement MUST 绑定 canonical CU path/ref/hash，并要求 phase 读取正式 CU 与蓝图，而不是复制其正文。

单元完成 MUST 只认评估入口 `assessFeature().complete`（其中已含与当前 `change_unit_ref` 一致的施工契约核对）；失败、暂停、待人工、resume、retry 和 Feature 内 backtrack MUST 继续由既有 Goal Mode events/reducer/receipt/evidence 负责。循环中断后 MUST 可通过重读这些事实恢复，不得创建跨单元 checkpoint/ledger 或直接写 completion。

caller 返回 `completed` 后，薄循环 MUST 立即重读当前 CU completion；若结果不是 `VALID`，MUST 以 no-progress blocker 停止，且 MUST NOT 再次选择同一 CU。caller 返回值本身不得充当完成事实。

#### Scenario: Three dependent units progress continuously

- **WHEN** fixture 有 A→B→C 三个合法 CU，fake Goal Mode 每次为选中 Feature 产生可验证 completion
- **THEN** 薄循环依次派生并调用 A、B、C，每次只启动一个，且三次完成均由既有验证入口确认

#### Scenario: Failed unit stops the outer loop

- **WHEN** Goal Mode 对当前 CU 返回失败、暂停或 awaiting-human 且无 VALID completion
- **THEN** P2 停止选择新 CU，返回同一 run 的恢复/阻塞信息，不把失败投影成 provides 已满足

#### Scenario: Completed return without completion fact makes no progress

- **WHEN** caller 返回 `completed`，但重读后当前 CU completion 仍为 ABSENT、INCOMPLETE 或 INVALID
- **THEN** P2 立即返回 no-progress blocker，只调用该 CU 一次，不循环重启同一 Feature

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

### Requirement: Reconciliation re-resolves stable targets without a semantic diff engine

蓝图 revision、`source_fingerprint` 或 `artifact_sha256` 变化时，CU 的旧 blueprint binding/design gate/ready projection MUST stale；CU revision/hash 变化时，旧 Feature projection MUST stale。下游 SHALL 从新 identity 自行重新派生，P1 MUST NOT 创建、修改或移除 P2 ready set。

CU 身份规则：`change-unit.yaml` 契约字段（`provides`、`requires`、`target_predicates`、`touches` 的 owner 与 design_ref target 地址、`preserved_invariants`、`design_refs` 的 target 地址）不变即同一 CU，已完成与未完成 CU 同规则：

| 变化 | 处置 |
|---|---|
| 补证据、机械修复、验收/文案/蓝图输入变化，契约字段不变 | 同一 CU；评估入口给出的 uncovered 义务由 successor 按责任阶段补齐 |
| 蓝图升 admitted revision，且 carry-forward 通过 | 原位升版：三处身份指针（`component_blueprint_ref`、`design_refs[]`、`touches[].design_ref`）的 revision / `source_fingerprint` / `artifact_sha256` 改为当前蓝图值，CU `revision + 1`，`change_unit_id` 与契约字段不变 |
| carry-forward 失败 | 不升版；历史 provides 不满足依赖，路由 `reconcile_blueprint` 回 P1 调和或新建 CU |
| 契约字段变化 | 新 `change_unit_id` 并以 `supersedes` 引用旧 `change_unit_ref` |

carry-forward SHALL 以历史 refs 的每个稳定 target `kind/id/view_id?` 构造当前 blueprint ref，并只复用当前 P1 resolver/admission：仅当全部 target 在当前有效蓝图中仍可解析且仍获准、无 unknown/open decision/blocker 时通过，整个 CU 的历史 provides 才 carry forward；carry-forward 只在同一 `blueprint_id` 内跨 revision 生效，另一 `blueprint_id` 工作区的历史 CU MUST NOT 参与任何 carry-forward 或依赖满足。任一 target 缺失、因替换而原 ID 不再解析、当前 disposition 为 unknown/open decision/blocker，或蓝图/相关设计未准入时，历史 provides MUST NOT 满足依赖，未来 CU MUST 阻塞并回到 P1 调和。

原位升版 MUST 只由唯一 consumer writer（设计准备段，在派生 readiness 前）执行：三处指针身份本就不一致的 CU 属契约变化，MUST 跳过；待写 CU MUST 先过 canonical 全量校验，任一失败整批不落盘；结果（升版与跳过及原因）MUST 对调用方可见，重复执行 MUST 无变化。精确引用解析器 MUST NOT 为此放宽。原位升版后 Feature 的 `change_unit_ref` 与 CU 不再一致，评估入口 SHALL 把它判为 plan 义务 uncovered（binding），由 successor 只补 uncovered 义务的责任阶段。已完成 CU 的 Goal Mode events/receipt/evidence/completion MUST 保留，MUST NOT 因重新规划改回 pending。

首期判定 MUST 是全有或全无的地址/准入重校验，不得假设 P1 存在 semantic diff、`invalidates` 或 decision-flip 引擎，也不得新增此类 registry/ledger。结果 MUST 可从正式产物和当前蓝图重建。`revises` 仅供旧数据读取，MUST NOT 再生成，也不承载任何行为。P2 MUST NOT 创建或修改 P3 closure 状态。

#### Scenario: Every historical target still resolves and remains admitted

- **WHEN** 蓝图升 revision 后，已完成 CU 的全部历史 target ID 在当前有效蓝图仍可解析且仍获准
- **THEN** 该 CU 的 provides 可整体 carry forward，同时保留完成事实

#### Scenario: Blueprint bump with every target resolving re-points the completed CU in place

- **WHEN** 蓝图升 admitted revision，已完成 CU 的全部 target 仍解析且获准，契约字段未变
- **THEN** 设计准备段把该 CU 三处指针原位升到当前蓝图、revision 加一、`change_unit_id` 不变；评估入口判 plan 义务 uncovered，successor 只补 uncovered 义务，不新建 CU、不重走全链

#### Scenario: Contract field change requires a new change unit id

- **WHEN** CU 的 touches 新增模块或其它契约字段变化
- **THEN** 原位升版 MUST NOT 接手；同一路径的候选 MUST 被拒绝，修正以新 `change_unit_id` + `supersedes` 表达，旧 CU 及其完成记录保留

#### Scenario: Missing or unresolved historical target returns to P1

- **WHEN** 任一历史 target ID 缺失/被替换，或当前对象为 unknown、open decision、blocker 或未准入
- **THEN** 该 CU 不升版、字节不变，结果列出跳过原因；其 provides 不满足未来依赖，相关推进阻塞并请求 P1 调和；P2 不猜测语义等价

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-reconciliation.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/utils/component-blueprint-path.ts`

### Requirement: Design preparation accepts an admitted blueprint with zero change units

P2 MUST 暴露一个**设计准备子流程**，关闭"首个 canonical CU 由谁创建"的责任空档。它 MUST 完全复用上表 `CU decomposition` Seam Card 的既有机制（provider 只产临时候选 → consumer validator 校验后写 canonical），MUST NOT 新增第二套 CU 写入机制、第二个状态机或新 CLI。

- **入口**：admitted blueprint。**初始 canonical CU 数量为 0 MUST 是合法入口**，MUST NOT 判为推进故障；推进决策 MUST 把该情形与"有 CU 但无 ready"区分开。
- **候选**：decomposition provider 或人工/Agent 设计者 MUST 只产出内存/临时报告中的候选，MUST NOT 直接写 canonical CU 或完成事实；候选 provenance MUST 只记入 extraction method，MUST NOT 自称权威。
- **接受**：只有 consumer validator MAY 接受候选，且**全仓 MUST 只有一个 canonical CU 写入实现**——单候选接受 MUST 是批量接受的 1 元包装，MUST NOT 保留第二份 provenance/schema/design-gate/落盘逻辑；设计准备段只做入口/readiness 编排并委托该唯一 consumer。它 MUST 校验 schema、canonical identity、设计闭包（设计可施工门）、provenance 与来源权威，全部通过后 MUST **原子**写出 1..N canonical `change-unit@1`：任一候选不通过即整批拒绝且一个字节都不落盘；写入中途失败 MUST 回滚本批已落盘目标。
- **重复接受 fail-closed**：目标 canonical 文件已存在时 MUST 拒绝，MUST NOT 覆盖。契约变化 MUST 走新的 `change_unit_id` + `supersedes`；蓝图升版造成的指针漂移由下一条原位升版处理，不经再接受。
- **指针原位升版**：派生 readiness 前，设计准备段 MUST 按「Reconciliation re-resolves stable targets without a semantic diff engine」执行三处蓝图指针原位升版；它 MUST 复用同一 canonical 校验与同一落盘原语（整批校验后写、中途失败回滚），MUST NOT 改动契约字段，不构成第二套写入机制。
- **终点**：派生 design gate / readiness 并返回后续施工入口。子流程 MUST **停在 selector 与 Goal Mode 执行之前**，MUST NOT 选择 CU、启动 run 或触碰 P3 closure。
- **施工段前提不放宽**：selector 与 Goal Mode 施工段 MUST 仍要求至少一个 canonical CU；设计准备段的入口放宽 MUST NOT 传导到施工段。

#### Scenario: Admitted blueprint with zero CUs enters design preparation

- **WHEN** 工作区有 admitted blueprint 但还没有任何 `change-unit.yaml`
- **THEN** 推进决策返回"需要设计准备"而不是 blocked 故障，且不选择任何 CU、不启动 Goal Mode

#### Scenario: A rejected candidate writes nothing

- **WHEN** 一批候选中任意一个未通过 schema、identity、设计闭包或 provenance 校验
- **THEN** 整批被拒绝，工作区内一个 canonical CU 文件都不产生

#### Scenario: A valid batch is written atomically

- **WHEN** 一批 N 个候选全部通过 consumer validator
- **THEN** N 个 canonical `change-unit@1` 一次性写出，随后可被既有枚举与 design gate 读取

#### Scenario: Single and batch acceptance share one writer

- **WHEN** 分别经单候选入口与批量入口接受候选
- **THEN** 两者 MUST 走同一 consumer 校验与落盘原语；provenance、canonical schema/identity、设计闭包门与原子写出 MUST NOT 存在第二份实现

#### Scenario: Accepting the same candidate twice fails closed

- **WHEN** 某候选的目标 canonical 路径已存在已接受的 CU
- **THEN** 接受必须失败并定位该路径，已有 canonical CU 与其 provenance 保持不变

#### Scenario: Construction still requires at least one CU

- **WHEN** 设计准备段尚未写出任何 canonical CU，调用方试图进入 selector 或 Goal Mode
- **THEN** 施工段入口必须拒绝并说明至少需要一个 canonical CU

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/change-unit-provider-boundary.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`, `skills/project/change-unit-progression/SKILL.md`, `skills/project/component-design/SKILL.md`
