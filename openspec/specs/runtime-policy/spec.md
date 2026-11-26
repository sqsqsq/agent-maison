# runtime-policy Specification

## Purpose
TBD - created by archiving change verification-matrix. Update Purpose after archive.
> 动态工作流 g1 已对齐目标规范；新协议的生产接线与验收由 P1–P7 分别完成。
> 本次规范修改不表示动态运行能力已上线，旧运行仍依出生协议兼容。

## Requirements
### Requirement: evidence_profile config knob

`framework.config.json` MAY 声明顶层 `evidence_profile: strict|balanced`；缺省 MUST 为 strict 且行为与引入前逐一等值。`minimal` MUST NOT 是合法 config 值——它只能是旧协议 lite track 的求解结果，MUST NOT 因新请求阶段较少而自动求得。

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 未声明 evidence_profile
- **THEN** 全部凭证按 strict（现状）求解，既有夹具零回归

#### Scenario: 全局声明 minimal 被拒
- **WHEN** config 写入 `evidence_profile: "minimal"`
- **THEN** config 校验 FAIL

> **Enforced by:** `specs/framework.config.schema.json`, `harness/config.ts`

### Requirement: Evidence matrix resolution

旧协议的 `resolveEvidencePolicy` MUST 按矩阵求解：full×strict verifier/trace/exploration required、receipt not_applicable；full×balanced（**由 config 显式声明，任意 mode 生效**）verifier 仅 {spec, coding} required（保留集默认写死，config 字段未接线）、receipt not_applicable、trace optional、exploration required；lite resolved=minimal——verifier off、receipt not_applicable、exit 脚本门禁 required。

降档 MUST 只由 `config.evidence_profile` 触发，`ctx.mode` MUST NOT 参与求解：缺省（无该字段 / 显式 strict）时 interactive、headless、goal 三态输出逐一等值于 strict，声明 balanced 时三态输出同样逐一相同。`resolveProfileLabel` MUST 与 `resolveEvidencePolicy` 同判——档位标签写进 `evidence_policy_snapshot.profile_resolved` 与控制台，标签说 strict 而求解按 balanced 走会让宿主读到与实际不符的档位。

balanced 下两根轴的降档范围 MUST 分别陈述，不得合并成同一个 phase 集合：`verifier` 按保留集分流，故 plan / review / ut / testing 四个 feature phase 关闭；`trace` 无条件降 optional，对**全部六个** feature phase 生效，**含仍要求 verifier 的 spec / coding**。

`verifier=off` MUST 只免除"要求提供"，MUST NOT 免除已经存在的负面结论：当前 subject 已有一份验真通过（subject 回显匹配、verdict 与 blocker_count 自洽）且 verdict ≠ PASS 的 verifier 报告时，闭环 MUST 仍否决。报告缺席或为 PASS 时才是零要求。

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/config.ts`

#### Scenario: balanced 跳过 review 阶段 verifier

- **WHEN** full + balanced 下求解 review phase（interactive 或 goal 均可）
- **THEN** verifier=off、receipt=not_applicable、trace=optional、exploration=required，脚本门禁不受影响

#### Scenario: goal-mode 同样按声明的 balanced 求解

- **WHEN** goal-runner 驱动同一 feature 且 config 声明 `evidence_profile: balanced`
- **THEN** 求解结果与 interactive×balanced 逐一相同——保留集外 verifier=off、六个 feature phase 的 trace=optional，`profile_resolved` 记 `balanced`

#### Scenario: 保留阶段的 verifier 与 trace 范围不相等

- **WHEN** full + balanced 下求解 spec 或 coding phase
- **THEN** verifier=required 的同时 trace=optional——两根轴的降档范围 SHALL NOT 被当成同一个集合

#### Scenario: 关轴不免除已有的负面结论

- **WHEN** verifier 解析为 off，但当前 subject 已有一份验真通过的 verifier 报告且 verdict ≠ PASS
- **THEN** summary MUST 保留该 subject 与报告落点、证据状态记 `fail`，check-receipt MUST 仍记 `verifier_not_pass` BLOCKER；脚本门禁 PASS SHALL NOT 构成放行

### Requirement: Anti-cheat red lines are outside the matrix

The framework control-plane write boundary, build-fingerprint binding, asset-crop reproduction, process-input sanitization, and `diff_within_scope` SHALL remain outside runtime policy's evidence-tier matrix. The framework boundary SHALL be enforced by an out-of-model read-only principal where available, or represented honestly by the cooperative editing-tool guard where it is not.

Runtime policy SHALL NOT introduce or lower a framework Git dirty check, HEAD/commit identity, per-file manifest hashing, sidecar self-check, foreign-file scan, trust baseline, allowlist, or bypass. The guard's shell/script/external-process blind spots SHALL remain explicit at every tier. Legacy signer/confirmation fields SHALL not lower actual machine checks.

The runtime-artifact policy consumed by this boundary SHALL describe only Maison output and guard paths. It SHALL NOT derive host source-control configuration, and no tier SHALL gain a compensating detector that reads or writes the host `.gitignore`.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/shared/guard-framework-write-core.mjs`, `harness/tests/unit/runtime-policy.unit.test.ts`

#### Scenario: Framework boundary does not depend on evidence tier

- **WHEN** a lite track or relaxed evidence profile is active
- **THEN** the environment read-only boundary or cooperative editing-tool guard SHALL remain unchanged, and no Git/hash detector SHALL be added as a tier-independent fallback

#### Scenario: Legacy signer does not bypass crop reproduction

- **WHEN** a crop artifact has a legacy signer field but current source/bbox reproduction fails
- **THEN** the crop gate SHALL fail independently of runtime tier and signer identity

### Requirement: Resolved phase chains expose ownership inputs without becoming an owner registry

Runtime policy SHALL expose the validated execution scope's phase set and order (legacy full/lite/custom chains only under their birth protocol) to the phase write-boundary resolver. Artifact ownership SHALL still come from phase-contract `produces` plus artifact/evidence resolvers, and source ownership SHALL still come from coding scope and profile-specific UT/testing resolvers. Runtime policy MUST NOT add a path-owner manifest, hard-code the canonical six phases, or grant a custom phase source ownership merely because it exists in the chain.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: lite workflow derives only its real nodes

- **WHEN** the active chain is `change → coding → exit`
- **THEN** owner/backtrack resolution SHALL use only those nodes and SHALL NOT invent spec, plan, review, UT, or testing targets

### Requirement: Runtime capability support and produced evidence are separate facts

Runtime policy/capability resolution SHALL determine provider/profile support before a phase invocation without reading current-run output evidence. Evidence produced after invocation SHALL be validated by the owning checker and MUST NOT mutate the immutable pre-check capability report. Unsupported capability projects capability-missing; declared support with missing or invalid output projects a checker failure.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/harness-runner.ts`

#### Scenario: current evidence cannot retroactively change capability

- **WHEN** a runtime provider declares step telemetry support but produces no observation file
- **THEN** the capability report SHALL remain `available` and testing SHALL report evidence FAIL rather than rewriting support to capability-missing

### Requirement: Runtime phase set derives from workflow

合法能力集合与本次执行集合 MUST 分开：workflow 声明可用能力，本次范围决定需要执行哪些能力；新协议恢复只使用 run 的冻结范围，MUST NOT 从当前 workflow/track 重算。

所有运行时组件（harness-runner、check-receipt、phase-transition-policy、trace 校验、goal-runner/monitor/status、compat/backfill/exploration 工具）MUST 从 active workflow 的 `artifacts[]` 解析合法 feature phase 集，MUST NOT 各自持有 `spec|plan|coding|review|ut|testing` 硬编码枚举。

#### Scenario: workflow 新增 phase 后运行时全链认可
- **WHEN** workflow YAML 声明新 phase id（如 `change`/`exit`）且 harness 各入口以该 phase 运行
- **THEN** check-receipt、transition-policy、trace 校验与 goal-runner 均接受该 phase，不出现"runner 放行、其它组件拒绝"的 split-brain

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-transition-policy.ts`

### Requirement: Pure policy resolver set

旧协议兼容 policy 模块 MUST 保留核心纯函数 `classifyRequestRoute()`、`resolveFeatureTrack()`、`resolveEvidencePolicy()`、`resolvePhaseChain()`；判定集合可由后续 change 在同一模块扩展（C5 增 `resolveCorrectionTarget` / `classifyCorrection` / `resolveEnforcementTier`），扩展 MUST 同守纯函数与 default 等值不变式；`resolveEvidencePolicy` MUST NOT 执行文件 I/O（`provided` 属校验层事实，不在 policy 输出枚举内），输出限于 `required|optional|off|not_applicable`。

Enforcement: `harness/scripts/utils/runtime-policy.ts`

#### Scenario: 未声明降档时 headless/goal 仍 strict

- **WHEN** `runtimeContext.mode` 为 `headless` 或 `goal`，且 config **未**声明 `evidence_profile: balanced`
- **THEN** `resolveEvidencePolicy` 按 strict 求解——verifier=required、trace=required、exploration=required、**receipt=not_applicable**（strict 从来不是"全 required"）

#### Scenario: default 态与现状等值

- **WHEN** 无 feature.yaml、config 无 evidence 段、track 缺省 full
- **THEN** interactive、headless、goal 三态的求解结果逐一相同且与收编前硬编码行为等值

### Requirement: Stop hook policy snapshot fail-safe

harness-runner MUST 将 policy 快照（含 `policy_schema_version`、evidence 档位与本次范围绑定；旧协议含 track）写入 `.current-phase.json`；下发 Stop hook MUST 只读快照、MUST NOT import harness 模块或独立求解义务。新协议快照缺失、版本不符或解析失败时 MUST 拒绝放行并报告恢复缺口，MUST NOT 回退构造 full 链；旧协议保持 full+strict 的 fail-safe。

#### Scenario: 快照缺失时 fail-closed
- **WHEN** 旧协议 Stop hook 读取 `.current-phase.json` 无 policy 快照字段（旧 state 或 runner 未写成功）
- **THEN** hook 按 full+strict 判定（宁可多设防），不静默放行

> **Enforced by:** `agents/claude/templates/hooks/check-phase-completion.mjs`, `harness/harness-runner.ts`

### Requirement: Trace phase validation moves to runner

`trace.schema.json` 的 `phase` 字段 MUST 放宽为形态 pattern；phase 语义合法性 MUST 由 runner 侧按 active workflow 合法集校验。

#### Scenario: 旧 workflow 的 trace 继续合法
- **WHEN** 既有 feature 在 spec-driven workflow 下产出 `phase: "coding"` 的 trace.json
- **THEN** schema 与 runner 校验均通过（向后兼容零变化）

> **Enforced by:** `harness/trace/trace.schema.json`, `harness/harness-runner.ts`

### Requirement: Completion status projects gaps and non-reverified verification honestly

The completion projection SHALL distinguish `COMPLETE`, `COMPLETE_WITH_GAPS`, `COMPLETE_WITH_P0_GAPS` and `FAILED`. A phase closed on a prior verifier PASS with changed material SHALL carry `verifier: completed_with_prior_review` and `current_material_not_reverified`; a phase re-closed by `--revalidate` SHALL carry `script_revalidated` and `semantic_not_reverified`. None of these states SHALL be rendered as PASS for the current material, and none SHALL block normal development completion.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: Gaps and stale review are visible together

- **WHEN** a feature completes with two P0 unsupported gaps and a testing phase closed on a prior review
- **THEN** the projection reads `COMPLETE_WITH_P0_GAPS` with both facts listed

### Requirement: Execution scope has one authority and preserves obligations

新协议 SHALL 区分 required / not_applicable / unknown、已有满足依据、执行可用性与完成证据；失败、manual、超时或设备离线 MUST NOT 消除义务或生成 PASS。零设备义务 SHALL 根据有效验收内容的同一分层规则判定，不强制物理 acceptance.yaml；performance 只有确需设备证明时才触发设备义务。

feature.yaml.execution_scope MUST 仅为运行前候选。完整 Feature 交付 MUST 有唯一的冻结范围权威：本次关联的 run 存在时以该 run 的**有效范围**（出生 + 已应用 scope_revised）为权威。首次执行任一 feature phase 且无任何权威时，MUST 由机器从候选冻结一次；权威缺失或损坏（有阶段报告却无任一权威，或记录声明已转入某 run 而该 run 不存在/损坏）MUST 明确报错，MUST NOT 回退候选或选边。manifest.execution_scope 与 phase_chain MUST 保持出生值并绑定出生事实，运行期消费方 MUST 读有效范围。恢复 MUST 读取有效范围；显式 runId 的 manifest 缺失/损坏 MUST NOT 回退候选。全复用只核验真实既有完成记录，不造空链假 run。

合法范围修订 MUST 在同一 run 内追加 scope_revised 完成，MUST NOT 封卷、MUST NOT 释放 owner/锁、MUST NOT 生成后继；出生记录 MUST NOT 被改写，预算与失败历史 MUST NOT 被清空。successor 只保留给失败修复型 supersede、用户显式改需求与 creation-incomplete 修复。未受影响证据只在 freshness/closure 校验通过后复用。

新协议证据策略 MUST 在有效范围内求解，strict/balanced 继续按显式配置，模式不自动降档；未知输入先补足，本次无 testing 不要求 testing trace。已有有效负面结论与真实控制约束仍有效。MUST NOT 新建第二 run 目录、场外状态或平行完成协议。feature 级冻结记录（`<features_dir>/<feature>/execution-scope.json`）是 P8 裁决的**第二载体**，MUST 由机器单 writer 写入，MUST NOT 混入 feature.yaml。

#### Scenario: Device failure preserves responsibility
- **WHEN** 当前 device-evidence 为 required 但设备离线
- **THEN** 范围保留设备义务并报告可用性缺口，不改为 not_applicable

#### Scenario: Resume ignores changed workflow defaults
- **WHEN** 新协议 run 出生后 workflow 或候选范围改变
- **THEN** 恢复 MUST 使用有效范围（出生 + 已应用 scope_revised），MUST NOT 重算候选；需要变更时由责任方在同一 run 内追加合法修订

#### Scenario: Spec discovers a new device obligation
- **WHEN** spec 的有效新验收要求新增设备验证
- **THEN** 同一 run 追加 scope_revised 并继续派发，MUST NOT 产生第二个 run_created，出生范围不被改写

#### Scenario: Request-only review cannot create feature completion
- **WHEN** 用户只要求审查指定代码
- **THEN** 使用真实专项请求与独立报告，只完成 request，不伪造 Feature、run 或 completion

> **Enforced by (planned P2/P5/P6/P7):** `harness/scripts/utils/runtime-policy.ts`、
> `harness/scripts/utils/goal-manifest.ts`、`harness/scripts/goal-mode-entry.ts`、
> `harness/scripts/utils/verify-feature-completion.ts`、`harness/scripts/check-testing.ts`。

#### Scenario: Returned author writes survive restored mistakes and generated snapshots

- **WHEN** a completed or reclaimed author invocation has valid source changes, a prior outside-authority write has been restored, and a profile validates snapshot-only generated output
- **THEN** recovery SHALL use current outstanding restoration facts and accurate invocation identity; the restored event or generated snapshot SHALL NOT invalidate unrelated lawful writes
- **AND** generated output SHALL NOT acquire author-source provenance or prove product PASS; explicit research dependencies and ordinary source-chain mismatches remain subject to their existing checks

#### Scenario: Both handback orders preserve lawful producer output

- **WHEN** a completed invocation records its owned writes before the end event in session transport or after it in process transport
- **THEN** facts recovery SHALL consume the same invocation's qualified observations in either order, retaining completed-call, ownership and hash-chain checks
- **AND** a definition producer still present in applicable obligations SHALL be able to check its lawful replacement draft even when the satisfied old input removed it from the birth chain; new bindings require the existing checks and scope publication

#### Scenario: A repaired product reaches independent re-review

- **WHEN** current author writes affect an existing review finding, or relevant new refusal evidence arrives
- **THEN** the coordinator SHALL reuse its existing material-change comparison to deliver the affected finding, current changes, author reasons and valid evidence to the independent review producer
- **AND** report-format repair and semantic re-review SHALL NOT repeatedly dispatch one another on unchanged material; unresolved negative findings remain effective until independently closed

#### Scenario: Transport retry and revoked proof do not lose independent review

- **WHEN** independent semantic review returns a recoverable API interruption
- **THEN** the coordinator SHALL retry that work before a checker can consume the old report and erase the re-review trigger
- **WHEN** the old review's inputs and the latest author's product writes are unchanged but its scope proof was invalidated
- **THEN** the existing invalidation SHALL wake the required independent review, preserving findings which remain unproven

#### Scenario: Unresolved construction inputs preserve an execution gap

- **WHEN** required construction inputs cannot be resolved before scope or UT checks
- **THEN** dependent checks SHALL report their unexecuted capability gap rather than manufacture a scope violation, missing-module conclusion or compile failure
- **AND** the required gap SHALL still prevent applicable completion while independent authorized work remains executable

### Requirement: Business automation authority comes from one common entry input

Task automation authority SHALL be a single explicit input: `authorization.autonomyAuthorized`. `goal-runner --detach`, `--resume … --detach` and the supervisor's same-form restart SHALL convert the user's unattended choice into that input at the launcher, pass the existing non-persistent `--authorize-autonomy` argument through to the detached child before `--detach` is stripped, and the session `--authorize-autonomy` SHALL produce the same value. Policy resolution MUST NOT infer authority from `runtimeOwnerKind`, executor mode, `--detached-child`, `manifest.unattended`, `approval_mode`, process owner or any agent ledger. The authorization input SHALL remain bounded by the original request scope, explicit prohibitions, required credentials/irreversible actions and hard budgets; it SHALL NOT upgrade a single-duty request into a complete delivery.

#### Scenario: Detached child no longer guesses authority
- **WHEN** a user launches `goal-runner --detach` (fresh) or the supervisor restarts `--resume <run> --detach`
- **THEN** the parent converts the entry into the common authorization input and passes `--authorize-autonomy` to the child; restart and continuation SHALL NOT lose the original authority or reset accumulated budget

#### Scenario: Transport markers alone do not authorize
- **WHEN** only `--detached-child`, process owner, `manifest.unattended` or `approval_mode=never` is present with no entry conversion or explicit session authorization
- **THEN** policy SHALL resolve `confirmation_required`; design changes/budget changes keep their original confirmation path

#### Scenario: Both transports see the same waiting semantics
- **WHEN** the same condition blocks a session-owned and a process-owned complete delivery
- **THEN** both SHALL use the same probe, remaining budget and cutoff; returning a waiting item to the session SHALL change only transport/presentation, not the recovery decision or business disposition


### Requirement: Unified intake derives one proportionate envelope

所有产品修改 SHALL 默认消费 `docs/operations/project-entry.md` 的唯一规则，Agent SHALL 提供有理由和当前可读项目内路径的 Q1/Q2/Q3、独立结果及依赖、跨部件、预期明确和做法唯一事实；机器 SHALL 核引用当前可读并从事实派生外框，SHALL NOT 要求历史 Read 或只接受档位名。复杂优先，其次三问任一是为中型；三问全否且预期可验/有源、唯一做法为特别简单，否则局部选择/预期待补为小型。unknown SHALL 保留并只补影响当前决定的事实，不当否、不自动永久升档，不新增分类 CLI/模型/用户表单。

真实 user 明确升/降档、豁免或验证限制 SHALL 优先；原件角色、session/cwd 与请求关联 SHALL 核实，assistant 转述/引用文件/代码块 SHALL NOT 授豁免。默认豁免只及本请求/续作，明确会话范围才扩展，撤销恢复。无固定选择仅新依据或有据纠错可重算；真实失败、既有成果、授权和硬预算 SHALL 保留。

compile/request SHALL 按当前工作区字节和比较时的 HEAD 给内容影响提示，用户明确指定比较区间时使用其 base/head。当前目标和实际依赖决定应审测范围。读取、dirty 或普通原生工具诊断 SHALL NOT 扩大写权或覆盖独立验收结论。完整 diff 归属仅在用户要求时核原件。接口、路由、持久化、金额/幂等和架构等适用验证独立于外框。未执行、实际失败与用户排除 SHALL 如实标记。

#### Scenario: User fixes a smaller envelope
- **WHEN** user 明确按小型且未排除专项，实际 diff 改变接口签名
- **THEN** 保持用户外框，补适用接口/调用方验证，不偷偷加重流程、不洗掉已有 FAIL

#### Scenario: Comments do not create a payment obligation
- **WHEN** 支付目录的实际内容仅注释/错字变化
- **THEN** 不仅因路径触发支付逻辑专项，用户明确验证要求仍保留

#### Scenario: Current verification can proceed with incomplete comparison history
- **WHEN** 项目无 Git 或显式历史比较基准不可读
- **THEN** 比较缺口 SHALL 披露，已具备独立依据的显式局部验证继续。普通内容比较 SHALL 用当前 HEAD，用户显式指定的区间 SHALL 按其 base/head。比较基准不重置原请求出生身份

> **Enforced by:** 原 compile/request 入口、`harness/scripts/utils/execution-scope.ts` 及同源原生请求/内容影响解析；真实客户端与业务验收分开记录。


### Requirement: Sourced user reductions stay in the original run

用户在已有受管 run 中明确减少流程或验证范围时，原入口 SHALL 核同一正式 request/原生 user 原文及请求关联，经原 scope_revised/revision_input 调整对应未执行工作。共同谓词、提案生产者、runtime writer 与恢复 reader SHALL 同源消费该真实覆盖；无源 Agent 重答、改名或删除结果 SHALL NOT 删除/降级 required。用户仅固定小型 SHALL NOT 隐式排除 UT/testing；真实目标/验收变化仍走原修正责任。旧 CU、历史完成、原基线、有效证据和真实产品 FAIL SHALL 保留，不重建独立 request 清账、不把排除验证改判 PASS，不新增 ledger/审批/运行权威。

#### Scenario: User excludes future device verification in an existing run
- **WHEN** 真实 user 明确本请求后续不跑真机，而产品目标未变
- **THEN** 仅相应未执行验证按原范围修订处理，resume 重读同一有效范围，保留其它义务和失败历史

#### Scenario: An author tries to erase a failed obligation
- **WHEN** 只有 Agent 换说法或删 FAIL，没有可核真实用户调整
- **THEN** 原 required 保护继续拒绝减责；真实产品 FAIL 不能因声明排除验证变 PASS

> **Enforced by:** 同一 execution-scope 判据、feature-track 提案、原 runtime scope writer 与 goal-run-creation reader；原始用户来源来自正式 request intake。
