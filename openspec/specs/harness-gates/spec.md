# Harness Gates Specification

## Purpose

Define the acceptance gates that MUST pass when AgentMaison publishable content
(`skills/`, `specs/`, `harness/`, etc.) is modified.
## Requirements
### Requirement: Harness unit tests must pass after publishable changes

The system MUST require `cd harness && npm test` to pass with zero failures before
any change to publishable content is considered complete.

#### Scenario: All harness tests pass
- **WHEN** a developer modifies files under `harness/`, `specs/`, `skills/`, or `workflows/`
- **THEN** running `npm test` from the repository root (or `npm test` inside `harness/`) MUST report all tests PASS

> **Enforced by:** `AGENTS.md`, `harness/package.json`, `harness/tests/`

### Requirement: Consumer release npm test uses check global phases

The consumer `npm test` script MUST be redefined to `check:global` (catalog + glossary + docs),
matching S3 `run-global-phases` behavior. In the release zip, `harness/tests/` is excluded
from the artifact. Source repo `npm test` (unit + fixtures) remains the developer gate unchanged.

#### Scenario: Release harness package has consumer test semantics
- **WHEN** `npm run release:verify` inspects the staged or extracted release artifact
- **THEN** `harness/package.json` MUST NOT contain `test:unit` or `test:fixtures`,
  MUST contain `check:global`, and `scripts.test` MUST equal `npm run check:global`

> **Enforced by:** `scripts/release-pack-rules.mjs`, `scripts/verify-release-pack.mjs`

### Requirement: Phase check scripts enforce phase-rules

The system SHALL enforce each harness phase using a dedicated check script paired
with a phase-rules YAML file under `specs/phase-rules/`.

#### Scenario: Spec phase has check and rule pair
- **WHEN** harness-runner executes the `spec` phase
- **THEN** it MUST invoke `harness/scripts/check-spec.ts` against `specs/phase-rules/spec-rules.yaml`

#### Scenario: Plan phase has check and rule pair
- **WHEN** harness-runner executes the `plan` phase
- **THEN** it MUST invoke `harness/scripts/check-plan.ts` against `specs/phase-rules/plan-rules.yaml`

#### Scenario: Workflow DAG defines phase dependencies
- **WHEN** harness resolves the active workflow
- **THEN** it MUST load `workflows/spec-driven.workflow.yaml` (or the configured `active_workflow`) and honor each artifact's `requires` dependencies

### Requirement: Release verify is mandatory for dev-tool changes

The system MUST require `npm run release:verify` to pass when changes touch
developer-only directories (`.cursor/`, `.codex/`, `openspec/`) to prevent
accidental leakage into the release artifact.

#### Scenario: Dev-tool change verified before merge
- **WHEN** a change adds or modifies files under `openspec/` or `.cursor/`
- **THEN** `npm run release:verify` MUST pass confirming excluded paths are absent from the zip

> **Enforced by:** `scripts/verify-release-pack.mjs`, `scripts/release-excludes.json`

### Requirement: check-init probe phase is read-only

The init inspection harness MUST NOT perform filesystem writes during probe.
Writes previously done in check-init (gitignore ensure, deprecated cleanup,
auto_overwrite sync) MUST be delegated to init-orchestrate approved tasks.

#### Scenario: check-init probe does not write gitignore
- **WHEN** harness init phase runs against a project root without `.gitignore`
- **THEN** the probe completes without creating or modifying `.gitignore`, and
  inspection #11 reports `MISSING` until S3 `ensure-gitignore` executes

> **Enforced by:** `harness/scripts/check-init.ts`,
> `harness/scripts/utils/init-task-planner.ts`

### Requirement: Init and setup registry is select-only

`confirmation-registry.yaml` entries for init/setup orchestration MUST NOT
expose `value: custom` or options that collect free-text paths or profile name
strings. Lint MUST fail such entries.

#### Scenario: init.project_profile has preset options only
- **WHEN** `check-skills-confirmation-ux.ts` lints the registry
- **THEN** `init.project_profile` MUST NOT include `value: custom`,
  `init.toolchain_path` MUST NOT be present, `init.populated_diff` MUST NOT
  be present, and `init.adapter` MUST NOT be present

#### Scenario: init.setup portable has no legacy Q1/y channels
- **WHEN** lint scans init/setup registry entries
- **THEN** `portable` / `portable_menu` MUST NOT contain `Q1=`, `all=y`,
  `all=n`, or bare `y=` / `N=` shorthands

### Requirement: Init setup prompts forbid architecture free-text questionnaires

`skills/project/framework-init/prompts/**` and `templates/**` MUST NOT instruct
agents to collect architecture DSL fields via conversational questionnaires
(fully custom flows, field-by-field collection, sublayer follow-up prompts).

#### Scenario: architecture preset docs use select-or-stop only
- **WHEN** `check-skills-confirmation-ux.ts` lints init prompts and templates
- **THEN** files MUST NOT contain interactive patterns such as
  `完全自定义`, `收集字段`, `手工拼装 JSON`, `逐项确认`, `追加问卷`,
  or `继续追问` (except lines explicitly marked as forbidden anti-patterns)

> **Enforced by:** `skills/project/framework-init/prompts/**`,
> `skills/project/framework-init/templates/**`,
> `skills/reference/user-confirmation-ux.md`,
> `harness/scripts/check-skills-confirmation-ux.ts`

### Requirement: hmos-app profile accepts HSP as library module format

The system SHALL treat `HSP` as a valid value for
`doc/module-catalog.yaml > modules[].format` and for design `contracts.yaml >
modules[].format` when the active project profile is `hmos-app`, equivalent to
`HAR` for library export and freshness checks.

#### Scenario: Catalog format_value_valid accepts HSP
- **WHEN** harness-runner executes the `catalog` phase against an hmos-app project
- **AND** `doc/module-catalog.yaml` contains a module with `format: HSP`
- **THEN** `check-catalog.ts` MUST NOT emit `format_value_valid` FAIL for that module
- **AND** `format_value_valid` allowed values MUST be sourced from
  `profiles/hmos-app/profile.yaml > catalog_allowed_module_formats` (including `HSP`)

#### Scenario: HSP modules participate in library export checks
- **WHEN** an hmos-app catalog module has `format: HSP`
- **AND** the module has a resolvable `oh-package.json5 main` export entry
- **THEN** `entry_file_matches_oh_package_main` and `key_exports_fresh_vs_index` MUST
  evaluate that module the same as a `format: HAR` library module
- **AND** coding phase `har_index_export` MUST evaluate contracts modules with
  `format: HSP` the same as `format: HAR`

#### Scenario: Other profiles unchanged
- **WHEN** the active project profile is not `hmos-app` (e.g. `generic`)
- **THEN** this requirement MUST NOT imply global framework support for `HSP`
- **AND** that profile's own `catalog_allowed_module_formats` SSOT remains authoritative

> **Enforced by:** `profiles/hmos-app/profile.yaml`, `profiles/hmos-app/harness/har-export-resolve.ts`,
> `profiles/hmos-app/harness/catalog-entry-file-har.ts`, `profiles/hmos-app/harness/catalog-key-exports-har.ts`,
> `profiles/hmos-app/harness/coding-host-rules.ts`, `harness/scripts/check-catalog.ts`

### Requirement: Workflow manifest supports goal transition fields

The system SHALL extend `specs/workflow-schema.json` and `workflow-loader` to accept optional `transition_policy` and `auto_chain` on workflow manifests.

Enforcement: `specs/workflow-schema.json`, `harness/workflow-loader.ts`, `workflows/spec-driven.workflow.yaml`

#### Scenario: Spec-driven workflow loads transition_policy

- **WHEN** `spec-driven.workflow.yaml` includes `transition_policy: manual`
- **THEN** workflow-loader MUST parse it without validation error

### Requirement: Phase transition policy supports goal_mode resolution

The system SHALL implement `resolveAutoChain` and `classifyPhaseVerdict` in `phase-transition-policy.ts` for goal-runner consumption.

Enforcement: `harness/scripts/utils/phase-transition-policy.ts`

#### Scenario: INCOMPLETE with deferrable block continues when allowed

- **WHEN** classifyPhaseVerdict receives INCOMPLETE with deferrable blocking_class per dependency_policy
- **THEN** it MUST return `defer_external_and_continue_if_allowed`

### Requirement: Init gitignore includes feature goal-runs

The system SHALL include `doc/features/*/goal-runs/` in canonical init `.gitignore` patterns via `ensure-gitignore`, without ignoring the entire `doc/features/` tree.

> **Former enforcement（已无现行实现）**：本 requirement 已由 active change
> `framework-identity-boundary` 的 REMOVED delta 退役——`canonical-gitignore.ts` 与
> executor 的 `ensure-gitignore` writer 均已删除，当前代码库**没有任何文件实现它**。
> 这里刻意不写 `Enforcement:`：不得用现存但无关的文件冒充实现。requirement 本体
> 保留至 archive，由该 REMOVED delta 承接删除。

#### Scenario: Fresh init adds goal-runs ignore

- **WHEN** `ensureCanonicalGitignore` runs on a project without the pattern
- **THEN** `.gitignore` MUST gain `doc/features/*/goal-runs/` while retaining existing `doc/features/*/*/reports/*` and `/doc/features/_adhoc/` patterns

### Requirement: Screen-locked device produces the existing external-block contract

hmos-app profile 的 UT 失败分类 MUST 对设备锁屏产出 `blocking_class='externalBlocked'` 与 `failure_kind='device_blocked'`，从而落入既有 `DEFAULT_DEPENDENCY_POLICY` 的可 defer 契约。MUST NOT 停留在默认的 `toolchain:false` 分支（该分支会使上层兜底为 `code_regression`）。

精确原因 MUST 只保留在 blocker 的 `details_excerpt` 或既有 HDC diagnosis 中。MUST NOT 新增 summary 顶层字段（`summary.schema.json` 为 `additionalProperties:false`，且该原因仅供人读，不应扩大协议面）。

上游 verdict gate 的环境层指引措辞 MUST 表述为「请人解锁真机」，MUST NOT 使用可被 agent 读作自我指令的「解锁真机」。

#### Scenario: 锁屏归入设备阻断
- **WHEN** `aa test` 因屏幕锁定失败
- **THEN** CheckResult 带 `blocking_class='externalBlocked'` 与 `failure_kind='device_blocked'`

#### Scenario: 混合失败不整体 defer
- **WHEN** 同一 phase 内模块 A 因锁屏失败、模块 B 用例真实失败
- **THEN** MUST NOT 整体判 defer；模块 B 的真实失败仍须 FAIL（设备问题不得掩盖代码问题）

### Requirement: Emulator-backed testing cannot claim a full pass

testing 阶段结论 MUST 由 runner 依可信 device session 派生：当 `target_kind ∈ {emulator, unknown}` 时，**无论 agent summary 声称什么**，最终结论 MUST 封顶为 PARTIAL/DEFERRED，MUST NOT 判定整体 READY/COMPLETED。ut 阶段允许在模拟器上取得 PASS。

该封顶 MUST NOT 依赖 agent 自报（自报即可绕过）。

#### Scenario: 模拟器 testing 不得冒充真机通过
- **WHEN** testing 在托管模拟器上执行且 agent summary 自报 PASS
- **THEN** runner 依 device session 将结论降为 PARTIAL/DEFERRED

#### Scenario: unknown 不被推断为真机
- **WHEN** `target_kind` 无法由正面证据确认
- **THEN** 记 `unknown` 并按模拟器同等封顶处理

### Requirement: Full-track closure is published by staged summary commit

The closure finalizer SHALL validate evidence, construct final summary bytes, generate the phase evidence manifest from the staged summary hash while recording the canonical summary path, publish the receipt pointer and strict phase state, and atomically publish the canonical summary last. Before generic freshness rejection, it SHALL recognize a partial publication from the same finalization by verifying the staged summary, expected canonical path/hash, receipt, run/attempt identity, manifest, pointer, and phase state, then idempotently complete only the missing steps. An unprovable partial state SHALL remain open/untrusted and return to the owner phase; arbitrary current bytes MUST NOT be rebound as evidence. No new journal or sidecar is introduced.

Enforcement: `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-state.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/upstream-closure.ts`

#### Scenario: crash after manifest publication

- **WHEN** manifest publication succeeds but the process crashes before pointer, state, or canonical summary publication
- **THEN** resume SHALL identify the same staged transaction before stale rejection and idempotently finish it, or backtrack the owner if identity proof fails

#### Scenario: closed summary bytes drift

- **WHEN** a closed canonical summary hash no longer matches its manifest and no runner-owned equivalence proof exists
- **THEN** the finalizer SHALL invalidate the closure and return to owner revalidation instead of publishing a new binding for the current bytes

### Requirement: Summary 1.2 distinguishes verified closure, assurance, and capability provenance
`harness/schemas/summary.schema.json` and mirrored TypeScript readers SHALL support
summary 1.2 with `assurance`, normalized `capability_resolutions`, and a
capability-resolution contract fingerprint in addition to versioned
`closure_commit@1`. Each resolution SHALL preserve source-attempt provenance needed to
verify freshness. Full-track closure SHALL require the commit marker, valid manifest,
PASS-compatible projected verdict, and the existing blocker constraints.

`summary.depth` and quality-depth protocol fields SHALL NOT coexist with assurance in
3.0.0 persisted output. Legacy summaries without the new protocol SHALL be
non-qualifying until regenerated or explicitly validating-migrated.

#### Scenario: Summary contains a derive fallback after absent artifact
- **WHEN** a phase resolves a derive source after an earlier artifact attempt is absent
- **THEN** summary capability resolution data SHALL retain the absent attempt and selected derive provenance

#### Scenario: Summary has blocked capability
- **WHEN** an applicable fail-policy capability is blocked
- **THEN** summary projection SHALL be at least INCOMPLETE and closure finalization SHALL reject PASS closure

### Requirement: Phase-state persistence is strict during closure
The closure finalizer MUST treat `.current-phase.json` write failure as a failed finalization rather than logging a warning and publishing closed summary state.

#### Scenario: Current-phase state cannot be persisted
- **WHEN** strict phase-state writing fails after evidence artifacts are staged
- **THEN** the finalizer MUST stop before canonical summary commit

### Requirement: Harness output includes deterministic next-step guidance
Feature-scope phase checks SHALL append a bounded next-step block outside the existing `HARNESS_SUMMARY` machine block. Global, sentinel `_global`, and `--adhoc-correction` paths SHALL remain silent.

#### Scenario: Feature phase check completes
- **WHEN** a supported feature phase reaches harness exit
- **THEN** output SHALL include the current feature/phase/mode status and the assessment recommendation without changing the machine block

### Requirement: The fidelity pregate re-verifies the routing SSOT instead of first-producing decisions

`fidelity_capability_pregate` SHALL load `fidelity-intent.json` and re-verify internal routing consistency, selected-fidelity projection consistency, stable requirement-source identity, and the genuine hard-pixel/current-capability conflict. It MUST NOT recompute requirement identity from files generated during the phase, and it MUST NOT consume artifact attestation or policy downgrade state. For UI-relevant features a missing SSOT is BLOCKER pointing at the initializer; non-UI features proceed without one. The pregate SHALL NOT produce the decision.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: Generated output does not invalidate the pregate

- **WHEN** spec creates an output file named in the requirement after routing initialization
- **THEN** pregate continues using the frozen source identity and does not report requirement SHA drift

### Requirement: Ruling-class escalation reads the hard-pixel contract; execution keeps the pixel target

Severity ratcheting and completion capping SHALL key on `isHardPixelContract`; high-fidelity execution machinery SHALL keep keying on the pixel execution target. Under best-effort, quality gaps keep their existing severities and optional debt policy. Deterministic content integrity failures remain unconditional BLOCKERs. Missing required visual capability SHALL defer; missing/invalid evidence after capability was declared SHALL fail the owning checker. Human-confirmation state and historical visual ledgers MUST NOT affect severity, capability, phase advance, or completion.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/harness-runner.ts`

#### Scenario: human confirmation does not change the ruling class

- **WHEN** a hard-pixel deterministic visual defect is present together with legacy confirmation metadata
- **THEN** the defect SHALL retain its existing BLOCKER/repair semantics

### Requirement: Blind-crop c3 waiver requires this-invocation machine verification with binding revalidation

Under a blind adapter, a crop asset SHALL be admitted only when current machine evidence proves the source image/hash, normalized bbox, resolved output hash/path, file sanity, and the applicable independent recognition/content check. User-supplied files or bbox values MAY be retained as neutral frozen input provenance, but `confirmed_by`, `human_crop_confirmed`, a chat answer, or a pre-written verified-looking report MUST NOT waive verification. When machine verification is unavailable, the asset SHALL use an allowed visible placeholder with debt, fail for a required asset, or defer for a real missing capability.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`, `profiles/hmos-app/harness/asset-acquisition.ts`

#### Scenario: legacy crop signature cannot admit an unverified crop

- **WHEN** a blind crop carries `crop_confirmed_by` but its source/hash/bbox/output binding cannot be machine verified
- **THEN** the crop SHALL not be admitted and SHALL follow placeholder, FAIL, or capability-defer policy

### Requirement: Capability-resolution freshness participates in evidence closure
The closure finalizer SHALL add only project-local applicability-provider and every
actual source-attempt dependency through the resolving or invalid terminating attempt
to phase evidence manifest inputs. The existing missing-file representation SHALL be
used for absent paths. The contract fingerprint SHALL remain in the report, summary,
and closure identity, but a framework contract file path MUST NOT enter a consumer
feature manifest or make historical feature closure stale.

> **Enforced by:** `harness/scripts/utils/phase-evidence-manifest.ts`,
> `harness/scripts/utils/gate-fingerprint.ts`,
> `harness/scripts/utils/phase-closure-finalizer.ts`, and fixtures.

#### Scenario: Missing high-priority source appears after closure
- **WHEN** a project-local source recorded missing before a selected fallback becomes present
- **THEN** evidence validation SHALL fail freshness and closure SHALL become stale

#### Scenario: Framework contract is upgraded after consumer closure
- **WHEN** a consumer feature has a closed phase and its framework contract file changes
- **THEN** the feature manifest SHALL remain fresh; the recorded contract fingerprint remains historical closure provenance

### Requirement: Capability outcomes project only blocked states into the quality lattice
Quality-axis derivation SHALL consume the pre-check capability report. Pruned states
SHALL remain explicit only in assurance, resolution provenance, report disclosure, and
assess observed degradations; they SHALL NOT alter a mapped axis, its resolution, phase
advance, closure, release readiness, or completion status. Blocked states SHALL force
release BLOCKED and a projected verdict of at least INCOMPLETE regardless of visual/asset
advance exemptions. The mapped axis SHALL become UNVERIFIED **unless** it already carries
a deterministic FAIL, which SHALL be preserved; the projected verdict SHALL NOT downgrade
an existing FAIL to INCOMPLETE. An explicit minimum assurance floor MAY produce an
assess gap for a pruned degradation but MUST NOT weaken blocked projections.

#### Scenario: Pruned asset capability leaves quality axes unchanged
- **WHEN** an applicable asset capability is pruned
- **THEN** its quality axes, projected verdict, release readiness, and completion status
  SHALL equal the same check set with no pruned capability report
#### Scenario: Blocked capability cannot use visual advance exemption
- **WHEN** a blocked visual capability is otherwise in an advance-exempt axis and its
  axis does not already carry a deterministic FAIL
- **THEN** the mapped axis SHALL be UNVERIFIED and projected verdict SHALL be at least INCOMPLETE

### Requirement: Runtime capability consumption is checked after phase execution
After a checker produces its results, the phase runner or checker finalization SHALL
invoke a pure capability-consumption assertion. It SHALL require exactly one same-ID
check for each active resolved capability, zero for all other capability states, and
contract-owned axis mapping for every capability-backed check.

#### Scenario: Duplicate check IDs for a resolved capability
- **WHEN** a resolved capability produces two same-ID check results
- **THEN** phase finalization SHALL fail the runtime consumption assertion

### Requirement: The phase initializer records explicit requirement provenance; derive.requirement accepts it as the phase-driven source

The phase-driven `/spec` path without a goal run identity SHALL obtain its authoritative requirement from a `fidelity-intent.json` SSOT whose `requirement_provenance` is `explicit_cli` and whose `execution_identity` matches the current `phase:<feature>:spec`. The attended goal `/spec` path SHALL invoke the same initializer with `--goal-run-id`; after shared context validation, the initializer SHALL take requirement text, adapter, and requirement source files only from that run's manifest and write `requirement_provenance=goal_manifest` with `execution_identity=<run_id>`. The shared `FidelityRoutingInitInput` SHALL require `requirementProvenance` at every call site. Manual phase initialization passes `explicit_cli` (explicit non-empty requirement) or `intent_fallback` (broad-intent fallback only) and SHALL NOT emit `goal_manifest`. The CLI SHALL accept `--requirement-file` through the same shared resolver and SHALL fail fast on an explicitly empty manual `--requirement`. Broad intent text (README/notes/`spec.md`) or a missing/`intent_fallback`/legacy manual SSOT SHALL NOT satisfy `on_missing: fail`; `change.md` remains the legacy fallback. A valid same-run goal SSOT SHALL be reused without changing its file hash or `decision_id`, and plan/coding/review/UT/testing SHALL remain read-only consumers.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`, `skills/feature/spec/SKILL.md`

#### Scenario: manual spec links to an explicit requirement

- **WHEN** a fresh feature is produced by `fidelity-intent-init --feature <f> --requirement "<text>"` (or `--requirement-file <path>`)
- **THEN** the SSOT records `requirement_provenance: explicit_cli` with `execution_identity: phase:<f>:spec`, and `derive.requirement` resolves, binding `fidelity-intent.json` (path + sha256) as the closure dependency

#### Scenario: no explicit requirement stays blocked

- **WHEN** manual Step 1 runs without a requirement (falling back to broad intent text) and no `change.md` exists
- **THEN** `derive.requirement` stays absent, the requirement capability stays blocked (INCOMPLETE), and the failure detail lists the attempted sources plus the two repair paths (goal manifest / re-run Step 1 with `--requirement(-file)`); a legacy SSOT without `requirement_provenance` is NOT treated as corrupt

#### Scenario: attended spec writes goal identity at the first writer

- **WHEN** spec Step 1 invokes the initializer with a valid attended `--goal-run-id`
- **THEN** the SSOT SHALL record the manifest requirement, adapter, and source files with `requirement_provenance: goal_manifest` and `execution_identity: <run_id>` before any spec artifact is produced

#### Scenario: same-run re-entry is byte stable

- **WHEN** the attended initializer is called again for the same valid run or that run reattaches
- **THEN** it SHALL reuse the existing valid SSOT without changing the file hash or `decision_id`

### Requirement: Blocked capabilities project deterministically into the diagnostic and decision exits

A blocked capability SHALL remain a pre-check fact that produces no `CheckResult` (the consumption bijection stays unchanged). The harness SHALL project it into the exits agents and humans already read, without inventing new statuses or parallel protocols:

- `readiness_signals` SHALL include `capability_input_unresolved` (status `incomplete`) naming the capability, input, attempt source, and bound dependency paths when present; wider claim text SHALL NOT be hardcoded into the generic projection (repair language, e.g. requirement-specific advice, lives only in the provider's own attempt detail).
- `next_action` SHALL return `resolve_capability_inputs_then_rerun` only when `blockers.length === 0`, `blockingSkips.length === 0`, no run status claims-done `false`, and at least one capability is blocked; real blockers/SKIPs/run-statuses take precedence.
- The assess `failed` gap for a locally-blocked phase (unresolved attempts without an `upstream_producer`) SHALL carry capability/input/attempt detail and keep recommendation `rerun_phase`; explicit external/device/deferred blockers SHALL keep `deferred`/`resolve_deferred`.
- `merged-report.md` SHALL include a blocked-capability section (human-facing, non-gating) and SHALL NOT claim PASS while a capability is blocked.
- A capability-projection difference where `pre === legacy` and `post !== legacy` SHALL NOT be reported as `quality_axes_projection_mismatch`; an independent real mismatch (`pre !== legacy`) SHALL still be reported. Projection SHALL preserve an existing deterministic axis `FAIL` (never downgrade to `INCOMPLETE`).

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/report-generator.ts`

#### Scenario: blocked requirement surfaces a diagnostic trio

- **WHEN** a fresh manual `/spec` run has no explicit requirement and no `change.md`
- **THEN** `readiness_signals` contains `capability_input_unresolved`, `next_action` is `resolve_capability_inputs_then_rerun`, and the assess `failed` gap detail names the capability/input/attempt; `merged-report.md` lists the blocked capability and does not claim PASS

#### Scenario: hard FAIL alongside a blocked capability stays FAIL

- **WHEN** a deterministic BLOCKER FAIL already drives the mapped axis to FAIL and a blocked capability targets the same axis
- **THEN** the axis and the projected verdict SHALL both remain FAIL (projection preserves deterministic FAIL and never downgrades to INCOMPLETE); release readiness remains BLOCKED

#### Scenario: external blocker takes precedence over local blocked reclassification

- **WHEN** a summary carries an explicit external/device blocker or `completion_status: deferred` alongside a locally-blocked capability
- **THEN** the phase SHALL stay `deferred` and the recommendation SHALL remain `resolve_deferred` (local blocked reclassification must not swallow explicit external deferral)

### Requirement: Formal goal testing gate force-installs and writes the sole evidence

goal 模式 testing 的外层 gate harness 内，device_test.install MUST 在`HARNESS_DEVICE_TEST_FORCE_INSTALL`（既有开关，仅由 runner 注入 gate harness 子进程 env）在场时跳过复用、真实执行 `hdc install -r`。install provider MUST 在调用 hdc install 之前计算完整 64 hex 的 HAP sha256 并随结果回传（12 hex 截断指纹的既有消费者 MUST NOT 受影响）。

`device-test-evidence.json` MUST 由 check-testing 协调层在 build→install→run 全部完成后
统一写入（run provider 与 install provider 均 MUST NOT 各自写入）。写入门槛全部满足才写：
`MAISON_GOAL_GATE_HARNESS === '1'`；goal run/attempt 身份完整；install executed 且 ok；
device_test.run 已执行且本轮 hylyre trace 路径非空；写前复算当前 HAP 完整 sha 与装机前
一致。trace_path MUST 直取本轮 pipeline holder 的 trace 路径（writer MUST NOT 自行调用
authoritative resolver 寻找 trace）。schema MUST 含 `written_at`（写入时刻，供 collector
作唯一时间裁决字段）与 device_target{serial, target_kind, session_id}（取 gate 进程 env
中就绪门冻结注入的设备身份）。

真实安装与 device_test.run 都已成功而 evidence 未能写出（compose 失败——含写前复算 HAP
sha 与装机前不一致——或写盘异常）时，check-testing MUST 产出 `device_test_evidence`
BLOCKER FAIL 并进入 results（MUST NOT 静默吞——否则 collector 把缺文件当无信号，旧包/
被改写 HAP 的结果可能被误当有效放行）。上游 install/run 本身失败时本步 MUST 返回空
（由既有 install/run 门禁裁决，不重复报）。

普通模式（无 flag、无 goal 身份）的 install 复用策略与既有行为 MUST 保持零变化。

#### Scenario: 正式 gate 强装并产出 evidence
- **WHEN** goal testing gate harness 完成 build→install→run 且门槛全部满足
- **THEN** 覆盖式写入 device-test-evidence.json，含身份/设备元组/full sha/written_at/cases

#### Scenario: 安装成功但 run 未产出 trace 不写 evidence
- **WHEN** install ok 但 device_test.run 未执行或本轮 trace 缺失
- **THEN** 不写 evidence（防误用历史 trace）；run gate 本身 FAIL，collector 不产生
  device_test 信号

#### Scenario: 真实安装与 run 已成功但 evidence 写不出
- **WHEN** 强装与 device_test.run 均成功，但 compose 失败（如 HAP 装机后被并发改写）或
  evidence 写盘异常
- **THEN** check-testing 产出 device_test_evidence BLOCKER FAIL（不静默）

#### Scenario: 普通模式行为不变
- **WHEN** 普通模式跑 check-testing（无 gate flag、无 goal 身份）
- **THEN** install 复用策略与既有一致，不写 evidence

### Requirement: Device-test defect cases carry machine-derived classification

evidence 的 cases[] MUST 由机器产物合成：失败 step MUST 从 trace notes 的机器写入`failure_artifacts` 子句严格解析（basename MUST 落在 failure_dir 内；文件名的 case id 与step index MUST 与该 case 一致；再于选中派生计划中查得该 step 的 selector/动作定义）；缺失、多义或冲突 MUST 标 unjoinable，MUST NOT 按最大 step 或任意现存文件猜测。

classification MUST 为四分类之一：`product_actionable` 须三条件齐备——selector 可归到
spec 声明锚点并推导出 expected screen、失败 step 的 UI dump 命中该 screen 的其他 identity
锚点、仅目标 selector 缺失或形态不满足；`environment` MUST 只消费既有结构化来源（run 级
RunFailureKind 与 install diagnosis kind），MUST NOT 重新扫描散文日志；selector 无 spec
依据或派生计划步骤与 spec 对不上 → `test_contract`；其余 → `unknown`。

#### Scenario: 多组诊断文件只认机器指名的失败 step
- **WHEN** 某 case 的 failure_dir 同时存在多个 step 的诊断文件
- **THEN** 仅按 trace notes failure_artifacts 指名的 step 参与 join，其余不作数

#### Scenario: 环境类失败不归产品缺陷
- **WHEN** run 级 RunFailureKind 为 device_locked/device_disconnect 等环境类
- **THEN** 该轮 cases 分类为 environment，不进入 product_actionable

### Requirement: hmos-app generated-source classifier contract

hmos-app profile MUST 提供生成物分类器：路径判据 MUST 限定到根 build-profile.json5 声明的模块根；内容判据 MUST 为模板结构白名单加四常量逐值等值（HAR_VERSION 取该模块根oh-package.json5 version；BUILD_MODE_NAME/DEBUG 与冻结 buildMode 互相一致；TARGET_NAME按模块 targets 与冻结 product 推导，无显式声明回落 'default'）；MUST NOT 做字节等值比对（hvigor 版本间模板注释措辞可漂移）。

#### Scenario: 常量与冻结配置逐值一致才降级
- **WHEN** 文件为纯模板且 HAR_VERSION/BUILD_MODE_NAME/DEBUG/TARGET_NAME 与冻结配置推导
  完全一致
- **THEN** 分类为合法生成物；任一值不符则不是

### Requirement: Gate internal errors are attributed as framework_bug, not agent content failures

When a phase checker throws a programmer error (TypeError/RangeError/SyntaxError), the `safeRun` wrapper SHALL keep the fail-closed BLOCKER FAIL and additionally set `failure_kind: 'framework_bug'` and `blocking_class: 'framework_internal'` on the result (reusing existing CheckResult/summary-blocker fields — no schema change). Downstream goal-runner classification SHALL treat a fresh, non-empty, all-framework_bug blocker set as `framework_bug` and halt on first touch with guidance to upstream the defect (agent must not modify framework release files nor keep mutating its own artifacts to work around the gate).

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-review.ts`, `harness/scripts/check-ut.ts` (safeRun), `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Gate crash stops feeding the agent retry loop

- **WHEN** a checker crashes with a TypeError while parsing an agent-authored YAML and the summary is fresh
- **THEN** the goal run SHALL halt with `framework_bug` guidance naming the checker id and stack head, instead of retrying the agent against an unfixable blocker

### Requirement: Agent-authored YAML shape deviations produce structured FAILs, never crashes

Checkers consuming agent-writable YAML/JSON fields (per the source-artifact→loader→field→consumer inventory: ui-spec.yaml assets/screens trees, visual-parity.yaml mappings, asset-crop-vl.yaml entries, contracts/acceptance/use-cases collections) SHALL iterate via a shared `asArray()` guard so that non-array truthy values (`{}`, `""`, nested dicts) or a null parse cannot throw. Each guarded site SHALL be paired with a shape validation that reports a structured FAIL (expected shape + minimal valid sample); an invalid shape passing silently is a defect.

Enforcement: `profiles/hmos-app/harness/*` inventory sites, shared `asArray` util

#### Scenario: Dict-shaped assets fail with guidance instead of crashing

- **WHEN** an agent writes `assets: {}` (or `mappings.components` as a dict) into ui-spec.yaml / visual-parity.yaml
- **THEN** the affected checker SHALL emit a structured FAIL describing the expected list shape and SHALL NOT throw `[Harness 内部错误]`

#### Scenario: Invalid shapes are not silently washed

- **WHEN** `asArray()` converts a non-array value to an empty list at a guarded site
- **THEN** the paired shape validation SHALL still surface a FAIL for that field (coverage asserted by the fixture matrix: `{}`, `""`, nested dict, parse-null)

### Requirement: PRD-to-code traceability entries are validated per entry, not in aggregate

The `plan_to_code` gate SHALL validate every `prd_to_code_traceability` entry individually before running the aggregate file-existence check: each entry SHALL have a non-blank `prd_id` (string, trimmed non-empty); each entry SHALL map at least one key file (`key_files.length > 0`); every key-file path SHALL be a trimmed non-empty, project-root-relative safe path (no absolute paths, drive letters, or `..` segments — reusing `validateProjectRelativePath`, with its throw wrapped into a gate verdict) and SHALL resolve to a regular file (`stat.isFile()`, not a directory). Any violation SHALL produce a BLOCKER FAIL on `plan_to_code` naming the offending entries — never an internal `[Harness 内部错误]` and never a vacuous PASS over an empty or fabricated set.

Enforcement: `harness/scripts/check-coding.ts` (checkDesignToCode)

#### Scenario: A partially empty entry cannot hide behind a valid one

- **WHEN** one entry has `key_files: []` while another entry maps an existing file
- **THEN** the gate SHALL FAIL as BLOCKER, naming the empty entry's `prd_id` and the empty/total count (aggregate-only checking that passes because "all 1 mapped files exist" is forbidden)

#### Scenario: Fabricated paths do not count as traceability

- **WHEN** `key_files` contains `""`, `"."`, a directory path, or a `../`-escaping path
- **THEN** the gate SHALL FAIL as BLOCKER with an actionable message (path must be a project-root-relative regular file), not an internal error

#### Scenario: Entries without a PRD identity fail

- **WHEN** an entry omits `prd_id`, or sets it to `""` or whitespace-only
- **THEN** the gate SHALL FAIL as BLOCKER stating the entry cannot be traced to any PRD, even if its key files exist

#### Scenario: Fully valid traceability passes

- **WHEN** every entry has a non-blank `prd_id` and at least one safe relative path resolving to an existing regular file
- **THEN** the gate SHALL PASS (per-entry strictness must not reject legitimate traceability)

### Requirement: Evidence-tiered hvigor error classification

hvigor build 链失败 MUST 按错误码结构化分类：00303217 MUST 归 sdk_home_missing_or_invalid（并提示 framework 调用链已自动派生 DEVECO_SDK_HOME）；00303168 MUST 归 sdk_component_missing（中性事实）；仅当同时取得 SDK manifest 格式/SDK 版本/hvigor 版本证据时才 MAY 升级为 sdk_layout_or_version_incompatible_suspected 并给出装配套 SDK/降级 hvigor/IDE 编译三选一指引。诊断 MUST 头部化（details 首行 ≤180 字，经共享 diagnostic util），构建日志移后。

#### Scenario: 无证据不得断言不兼容
- **WHEN** hvigor 报 00303168 而 SDK manifest/版本证据未取得
- **THEN** 诊断输出 sdk_component_missing 与取证指引，不得出现"版本不兼容"断言

#### Scenario: 诊断不埋日志尾
- **WHEN** compile 失败 details 含 5KB 构建日志
- **THEN** 首行即结构化诊断头（错误码+归类+下一步），日志在其后

> **Enforced by:** `profiles/hmos-app/harness/hvigor-runner.ts`, 共享 diagnostic util

### Requirement: Summary blockers carry scalar actionability from a single registry

`CheckResult`/summary blockers SHALL support a scalar `actionability` field limited to `agent_fixable | human_only | toolchain_blocked` (no mixed value — mixed gate output is expressed by the existing separate blocker ids along the gate lifecycle). Resolution SHALL follow a single shared registry pure function (colocated with the failure classifier, reusing the existing toolchain id/blocking-class predicates — no third taxonomy) with the priority chain: explicit `actionability` on the check result → failure-kind/blocking-class compatibility mapping → default `agent_fixable`. The initial migration table SHALL at least map: `capture_completeness_external` → agent_fixable; `fidelity_deferrals_human_sign` and the awaiting-human-confirmation family (including `fidelity_capability_pregate`, `capability_missing_strong_intent`, `await_human_fidelity_tier`) → human_only; `capture_completeness_external_ocr_unavailable` and `blocking_class=device_toolchain` → toolchain_blocked. Summary mapping, runner retry-prompt projection, and reports SHALL consume the same registry; a drift test SHALL bind registry ↔ classifier ↔ schema.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/summary-blockers.ts`, `harness/scripts/utils/types.ts`, `harness/schemas/summary.schema.json`

#### Scenario: an unregistered blocker keeps today's behavior

- **WHEN** a blocker id appears in no registry entry and carries no explicit actionability
- **THEN** it SHALL resolve to `agent_fixable` and the retry flow SHALL behave exactly as before this change

### Requirement: ui-spec schema rejects unknown screen and component keys with a rename hint

`ui-spec.schema.json` SHALL set `additionalProperties:false` on both the screen and componentNode definitions (after a one-time inventory registers all legitimate existing keys), and the runtime validator SHALL derive its allowed-key sets from the schema (JSON Schema stays the single source of truth). Unknown-key errors SHALL include a did-you-mean hint when the unknown key is within edit distance 3 of (or a prefix-stripped match for) a legal key. A three-way drift test SHALL bind schema ↔ validator ↔ TypeScript types.

Enforcement: `harness/schemas/ui-spec.schema.json`, `profiles/hmos-app/harness/ui-spec-schema-validate.ts`

#### Scenario: the incident's wrong key is caught with the correct name

- **WHEN** a screen carries `must_have:` instead of `must_have_elements:`
- **THEN** validation SHALL FAIL naming the illegal key and suggesting `must_have_elements`, instead of silently dropping the coverage list

### Requirement: Capture-completeness messaging names real fields and real paths

The capture-completeness gates SHALL reference the field name `must_have_elements` verbatim in failure details, and their `affected_files`/details SHALL use the same `spec/`-relative path the gate actually reads (`spec/ref-elements.yaml` via the fidelity path helpers), never the feature-root projection that misled the incident agent into copying files to the wrong location.

Enforcement: `profiles/hmos-app/harness/capture-completeness-check.ts`

#### Scenario: the error message no longer teaches the wrong field name

- **WHEN** must-have coverage fails
- **THEN** the details SHALL say `must_have_elements` and point at `doc/features/<f>/spec/ref-elements.yaml`

### Requirement: Gate guidance separates agent and operator audiences

Generic auto-guidance and per-gate suggestions delivered to the retrying agent SHALL contain only artifact-level actions; framework-internal mechanics (implementation lookups, memory-manifest injection routes) SHALL move to an `operator_note` field rendered in goal reports but excluded from the agent retry-prompt failure feedback. The retry feedback block SHALL end with an explicit red line against reading or modifying framework internals to pass gates. When the previous failure contained an unknown-schema-key BLOCKER, the next retry prompt SHALL append the legal key list generated from the schema SSOT (model-agnostic trigger).

Enforcement: `harness/scripts/utils/report-generator.ts`, `harness/schemas/summary.schema.json`, `harness/scripts/goal-runner.ts`

#### Scenario: the agent no longer gets sent into framework source

- **WHEN** a gate fails whose remediation note mentions the structured-ref-elements memory manifest
- **THEN** the retry prompt SHALL show only the artifact-level fix while the goal report carries the operator_note

### Requirement: Machine-readable personal-setup preflight exit

harness-runner 的 personal-setup 前置校验失败时 MUST 在退出前输出并持久化机读 HARNESS_PREFLIGHT 结果（含 code/capability/prerequisite/双出口指引），退出码非零语义不变；机器行为恒 MUST 为"输出结构化缺口 + 非零退出"——MUST NOT 读 stdin、MUST NOT 生成任何确认 receipt、MUST NOT 放行或绕过 phase。

#### Scenario: goal 侧可分类
- **WHEN** goal 链（或交互态）遭遇 deveco_toolchain_missing 类前置缺口
- **THEN** 存在机读 HARNESS_PREFLIGHT 产物供 goal-runner 分类为 await_human_capability_gap，而非裸 console.error

#### Scenario: 交互态双出口
- **WHEN** 交互态 agent 收到该 preflight 失败
- **THEN** 文案含双出口（引导安装默认 | 用户确认后诚实停止并 resume 恢复），且注明用户确认仅为知情记录、不构成任何授权

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/personal-setup-gate.ts`

### Requirement: Terminology gate degrades on small scale

`project_scale: small` 下 spec 的术语消歧 MUST 降级为一次性对照 architecture.md 模块清单确认：映射表仍产出，免逐行 `[x]` gate；glossary MUST 允许最小种子。headless 例外规则沿用既有 §9 语义。

#### Scenario: small 档 spec 术语步骤
- **WHEN** small 档实例执行 spec 阶段术语消歧
- **THEN** 产出映射表 + 一次性确认即可通过 check-spec 术语门禁，无逐行 [x] BLOCKER

> **Enforced by:** `harness/scripts/check-spec.ts`, `specs/phase-rules/spec-rules.yaml`

### Requirement: Scope red lines survive small scale

`diff_within_scope` 与 spec 的 Scope 声明章节校验在 small 档 MUST 保持与 standard 一致，MUST NOT 随 scale 降级。

#### Scenario: small 档越界照拦
- **WHEN** small 档 feature 的 coding diff 触及 out_of_scope 模块
- **THEN** `diff_within_scope` BLOCKER FAIL（与 standard 行为一致）

> **Enforced by:** `harness/scripts/check-coding.ts`, `specs/phase-rules/coding-rules.yaml`

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；lite feature MUST 整体返回 exit 0 + 顶层 `not_applicable` 机读标注。

#### Scenario: balanced 下 verifier off 的 receipt 通过
- **WHEN** full×balanced 的 review phase receipt 无 verifier 节
- **THEN** check-receipt 记 verifier=skipped_by_policy 且 exit 0

#### Scenario: strict 行为不变
- **WHEN** 缺省 strict 下 receipt 缺 verifier verdict
- **THEN** BLOCKER FAIL（与现状一致）

> **Enforced by:** `harness/scripts/check-receipt.ts`

### Requirement: Two-layer evidence snapshot

receipt frontmatter 与 `.current-phase.json` MUST 记录 `evidence_policy_snapshot`，每凭证项含两栏：policy 档（`required|optional|off|not_applicable`）与 `validation_status`（`provided|missing|skipped_by_policy|not_applicable`）。快照 MUST 带 `policy_schema_version` 并与 C0 fail-safe 语义共用 schema。

#### Scenario: receipt 保留但 trace opt-in 关闭可稳定校验
- **WHEN** full×balanced 的 receipt 声明 trace policy=optional、validation_status=missing
- **THEN** 校验通过且组合判据机读可查，不依赖散文 N/A

> **Enforced by:** `harness/scripts/check-receipt.ts`, `harness/harness-runner.ts`

### Requirement: Closure source dispatches by policy

closure MUST 按 policy 分派三态：full = receipt `passed`；lite = exit 报告 PASS + change.md checkbox 全勾（`closed_by_exit_report`）；`not_applicable` MUST NOT 映射为 receipt-passed。Resume Gate 对 not_applicable MUST 走 lite 闭环判据。

#### Scenario: lite feature 跨会话续跑不误判
- **WHEN** 新会话对已完成 lite feature 跑 Resume Gate（check-receipt 返回 not_applicable）
- **THEN** 闭环判定读 exit 报告 + checkbox，而非要求 receipt

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `agents/claude/templates/hooks/check-phase-completion.mjs`

### Requirement: Legacy phase id alias with warning

The harness SHALL accept legacy phase ids `prd` and `design` as aliases for
`spec` and `plan` respectively, normalizing them before check execution and
emitting a WARN on first use per run.

#### Scenario: Legacy prd phase id runs spec checks
- **WHEN** harness-runner is invoked with `--phase prd`
- **THEN** it MUST execute spec-phase checks and emit a deprecation WARN

#### Scenario: In-flight current-phase resumes with legacy id
- **WHEN** `.current-phase.json` contains `"phase": "plan"` after framework upgrade
- **THEN** goal-runner or harness MUST normalize to `plan` and continue without manual edit

### Requirement: Spec to plan traceability gate

The harness SHALL verify that structured non-functional, security, performance,
and DFX constraints declared in spec (`acceptance.yaml` or spec.md structured
blocks) have corresponding implementation entries in `plan.md` or
`contracts.yaml`.

#### Scenario: Missing plan mapping fails trace check
- **WHEN** spec declares a BLOCKER security constraint without a plan/contracts mapping
- **THEN** the spec→plan traceability check SHALL FAIL with severity BLOCKER

### Requirement: Check id alias for renamed gates

The harness SHALL resolve legacy check ids (`prd_p0_coverage`,
`scope_consistency_with_prd`, etc.) to renamed counterparts (`spec_p0_coverage`,
`scope_consistency_with_spec`) when reading `phase_rules_overlays` and
`compat.yaml` exempt patterns.

#### Scenario: Overlay references legacy prd check id
- **WHEN** an instance overlay keys `prd_p0_coverage` after rename
- **THEN** harness MUST apply the overlay to `spec_p0_coverage` and emit a WARN

### Requirement: UT phase detects host artifacts under harness root

The system SHALL detect when host project artifacts (especially UT-related trees
derived from `contracts.modules[].package_path`) are written under `ctx.harnessRoot`
instead of under `ctx.projectRoot`, and MUST report `harness_host_artifact_pollution`
as BLOCKER when any violation is found.

#### Scenario: Misplaced package_path under consumer harness
- **WHEN** `framework/harness/{package_path}/` exists on disk for a module declared in `contracts.yaml`
- **AND** harness-runner executes the `ut` phase for that feature
- **THEN** `check-ut.ts` MUST emit `harness_host_artifact_pollution` with status FAIL and severity BLOCKER
- **AND** details MUST include layout-resilient display paths and migration guidance

#### Scenario: Profile may extend pollution patterns
- **WHEN** the active project profile implements optional `collectHarnessPollutionExtras`
- **THEN** violations from profile extras MUST be merged with core contract-path violations
- **AND** any non-empty merged set MUST trigger BLOCKER (parallel merge, not sequential gates)

> **Enforced by:** `harness/scripts/check-ut.ts`, `harness/scripts/utils/harness-path-guard.ts`, `specs/phase-rules/ut-rules.yaml`

### Requirement: Shared layer must not contain platform tool names

The system MUST forbid `AskUserQuestion` and `AskQuestion` in publishable shared
layers (`skills/`, `profiles/`, `agents/shared/`, `templates/`). Platform tool
names SHALL only appear in adapter-specific directories (`agents/claude/**`,
`agents/cursor/**`, etc.).

#### Scenario: Skills directory lint passes
- **WHEN** `check-skills-confirmation-ux.ts` scans publishable shared layers
- **THEN** no file under `skills/`, `profiles/`, `agents/shared/`, or
  `templates/` MUST match `AskUserQuestion` or `AskQuestion`

> **Enforced by:** `harness/scripts/check-skills-confirmation-ux.ts`

### Requirement: Confirmation registry schema 2.0 completeness

The system SHALL require `confirmation-registry.yaml` to use `schema_version: "2.0"`
with complete `options` (or `matrix_options`) for all registered confirmation
entries, and MUST NOT contain deprecated `widget_hint` or `widget_options_ref`
fields.

#### Scenario: Registry lint rejects legacy fields
- **WHEN** confirmation UX lint runs against `confirmation-registry.yaml`
- **THEN** entries with class `enum|gate|freeform_approval|artifact_checkbox` MUST
  have non-empty `options` arrays and the file MUST NOT contain `widget_hint:` or
  `widget_options_ref:`

> **Enforced by:** `harness/scripts/check-skills-confirmation-ux.ts`,
> `skills/reference/confirmation-registry.yaml`

### Requirement: Interaction layer consumer smoke test

The system SHALL provide `harness/scripts/smoke-interaction-renderer.ts` that
validates both framework source templates and consumer-level artifact paths after
simulated init materialization.

#### Scenario: Smoke test passes in CI
- **WHEN** `npx ts-node harness/scripts/smoke-interaction-renderer.ts` runs from
  the framework repository
- **THEN** it MUST pass Phase A (claude source templates) and Phase B (tmpdir
  consumer smoke including deprecated artifact cleanup and generic bundle-root
  renderer relocation)

> **Enforced by:** `harness/scripts/smoke-interaction-renderer.ts`,
> `docs/operations/release-checklist.md`

### Requirement: Base summary is receipt-independent and atomic

writeRunSummary MUST 拆为 base 与 closure patch 两段：base summary MUST 不依赖任何 receipt 校验结果、MUST 为完整 schema-valid 快照（next_action 以"未闭环/等待 receipt"初值填充、closure_status=open）、MUST 原子写入；closure patch MUST 只更新 receipt_status/closure_status/next_action，MUST NOT 首建文件。进程在 patch 前中断时，磁盘上 MUST 仍是合法 open 态 summary。

#### Scenario: patch 前崩溃
- **WHEN** base summary 已写、closure patch 未执行时进程终止
- **THEN** summary.json 通过 schema 校验且 closure_status=open，不残留旧 closed 态

> **Enforced by:** `harness/harness-runner.ts`

### Requirement: check-receipt reads current-run base summary

新格式（receipt_schema 2.0）下 check-receipt MUST 以本次 base summary 为唯一机器事实源：MUST 校验 feature/phase 精确匹配、verdict=PASS 且 blocker_count=0、gate_fingerprint 与当前门禁集重算一致；summary 缺失或不可解析 MUST 产 BLOCKER（禁止静默）。

#### Scenario: 旧 PASS summary 冒充
- **WHEN** 本次 harness FAIL（base summary verdict=FAIL）而磁盘存在上次 PASS 的旧 summary
- **THEN** check-receipt 以本次 base 为准判 FAIL；伪造 gate_fingerprint 的旧件因指纹重算不一致被拒

#### Scenario: 他 feature summary 串目录
- **WHEN** receipt 声明 feature=A 而 canonical path 下 summary.feature=B
- **THEN** check-receipt BLOCKER（feature/phase 精确匹配失败）

> **Enforced by:** `harness/scripts/check-receipt.ts`

### Requirement: Slim receipt keeps only non-derivable self-attestation

新模板 MUST 删除 script_harness 镜像块、trace_json 块、self_check q1/q3；MUST 保留 agent 身份、claimed_completion_at/commit_sha、verifier 摘录、反假设 checkbox、testing_run_artifacts。骨架 MUST 仅在 verdict=PASS 且 receipt 缺失时幂等生成，checkbox 全未勾，且 MUST NOT 构成闭环。

#### Scenario: 骨架未签不闭环
- **WHEN** runner 生成瘦身骨架而 agent 未勾反假设 checkbox
- **THEN** check-receipt FAIL，phase 不闭环；agent 补签后 PASS

> **Enforced by:** `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`

### Requirement: Process-integrity SSOT stays runner-side

新格式下预加载注入检测 SSOT MUST 为 runner 的 runProcessIntegrityPreflight CheckResult（BLOCKER 时 base summary 必 FAIL）；MUST NOT 新增 summary/trace 专用扫描；旧格式 receipt 兼容期 MUST 继续执行 script_harness.command 注入特征校验。

#### Scenario: 直启 harness 预加载注入
- **WHEN** NODE_OPTIONS 携带 --require 预加载启动 harness
- **THEN** process_integrity BLOCKER → base summary FAIL → 闭环不成立（不依赖 receipt 层扫描）

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/process-integrity.ts`, `harness/scripts/check-receipt.ts`

### Requirement: Personal setup gate covers catalog and glossary

`harness-runner` MUST evaluate personal setup before feature phases including
`catalog` and `glossary`. Exempt phases MUST be limited to `init` and `docs`.

#### Scenario: catalog phase requires personal setup
- **WHEN** harness-runner runs with `--phase catalog` and personal setup is incomplete
- **THEN** the runner exits non-zero before script harness unless internal init exempt applies

> **Enforced by:** `harness/harness-runner.ts`

### Requirement: Init internal global phases may bypass personal gate

When `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1` is set, `harness-runner` MUST skip
personal setup gate **only** for `catalog` and `glossary` phases spawned from
`run-global-phases`. Other phases (e.g. `prd`, `coding`) MUST still run the gate
even if the env is set. This env MUST NOT be documented for ordinary phase entry.

#### Scenario: run-global-phases after init succeeds without local json
- **WHEN** `init-task-executor` runs `run-global-phases` with `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`
- **THEN** catalog/glossary/docs harness invocations proceed without personal gate failure

> **Enforced by:** `harness/scripts/utils/init-task-executor.ts`, `harness/harness-runner.ts`

### Requirement: check-personal-setup ensure mode

`check-personal-setup.ts --ensure` MUST deterministically ensure personal setup:
auto-write local when exactly one materialized adapter with entry exists;
return `needs_adapter_choice` when multiple; `no_materialized_adapter` when none.

#### Scenario: single materialized adapter auto ensured
- **WHEN** `--json --ensure` runs with fallback status and one materialized adapter with entry file
- **THEN** JSON has `ok: true`, `ensured: "auto_single_adapter"`, and `framework.local.json` is written

#### Scenario: zero materialized adapters
- **WHEN** `--json --ensure` runs with fallback and empty `materialized_adapters`
- **THEN** JSON has `ok: false`, `code: "no_materialized_adapter"`, no local file written

> **Enforced by:** `harness/scripts/check-personal-setup.ts`, `harness/scripts/utils/personal-setup-gate.ts`

### Requirement: Review closure produces a source-tree attestation that testing reconciles fail-closed

At the review four-artifact closure validation point (never from a standalone check-review run), the harness SHALL emit `review-closure-attestation.json` binding: contracts.yaml self hash and normalized files list; the full product source-tree inventory from profile-aware `discoverProductSourceRoots()` (union of outer-layer modules, build-profile modules, module-catalog package paths, profile standard roots, and residual src/main candidates; excluding test dirs, build outputs, framework/, doc/) with per-file sha256 and aggregate hash; review-report and verifier-report hashes; gate fingerprint; run/attempt identity. Two fail-safes: a discovered product source file belonging to no inventory root SHALL FAIL; an empty inventory for a project type expected to have product sources SHALL FAIL. check-testing SHALL reconcile the current tree against the attestation-frozen inventory: any added/modified/deleted non-test file → BLOCKER FAIL directing a review-closure re-run; a missing attestation SHALL FAIL with no grace window.

Enforcement: `harness/scripts/utils/closure-attestation.ts`（新增）, `harness/scripts/check-receipt.ts`（review 闭环点）, `harness/scripts/check-testing.ts`

#### Scenario: fast-path constant added after review is caught regardless of contracts registration

- **WHEN** a new source file or a modified constant (e.g. DEVICE_TEST_FAST_PATH=true) lands in a product directory after review closure, whether or not contracts.yaml lists it
- **THEN** testing reconciliation SHALL FAIL and demand a fresh review closure

### Requirement: Product behavior switches default-on are blockers with coordinate-bound waivers

A deterministic scan over in-scope non-test product sources SHALL FAIL on default-enabled test/bypass behavior switches. Current runs MUST NOT accept a behavior-switch waiver or confirmation receipt. The switch SHALL be removed/fixed, or a changed product requirement SHALL enter a correction/successor run and be represented in ordinary source/spec truth rather than a gate-lowering exception.

Enforcement: `harness/scripts/utils/behavior-switch-scan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-testing.ts`

#### Scenario: accepted risk does not close a default-on bypass

- **WHEN** the scan finds `DEVICE_TEST_FAST_PATH = true` and a legacy signed waiver exists
- **THEN** the gate SHALL remain FAIL until the product code or frozen requirement changes and is revalidated

### Requirement: P0 device acceptance criteria are proven as structured state transitions

`check-spec` SHALL require every P0 device/both interactive AC to define ordered structured checkpoints and verbatim requirement references: a checkpoint's `pre_screen`/`post_screen` and its element ids are declared in `acceptance.yaml`, and element identity is proven by a `by_id` request value equal to the element id plus native resolution. The feature ui-spec is an open-world static hint, not a binding registry: a plan step whose `by_id` value equals a checkpoint element id binds that element even when the id is absent from the feature ui-spec (a pre-existing entry screen, a `forbidden_element_id` that only exists on the pre-screen), and only a `by_text` plan step needs the canonical ui-spec text mapping to bind. A forbidden element is looked up without a post-screen restriction, because the element that must be gone is never modeled on the post-screen. `check-testing` SHALL consume the Hylyre trace `CaseResult` and its `cases[].steps[]` as the execution evidence for every mapped P0 case. A case contributes to acceptance only when its `execution` is `completed`, `verification` is `passed`, `evidence` is `complete`, every required element is mapped to a `StepResult` with `role=assertion` and `outcome.status=passed` carrying a presence `outcome.observation`, and every forbidden element is mapped to the corresponding absence assertion with `role=assertion` and `outcome.status=passed` carrying an absence `outcome.observation`. That identity evidence SHALL be carried by a `by_id` selector request whose `value` equals the element id: a `by_text` request MUST NOT close required or forbidden coverage even when its resolution happens to report a matching `selected.id`, because `required_element_ids` are ids. There is no flat `StepResult.status`; reading one is reading a retired 0.3 field. Goal testing SHALL retain its existing run/attempt/HAP/device identity binding; ordinary interactive testing SHALL use the same StepResult evidence and SHALL NOT SKIP runtime evidence merely because a telemetry capability is absent. Agent prose, trace notes, legacy case status, self-reported PASS, and an unbound legacy runtime receipt MUST NOT satisfy the obligation. Pass-rate reporting SHALL include skips in the denominator and reject contradictory conclusions.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: StepResult evidence proves a P0 case

- **WHEN** all required and forbidden checkpoint assertions are present as current StepResults with `role=assertion`, `outcome.status=passed`, a `by_id` selector request matching the element id, and the case has `execution=completed`, `verification=passed`, and `evidence=complete`
- **THEN** the P0 acceptance obligation SHALL pass without consulting a plan-only status or a second evidence ledger

#### Scenario: An entry id absent from the feature ui-spec still binds

- **WHEN** a checkpoint `action.target_element_id` names a pre-existing entry element that the feature ui-spec does not model, the derived plan step is `by_id` with that exact value, and the StepResult carries `by_id` + `unique`/`candidate_count=1`/`selected.id` equal to the id
- **THEN** the action SHALL bind and the P0 acceptance obligation SHALL be able to pass; the ui-spec miss SHALL NOT be reported as a missing plan action

#### Scenario: A forbidden id that only exists on the pre-screen still binds

- **WHEN** a `forbidden_element_id` is modeled only on the checkpoint's pre-screen and the post-screen has no such node, the derived plan has a `wait_gone` `by_id` step after the action with that exact value, and the StepResult carries `by_id` + `not_found`/`candidate_count=0`/`selected=null`
- **THEN** the forbidden absence SHALL bind and close without requiring a post-screen ui-spec node

#### Scenario: Plan text or legacy status alone is insufficient

- **WHEN** a derived plan describes the right taps or a legacy trace says `通过` but a required assertion StepResult is missing or not passed
- **THEN** P0 semantic coverage SHALL remain FAIL/uncovered

### Requirement: P0 skips and unreachable screens never launder into clean passes

A skipped or unexecuted P0 TC and an unreachable required P0 visual target SHALL FAIL unless the cause is an enumerated external/capability blockage bound to real machine evidence, in which case the phase SHALL defer. An explicit skip or unexecuted case whose derive manifest contains only a TC id and no StepResult SHALL remain a testing-owned FAIL and SHALL produce zero automatic coding candidates; Maison MUST NOT infer a cause from the TC name, associated AC, or report prose. Only the existing capability-resolution path may classify a missing provider as capability defer. Missing status and unregistered trace skips remain testing-owned FAIL. New runs MUST NOT emit `await_human_p0_skip` or generic human-gate deferral for this evidence gap.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/goal-runner.ts`

The same execution-completeness rule SHALL cover every top-level test-plan TC, including P1 and P2: a trace/report that omits an explicit-skip or unexecuted TC MUST keep testing FAIL even when all represented P0 cases pass. A trace case present with native non-passing axes remains a testing failure; only a machine-proven provider capability absence may defer.

#### Scenario: Explicit skip without StepResult stays testing-owned

- **WHEN** a derived plan registers a P0 TC as an explicit skip without a waiver, StepResult, or machine-proven capability absence
- **THEN** `p0_coverage_integrity` SHALL FAIL, no automatic coding candidate SHALL be created, and the run SHALL remain in testing remediation

#### Scenario: A machine-proven provider absence may defer

- **WHEN** a P0 case has no StepResult and the existing capability resolution proves the required provider is unavailable
- **THEN** the phase SHALL use the existing capability/external defer path without guessing a product or coding failure

### Requirement: Declared fidelity is reconciled against detected intent

check-spec SHALL FAIL when frozen requirement intent demands a higher fidelity tier than the spec declares. A receipt, signer, or manual resume MUST NOT downgrade the frozen target. A legacy `fidelity-intent.json` whose `decision.source` is `downgrade_receipt` or `human_confirmed` MAY be parsed for compatibility but MUST NOT be reused as the fidelity SSOT. At a downstream goal start, its presence SHALL invoke the existing `backtrack_to_phase(spec)` transaction so the spec owner rebuilds the on-disk SSOT from current frozen requirements before downstream execution; it MUST NOT be folded into the ordinary missing/non-UI branch or replaced by an in-memory runtime truth. That backtrack transaction SHALL remain pending across crash/resume until receipt validation and the spec closure finalizer commit a fresh owner closure after the request; a prior `phase_backtrack_completed` event alone MUST NOT release downstream execution. If the selected target requires a capability the current provider/profile cannot supply, the run SHALL defer as capability-missing; changing the target is a new correction/successor requirement input.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: strong pixel intent cannot be signed down

- **WHEN** the frozen requirement demands pixel fidelity and spec declares semantic layout with a legacy downgrade receipt
- **THEN** reconciliation SHALL FAIL or preflight SHALL defer for missing capability; the receipt SHALL be inert

#### Scenario: receipt-derived fidelity SSOT is not reusable

- **WHEN** a matching-identity, matching-requirement `fidelity-intent.json` selects semantic layout from `downgrade_receipt` or `human_confirmed` while the frozen requirement demands pixel fidelity
- **THEN** the loader SHALL withhold it from authority and a coding/review downstream start SHALL backtrack to spec, rebuild the sole on-disk SSOT from the frozen requirement, and make downstream `CheckContext` consume the rebuilt pixel/hard contract instead of the receipt-derived semantic tier

#### Scenario: legacy fidelity backtrack crashes before spec closure commit

- **WHEN** the spec harness returns during a legacy-fidelity backtrack and a historical premature `phase_backtrack_completed` is persisted before `finalizePhaseClosure`, then the process crashes
- **THEN** resume SHALL keep the original request and budget pending, verify/close spec without issuing a second request, and enter the original downstream slice only after the fresh spec closure commits

### Requirement: Visual capture completeness is tier-independent and reference images cannot be silently descoped

Missing or invalid visual-diff navigation with declared P0 visual targets SHALL be a completeness BLOCKER at every fidelity tier. Every authoritative reference SHALL map to a ui-spec screen or carry machine-verifiable out-of-scope provenance bound to the parent hash, bbox/derivation, or frozen requirement citation; requirement-cited images MUST NOT be agent-descoped. Unprovable required registrations SHALL fail or defer for a real missing capability, not wait for human confirmation. Reachable screens SHALL still be captured and checked at the selected tier.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-*`

#### Scenario: unprovable descoping stays unclosed

- **WHEN** a requirement-cited image is marked out of scope without machine-verifiable provenance
- **THEN** the applicable gate SHALL FAIL or capability-defer and SHALL NOT create a must-review signature item

### Requirement: Conditional review verdicts cannot close without resolution or authorization

When review declares a conditional or negative verdict, all open BLOCKER/MAJOR findings SHALL be machine-verified and routed as responsible-phase repair candidates until a fresh review closes them. Conditional-review authorization receipts and accepted-risk statements MUST NOT suppress candidates, advance review, or close the feature. The verifier's PASS attests report credibility only and MUST NOT be consumed as product PASS.

Enforcement: `harness/scripts/check-review.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`

#### Scenario: open MAJOR findings cannot be accepted away

- **WHEN** review has two current verified MAJOR findings and a legacy conditional authorization receipt
- **THEN** the findings SHALL route to their owner and review SHALL not close until a fresh review verifies resolution

### Requirement: Attended phase entry validates explicit goal context

An attended `phase_execute_request` SHALL carry its authoritative `{run_id, phase, attempt_id, owner_id, owner_epoch}`. The spec Skill SHALL pass that exact context explicitly to `fidelity-intent-init`, the phase `harness-runner`, and `harness-runner --sync-closure`. All entries MUST use one shared validator before side effects to resolve the exact manifest/run-control, assert the captured owner fence, and verify matching feature, current `session/active` owner, and unexpired lease. The validator SHALL also load the latest existing fenced `phase_start` issued by the session driver for that exact `{owner_id, owner_epoch}` and require its `phase` and `attempt_id` to equal the request; a merely non-empty caller-supplied value is not an issuance proof. Validation failure MUST exit as a BLOCKER before SSOT write, closure write, or goal environment injection. After validation, the harness SHALL inject the existing run/attempt/phase orchestration environment plus `MAISON_GOAL_GATE_HARNESS=1`, so it is a formal gate rather than agent-side; attended closure SHALL finish through the explicit sync-closure entry without a detached runner replay.

Enforcement: `skills/feature/spec/SKILL.md`, `harness/scripts/fidelity-intent-init.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/attended-goal-context.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-run-control.ts`

#### Scenario: Wrong feature cannot borrow a live run

- **WHEN** either CLI receives a `--goal-run-id` whose manifest feature differs from `--feature`
- **THEN** it MUST fail before writing fidelity SSOT or setting goal orchestration environment

#### Scenario: Expired attended owner cannot authorize phase work

- **WHEN** the exact run has a missing, non-session, non-active, or expired owner lease
- **THEN** both CLI entries MUST fail closed with the same validation contract

#### Scenario: Valid attended context activates existing consumers

- **WHEN** an attended harness command validates the captured session fence
- **THEN** existing goal consumers SHALL observe run/attempt/phase and formal gate authority, `isAgentSideGoalHarness()` SHALL be false, `.current-phase.json` writes SHALL remain suppressed, and visual/device writers SHALL select their formal path

#### Scenario: Delayed old-epoch request is rejected

- **WHEN** a phase request captured under owner epoch N reaches initializer, harness, or sync closure after epoch N+1 has attached
- **THEN** that entry SHALL fail before writing or borrowing the new owner, even though the run ID still matches

#### Scenario: An invented phase or attempt cannot borrow a live owner

- **WHEN** a caller presents the correct run and live owner fence but changes either `phase` or `attempt_id` from the latest fenced session `phase_start`
- **THEN** validation SHALL fail before goal environment injection or any gate/closure side effect

#### Scenario: Attended receipt closes without a detached runner

- **WHEN** the phase fills its attempt-bound receipt and invokes the context-bound `harness-runner --sync-closure`
- **THEN** receipt validation and closure finalization SHALL use the same attempt identity and produce a formally closed phase without journal replay by `goal-runner`

### Requirement: A blind model may consume trusted crops but never execute or self-certify cropping

check-spec SHALL admit a crop under a blind primary only when current machine evidence verifies its resolved path, file sanity, source image hash, bbox/derivation, output hash, and applicable independent content recognition. Legacy `human_receipt`, `human_crop_confirmed`, `crop_confirmed_by`, and `user_requirement` signer sentinels SHALL be ignored as quality authority. Failing assets SHALL use an allowed visible placeholder, remain FAIL when required, or defer when the missing fact is a real unavailable capability.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: a signer field cannot self-certify cropping

- **WHEN** an agent-authored ui-spec sets human crop fields but no current source/bbox/output evidence exists
- **THEN** the gate SHALL reject crop admission without asking for another signature

### Requirement: Asset role and criticality are machine-derived and cross-checked, never agent-trusted

Asset manifest entries SHALL carry `role` (brand_logo|illustration|icon|mask|decoration|system_symbol), cross-checked against ui-spec `icon.kind`, ref-elements, and must_have membership — a mismatch SHALL FAIL. Criticality (brand-critical) SHALL be derived from P0-screen membership + must_have + reference-element linkage, not agent-declared. `placeholder_allowed` governs development continuation only; release readiness for still-placeholder brand-critical assets SHALL be BLOCKED by release policy regardless of the flag.

Enforcement: `harness/scripts/utils/ui-spec-shared.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`, `harness/scripts/check-{spec,coding}.ts`

#### Scenario: a brand logo declared as decoration

- **WHEN** an asset used by a P0 screen's must_have bank row is declared `role: decoration, placeholder_allowed: true`
- **THEN** the cross-check SHALL FAIL the declaration and derived criticality SHALL remain brand-critical

### Requirement: Materialized images pass role-aware source sanity; blank placeholders are blockers at every tier

Every image materialized into module media SHALL pass role-tiered jimp sanity (fully transparent / near-solid / abnormally low content ratio / undecodable-dimensions); thresholds SHALL be calibrated per role, not lifted from the crop-scenario constants. A brand-critical asset failing sanity SHALL be BLOCKER at every fidelity tier (existence, not fidelity). Placeholders SHALL be visible and role-appropriate: brand_logo → deterministic text-avatar (initial glyph + neutral palette rounded block); system_symbol → HarmonyOS sys symbol; illustration → explicitly labeled neutral placeholder frame; decoration → neutral block or omission. Blank/transparent PNG placeholders SHALL FAIL.

Enforcement: `profiles/hmos-app/harness/{asset-integrity,coding-visual-parity-check,asset-placeholder-cli}.ts`, `harness/scripts/check-coding.ts`

#### Scenario: the incident's 23 invisible placeholder PNGs

- **WHEN** coding materializes placeholder PNGs whose jimp stats show blank content for brand-critical bank logos
- **THEN** the materialization gate SHALL FAIL (BLOCKER) naming each asset, at semantic_layout no less than at pixel_1to1

### Requirement: On-device rendered visibility is a debt-gated observation

A device-side check SHALL compare rendered regions against the screenshot using its calibrated deterministic observations and write machine-derived visual debt. An open required debt SHALL keep the visual axis unclosed and release blocked; it SHALL close only after source/binding/render evidence verifies the fix. New debt MUST NOT enter an accepted-by-human state, and no receipt SHALL clear it. Optional low-confidence observations remain advisory according to the existing calibrated policy.

Enforcement: `profiles/hmos-app/harness/render-visibility.ts`, `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: accepted metadata cannot clear an invisible asset

- **WHEN** a current rendered-visibility finding remains open but legacy accepted-by metadata exists
- **THEN** current projection SHALL keep the required visual axis unclosed

### Requirement: Fidelity intent tri-state detection covers phase-driven runs

The shared fidelity-intent detection SHALL run on goal and phase-driven spec paths. Strong pixel intent with missing required visual capability SHALL produce `DEFERRED_CAPABILITY_MISSING`; no strong intent follows the normal default policy. Ambiguous wording SHALL be resolved from frozen requirement inputs and deterministic policy, not `await_human_fidelity_tier`. `--fidelity` may hold or raise the target but MUST NOT lower frozen intent, and no downgrade receipt SHALL be consumed.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-spec.ts`

#### Scenario: blind phase-driven strong intent defers

- **WHEN** a phase-driven spec run has strong pixel intent and no capable native/delegated visual provider
- **THEN** it SHALL defer before producing a downgraded semantic target and SHALL NOT ask for a fidelity signature

### Requirement: Agent-authored feature YAML cannot crash the harness

The feature spec loader SHALL catch YAML syntax failures in `contracts.yaml`, `acceptance.yaml`, and `use-cases.yaml`, preserve the file name, parser code and available line/column in `shape_issues`, and continue the current harness run. The existing `feature_spec_shape` check SHALL emit a structured BLOCKER in the same run; a malformed file MUST NOT terminate the harness before summary generation.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/harness-runner.ts`

#### Scenario: Plain scalar containing colon-space is reported in the same run

- **WHEN** an acceptance `device_focus` plain scalar contains an unquoted `subtitle_position: below` and YAML reports `BLOCK_AS_IMPLICIT_KEY`
- **THEN** the current harness report contains an actionable `feature_spec_shape` failure naming `acceptance.yaml` and its line/column, while unrelated checks still execute

### Requirement: Build phases MUST NOT guess the compile form; unresolved stops via existing channels

coding、ut 与 device-testing 的构建入口 MUST 在参数装配前解析一次 product selection，
且解析结果 MUST 作为构建参数显式传给 hvigor（不得在装配内再次名称猜测），
同一 ProductSelection 对象 MUST 直接传给失败分类器与 details 生成器（内存传播，
MUST NOT 依赖 metaExtras 或 result 对象字段做运行时传播）。

source 优先级 MUST 为：`explicit_run`（本次调用显式参数）→ `confirmed_env`
（`HARNESS_DEVICE_TEST_PRODUCT` 等既有 env 覆盖；goal 冻结的 testing product 走同一入口）
→ `explicit_config`（config 值且 local 确认值逐字相等）→ `sole_candidate`
（build-profile.json5 单候选）→ `unresolved`。

名称启发式（`product`/`default`/首位）MUST NOT 产出选定值，仅供 `unresolved` 时的候选
展示排序。

`unresolved`（构建形态无法确定——**四种原因**：`multi_candidate_unconfirmed` 多候选且
config 值未确认 / `no_build_profile` build-profile.json5 缺失 / `empty_products`
存在但未声明 app.products / `unparseable_build_profile` 无法解析）MUST 停止并要求确认：
交互式 harness 出口产出既有 BLOCKER FAIL（复用 `externalBlocked` 语义，不新增 failure
kind、不新建停止机制），details MUST 如实说明原因并列出全部候选（后三种原因**没有真实
候选**，MUST NOT 用虚构 `default` 冒充 `sole_candidate`）；MUST NOT 以未捕获异常打崩
门禁脚本。goal 无人值守由 `goal-runner` 启动前置检查先行处理（见 goal-runner spec），
MUST NOT 跑到 coding 阶段中途才停。

失败归因在 source 非 `explicit_run`/`confirmed_env`/`explicit_config` 时，explanation
MUST 以首句声明编译形态未经确认。

#### Scenario: 多候选且未确认的宿主不再被猜测
- **WHEN** build-profile.json5 声明多个 product，config 无 `preferredProduct` 或未在本机确认
- **THEN** 构建入口 MUST 报告 `unresolved` 阻断（原因 + 候选 + 确认引导）
- **AND** MUST NOT 选 `product`/`default`/首位继续构建

#### Scenario: build-profile 缺失/为空/不可解析不得虚构 default
- **WHEN** build-profile.json5 缺失（或存在但未声明 product / 无法解析）
- **THEN** 构建入口 MUST 报告 `unresolved`（`no_build_profile` / `empty_products` /
  `unparseable_build_profile`，候选为空），MUST NOT 以虚构 `default` 当作 `sole_candidate` 继续构建

#### Scenario: 单候选与已确认工程行为不变
- **WHEN** build-profile.json5 只有一个 product，或 config 值与 local 确认值相等
- **THEN** 构建照常执行，且报告 MUST 包含 `编译形态：product=<X>（来源：<source>）；工程可选：<candidates>`

#### Scenario: 构建期间外部配置改变
- **WHEN** 构建执行过程中外部修改了 config/build-profile
- **THEN** 该次构建的分类与报告 MUST 继续使用构建前解析的 selection（MUST NOT 二次解析）

> **Enforced by:** `profiles/hmos-app/harness/product-selection.ts`,
> `profiles/hmos-app/harness/coding-host-rules.ts`,
> `profiles/hmos-app/harness/ut-host-impl.ts`,
> `profiles/hmos-app/harness/providers/device-test-build.ts`,
> `harness/scripts/check-testing.ts`,
> `harness/tests/unit/*`（product-selection / hvigor-build-verdict / detect-product 语义）

### Requirement: Normal-mode device phases resolve one target at entry and share it across the whole chain

普通模式（`harness-runner --phase <p>`）在 `phaseRequiresDevice(p, profile)` 为真时，MUST 在
**任何设备操作之前**（脚本 harness 执行前）完成设备前置：策略检查 → 目标解析 → 就绪。
就绪 MUST 复用与 goal 侧**同一个共享核心** `ensureDeviceReady`；MUST NOT 使用只读探针
（`probeDeviceReadiness`，不 wake/不解锁/不启动降级）替代，MUST NOT 直接调用运行期恢复
（`ensureDeviceReadyAtRuntime`，它要求已有 serial、不负责选目标）。

**目标 MUST 只解析一次**，并 MUST 注入 `HARNESS_HDC_TARGET`，使后续 wake、解锁、`bm dump`、
install、`aa test` 全链共用同一 serial。解析优先级 MUST 为：显式 `HARNESS_HDC_TARGET` >
`device.target_serial` > 唯一在线设备；多台在线且无 `target_serial` MUST 走既有 AMBIGUOUS
停止求人。已显式设定的环境变量 MUST NOT 被覆盖。

配置目标不在线时 MUST 阻断，或走**已授权的**模拟器降级（`existing|managed`）；
**MUST NOT 跳过检查后让 hdc 隐式选择另一台在线设备**。

策略 `code=device_policy_unset` 时 MUST 前脚本 fail-fast：原文透传 `guidance`、非零退出、
MUST NOT 调用任何 checker/provider、MUST NOT 发出任何设备命令。四选一文案 MUST 保持单一
真源在 `device-policy`，MUST NOT 在门内另抄一份。策略检查自身执行失败（凭据库不可读、配置
损坏）MUST 与 `device_policy_unset` 分开报告，MUST NOT 引导用户重新登记凭据。

MUST NOT 为此新增 diagnosis kind、平行的 provider 局部门或第二套目标解析。profile 侧的
运行期恢复桥 MUST 只消费入口注入的目标，MUST NOT 读取 `framework.local.json` 自行解析目标。

**编译跳过类环境开关 MUST NOT 用于免除本门**：它们只跳过编译，UT 的真机执行受独立开关
控制、testing 更不认编译开关，据此让路等于门形同虚设。

托管启动（`managed`）的模拟器 MUST 在本进程退出时按既有所有权四元组回收，且回收登记
MUST 早于任何失败退出分支——「实例已启动但未就绪」（boot 超时/仍锁屏）是普通的可执行清理
失败路径，晚登记即零凭证泄漏。就绪核心给出的孤儿实例身份 MUST 随失败结果一并交出。

冻结上下文 MUST **整组原子**注入：应用后进程内的 `MAISON_DEVICE_*` MUST 恰好等于本次
`deviceEnvFor` 的产出，未返回的键 MUST 被删除。MUST NOT 逐键「不存在才写」——继承而来的
陈旧 `MAISON_DEVICE_CREDENTIAL_REF` 会被运行期优先取用，形成「`manual` 策略下仍自动输入
PIN」的越权路径。

`HARNESS_HDC_TARGET` **同样 MUST 以门的解析结果为准**，MUST NOT 保留注入前的旧值：显式目标
的优先级在门的**输入阶段**已经兑现，未降级时写回的本就是同一值，而发生**已授权降级**时最终
目标是模拟器 serial。保留旧值会产出 `HARNESS_HDC_TARGET`（离线真机）与
`MAISON_DEVICE_TARGET_KIND=emulator` 并存的目标分裂——hdc 操作离线真机，而设备门与 testing
封顶都以为目标是模拟器。

#### Scenario: manual 策略下不得残留陈旧凭据引用
- **WHEN** 进程继承了 `MAISON_DEVICE_CREDENTIAL_REF` 而本次策略为 `manual`（本次不产出 ref）
- **THEN** 注入后该变量 MUST 不存在，运行期 MUST NOT 取到任何凭据引用

#### Scenario: 托管实例启动后未就绪
- **WHEN** 降级启动了托管模拟器但它未在预算内就绪，入口前置判定失败
- **THEN** 该实例的所有权身份 MUST 随失败结果交出，且 MUST 在进程退出前登记回收

#### Scenario: 显式目标离线后走已授权降级
- **WHEN** 显式 `HARNESS_HDC_TARGET` 指向的真机不在线，入口前置按已授权 `existing`/`managed` 降级到模拟器
- **THEN** 注入后的 `HARNESS_HDC_TARGET` MUST 等于该模拟器 serial，MUST NOT 保留离线真机
- **AND** `MAISON_DEVICE_TARGET_KIND` 与 testing 封顶判据 MUST 与该同一目标同源

#### Scenario: 需设备 phase 在策略不可用时零设备操作
- **WHEN** `phaseRequiresDevice` 为真且 `device-policy --check` 返回 `device_policy_unset`
- **THEN** harness-runner MUST 非零退出并透传四选一 guidance
- **AND** MUST NOT 执行任何 checker/provider，MUST NOT 发出 `hdc install` 或 `aa test`

#### Scenario: 配置目标离线且无授权降级
- **WHEN** `device.target_serial` 指向的设备不在线，另有一台其它设备在线，且 `emulator_fallback=disabled`
- **THEN** 入口前置 MUST 阻断，MUST NOT 把那台在线设备当作目标注入

#### Scenario: 解析结果贯通全链
- **WHEN** 入口前置取得 READY
- **THEN** `HARNESS_HDC_TARGET` MUST 被注入为该目标，且解锁链与 hdc 命令 MUST 使用同一 serial

> **Enforced by:** `harness/harness-runner.ts`,
> `harness/scripts/utils/device-readiness-gate.ts`,
> `profiles/hmos-app/harness/device-recovery-bridge.ts`,
> `harness/tests/unit/device-readiness-gate.unit.test.ts`

### Requirement: Frozen attempt context is identified by target and frozen marker together

判定「本 attempt 已冻结」MUST 同时要求 `MAISON_DEVICE_ATTEMPT_FROZEN=1` **与**
`HARNESS_HDC_TARGET` 非空——goal 的设备就绪门取得 READY 时经 `deviceEnvFor` **成组**注入
`{HARNESS_HDC_TARGET, MAISON_DEVICE_SESSION_ID, MAISON_DEVICE_ATTEMPT_FROZEN}`，
故单字段判据 MUST NOT 被当作冻结证据。

`MAISON_DEVICE_ATTEMPT_FROZEN=1` 但 `HARNESS_HDC_TARGET` 缺失 MUST 判为冻结上下文损坏并
**fail-closed**：MUST NOT 回落到「隐式选择唯一在线设备」，否则手工设置单个环境变量即可绕过
设备门。

冻结上下文命中时，普通模式入口前置 MUST 整体让路：MUST NOT 重新解析目标、MUST NOT 重新
查询设备策略、MUST NOT 覆盖已注入的 env。

#### Scenario: 只有冻结标记没有目标
- **WHEN** 环境中 `MAISON_DEVICE_ATTEMPT_FROZEN=1` 而 `HARNESS_HDC_TARGET` 为空
- **THEN** 入口前置 MUST 阻断并说明冻结上下文损坏
- **AND** MUST NOT 解析任何目标、MUST NOT 查询设备策略

#### Scenario: goal 注入的完整上下文不被二次处理
- **WHEN** goal 就绪门已注入 target/session/frozen 后 agent 自跑 harness
- **THEN** 入口前置 MUST 复用该目标且不重查策略

> **Enforced by:** `harness/scripts/utils/device-readiness-gate.ts`,
> `harness/tests/unit/device-readiness-gate.unit.test.ts`

### Requirement: Human quality pass keys have zero production consumers

After migration, phase checks, quality-axis derivation, transition policy, closure, and completion SHALL consume no signer identity, human confirmation receipt, accepted-risk state, blind-run waiver, or manual-resume flag as a quality result. Legacy schema fields MAY be tolerated only by explicitly identified readers and negative/migration tests. Ordinary selection/input provenance and genuine external authority SHALL remain separate and MUST NOT lower quality.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `specs/phase-rules/*.yaml`

#### Scenario: production zero-consumer scan

- **WHEN** the framework release checks scan production paths after migration
- **THEN** every remaining human-quality term SHALL match only the explicit legacy-reader/external-authority allowlist and no writer or gate consumer

### Requirement: Plan closure proves contract file-reference authorization

Before plan closure can pass, the harness SHALL parse `contracts.yaml` through the production contracts loader, resolve every schema-defined file reference into a normalized in-memory view, and require `references ⊆ contracts.files`. File references SHALL include at least `resource_keys[*].path`, media paths, page/route registration files, HAR index/builder/export files and every other contracts-schema field that identifies a materialized file. A missing membership MUST produce a plan-phase BLOCKER naming the path and source field.

Enforcement: `harness/scripts/check-plan.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `specs/phase-rules/plan-rules.yaml`

#### Scenario: Undeclared resource media blocks closure

- **WHEN** `resource_keys` references twenty logo media paths and none is present in top-level `contracts.files`
- **THEN** plan closure MUST fail and list the undeclared media references before coding starts

#### Scenario: Adding every referenced path closes the contract

- **WHEN** the same contract is regenerated with all twenty media paths in `contracts.files`
- **THEN** the reference-closure gate SHALL pass without changing any later UI-scope rule

#### Scenario: Legal contract remains unaffected

- **WHEN** every normalized schema-defined file reference is already a member of normalized `contracts.files`
- **THEN** the new gate SHALL not add a warning or failure

### Requirement: Contract reference expansion has one recovery path

The harness MUST NOT authorize a missing reference because the file exists, matches bytes under spec/assets, is generated, is named by another field, or appears in a test-only fact table. The only persistent authorization input SHALL be `contracts.files`; recovery SHALL instruct the plan owner to add the path there and rerun plan closure. The derived reference view MUST remain in memory and MUST NOT be written as a graph, manifest or sidecar.

Enforcement: `harness/scripts/utils/contract-reference-closure.ts`, `harness/scripts/check-plan.ts`, `skills/feature/plan/SKILL.md`

#### Scenario: Matching asset bytes do not grant scope

- **WHEN** an undeclared media file is byte-identical to a referenced spec asset
- **THEN** plan closure MUST still fail until the path is added to `contracts.files`

#### Scenario: Closure writes no derived authorization artifact

- **WHEN** reference closure passes
- **THEN** the feature tree SHALL contain no persisted reference graph, authorization manifest or additional allowlist

### Requirement: Goal phase gates consume a frozen runtime context

Every goal phase gate SHALL be invoked by `GoalPhaseRuntime` only after the applicable `PhaseExecutionContext` has been prepared and frozen. Attended and detached execution SHALL provide the same gate inputs for equivalent run/phase/attempt facts. A gate or executor MUST NOT discover the active run by scanning, reconstruct missing runtime facts from current HEAD/env/provider state, or write a competing phase decision.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Equivalent executor results enter identical gates

- **WHEN** attended and detached executors return equivalent results for the same frozen phase context
- **THEN** the runtime SHALL invoke the same gate path with equivalent inputs and derive the same verdict/backtrack/close semantics

#### Scenario: Executor cannot call a gate directly

- **WHEN** production structure is inspected
- **THEN** no `GoalPhaseExecutor` implementation SHALL import or invoke a phase check/harness entry directly

### Requirement: Hylyre CaseResult steps are the sole testing execution evidence

The testing consumer SHALL read the frozen Hylyre v1 shape: `CaseResult.execution` is `completed|aborted|infrastructure_failed`, `CaseResult.verification` is `passed|failed|inconclusive`, `CaseResult.evidence` is `complete|incomplete`, `CaseResult.expected_check_mode` is `checked_vlm|disabled_by_flag|unavailable_no_vlm|empty`, and `CaseResult.steps[]` is the sole execution ledger. Each `StepResult` carries `index`, `kind`, `role=action|assertion`, `duration_ms`, `device_session`, `outcome`, `selector`, `artifacts`, `diagnostic`, and `extensions`. Machine attribution lives inside `outcome` as a four-way discriminated variant — `passed` carries `observation`, `failed` carries `failure{domain,code}`, `blocked` carries `cause`, `skipped` carries `reason` — never as flat `failure_kind`/`failure_code` fields. `CaseResult.status` still carries the legacy Chinese enum as a compatibility projection and MUST NOT be consumed for any verdict. `StepResult` has no `verification` field. `tool_calls` and Markdown reports SHALL be projections from this trace, never an alternate source; Maison MUST NOT create a step-evidence sidecar, selector ledger, assertion registry, second case state, or synthetic StepResult from logs.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: A failed assertion cannot be laundered by a passed case status

- **WHEN** a legacy or compatibility case status says `通过` but a required assertion StepResult has `outcome.status=failed`
- **THEN** the acceptance gate SHALL NOT pass and SHALL report the uncovered requirement from the authoritative trace

#### Scenario: Action-only execution is inconclusive

- **WHEN** a case contains only `role=action` steps and no checked expected assertion
- **THEN** its execution MAY be `completed`, but its verification SHALL be `inconclusive` for acceptance and it SHALL NOT enter the acceptance pass numerator

#### Scenario: Expected checking is consumed from the trace

- **WHEN** `--skip-assert-expected` is present but deterministic assertion Steps fully cover a checkpoint and the trace records `expected_check_mode=disabled_by_flag`
- **THEN** Maison SHALL use the deterministic StepResult/checkpoint evidence for that acceptance decision and SHALL NOT infer whole-case failure from the CLI flag alone

### Requirement: Acceptance coverage is computed from checkpoint requirements and StepResult status

For native runs, the trace SHALL also be bound to the actual derived plan through the existing run/identity receipt: `trace.artifacts.plan`, top-level plan path/SHA, derived-plan path/SHA, and trace path/SHA SHALL identify the same run. The ordered planned-step count, `index`, and `kind` SHALL match that derived plan case-by-case; at most one `expected_check` StepResult MAY appear as the final tail row. A newer or edited derived plan MUST NOT be used to reinterpret an existing native trace.

Maison SHALL compute acceptance/P0 coverage from the plan's checkpoint requirements and authoritative StepResults. A case enters the acceptance pass numerator only if `execution=completed`, `verification=passed`, `evidence=complete`, all `required_element_ids` map to passed assertion Steps, and all `forbidden_element_ids` map to passed absence assertions. `verification=inconclusive` or `evidence=incomplete` SHALL remain in the uncovered denominator. A case with no assertion Step and no checked expected result SHALL NOT pass. This rule is shared by ordinary interactive and goal testing; goal-only identity and run binding are additional gates and SHALL NOT be removed.

Enforcement: `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/summary-blockers.ts`

#### Scenario: Forbidden evidence is required

- **WHEN** all required presence assertions pass but a checkpoint's forbidden element has no passed absence assertion
- **THEN** the case SHALL remain outside the acceptance pass numerator

#### Scenario: Inconclusive or incomplete evidence is not a pass

- **WHEN** a case has `verification=inconclusive` or `evidence=incomplete` despite an old status of `通过`
- **THEN** the case SHALL be counted as uncovered and SHALL NOT contribute `verification=passed`

### Requirement: Testing failure routing consumes the frozen Hylyre taxonomy

The assertion-mismatch coding route SHALL require `outcome.status=failed` with `outcome.failure.domain=assertion`, and SHALL reject any row that was never attempted (`blocked`/`skipped`, including the unexecuted suffix). Structured routing ownership for rich-text failures SHALL flow into the existing repair-candidate writer: coding/spec/plan owners may produce their corresponding existing category, while capability/external/testing owners produce no coding candidate.

For an attempted, failed step Maison SHALL route by the frozen `outcome.failure.domain` first and its namespaced `outcome.failure.code` only for explanation, never by `diagnostic` text. The closed domain set is `contract|selector|assertion|capability|infrastructure|internal`, and the default responsibility is: `assertion` → coding/product; `selector` → testing re-derivation and, if needed, plan anchors, except that an unresolvable inline target routes to a coding anchor or a spec/plan target definition; `capability` → capability defer and never coding; `infrastructure` → external/toolchain; `contract`/`internal` → testing fail-closed. An unknown namespaced code SHALL still route by its domain rather than fall through. An explicit skip or unexecuted case without StepResult has no machine failure taxonomy and SHALL remain testing FAIL with zero automatic coding candidates, unless the existing capability resolution provides a provider-missing fact. Maison MUST NOT invent a third failure enum or infer responsibility from prose.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: Assertion mismatch produces a coding candidate

- **WHEN** an attempted step has `outcome.status=failed` with `outcome.failure.domain=assertion`
- **THEN** the existing coding repair-candidate route MAY receive the finding

#### Scenario: Unsupported capability does not produce a coding candidate

- **WHEN** an attempted step has `outcome.status=failed` with `outcome.failure.domain=capability`
- **THEN** the finding SHALL defer through capability routing and SHALL produce no coding candidate

#### Scenario: Error prose is not a primary route

- **WHEN** an explicit skip has only a TC id, notes, or an error-like sentence and no StepResult/capability resolution
- **THEN** Maison SHALL keep testing FAIL and SHALL not classify it as coding or capability from that text

### Requirement: Testing uses a three-part Hylyre evidence gate and a bounded legacy policy

The new StepResult reconciliation path SHALL be enabled only when all three facts hold: Hylyre version is at least the configured minimum (`0.5.0`), the authoritative trace declares schema `0.4-p0` together with result protocol `hylyre.step-outcome/1`, and the trace actually validates against the frozen `output-schema.json` shipped in the vendored contracts **and** against the frozen cross-row invariants (prior_step root references, CaseResult three-axis reduction, run outcome, `candidate_count` recomputation, `tool_calls` projection). Envelope declaration alone SHALL NOT satisfy this requirement: a trace carrying flat `0.3` step fields under a `0.4-p0` envelope MUST be rejected. Version discovery SHALL reuse `hylyre-ready.meta.json → release.manifest.json → manifest.hylyre_version`; the installed/manifest/trace environment chain must agree, and version alone is insufficient. If any fact is false, every legacy case's old pass/status—including wait_for, wait_gone, toast, action-only, expected-unchecked, and no-evidence-axis cases—MUST be marked `legacy_assertion_evidence_untrusted` and MUST NOT independently contribute `verification=passed`; the default action is to upgrade Hylyre and rerun. Existing historical runtime telemetry may provide limited legacy evidence only for a specifically proven checkpoint with action hit, required/forbidden observations, and identity binding; new runs SHALL NOT invoke the deleted monkey-patch producer, and telemetry MUST NOT synthesize a generic CaseResult or StepResult ledger.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/hylyre-vendor-sync.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: An old version blocks new evidence consumption

- **WHEN** the reported Hylyre version is below the minimum even though a legacy case status is `通过`
- **THEN** the case SHALL be untrusted for verification and testing SHALL request an upgraded rerun

#### Scenario: A new version with an old schema still blocks

- **WHEN** the version is new but the trace schema lacks `CaseResult.evidence` or `CaseResult.steps[]`
- **THEN** the new path SHALL remain disabled and the legacy status SHALL not pass the acceptance gate

#### Scenario: Complete legacy telemetry is narrowly reusable

- **WHEN** the three-part gate is unavailable but existing telemetry completely proves one named checkpoint's action hit, required/forbidden observations, and run/attempt/device identity
- **THEN** only that checkpoint MAY be used as legacy evidence; no generic StepResult ledger SHALL be synthesized

### Requirement: Selector authorization and execution are two separate evidence gates

Static authorization, runtime verification, and P0 checkpoint mapping SHALL use one shared planned-step normalizer for direct roots, `action` wrappers, `all[]` match inheritance, `within`/`scope`/`index`, current-screen context, and canonical target IDs.

The feature ui-spec is an **open world**: it models the screens this feature adds and is not a closed registry of the whole application, so pre-existing entry screens are legitimately absent from it. The derive/static selector gate SHALL therefore emit a BLOCKER only for an error it can actually determine:

- a structurally illegal selector or an illegal `match` value;
- a formal `by_text` selector without an explicit `match` of `exact` or `contains` (the choice SHALL come from acceptance intent, not character heuristics);
- a selector the ui-spec itself proves is multi-mapped **on a uniquely determined current screen** while the plan carries no `index`, `scope`, `within`, or `all` disambiguator — when the current screen cannot be determined statically, candidates spread across screens are missing static information and SHALL be a WARN, not a BLOCKER;
- a `contains` selector whose only ui-spec hit is an aggregate Text/Row with children and no independently declared interaction target;
- an explicit conflict with an acceptance checkpoint, as bounded below.

A `by_id` or `by_text` selector that is merely absent from the feature ui-spec SHALL be a provenance WARN and SHALL NOT block execution; absence from an open-world document is missing static information, not proof of an illegal selector. Runtime dumps and snapshot caches MAY suggest selectors or emit WARNs but SHALL NOT authorize a static PASS.

The checkpoint-conflict BLOCKER SHALL be structural only: the same acceptance checkpoint already binds an action step declaring `target_element_id`, the plan's bound action declares `by_id`, both are non-empty, and the two differ. Maison MUST NOT extract an intended target from case names, preconditions, expected text, contracts prose, or neighbouring steps, and MUST NOT union ui-spec with acceptance or contracts into a second canonical selector registry. Acceptance and contracts MAY only explain provenance and responsibility inside a WARN.

Step success SHALL be decided by `outcome` and its `observation`; `selector.resolution` records the identity facts the executor actually obtained and is **not a second success state** for every operation. The runtime gate MUST NOT be written as a fixed bypass keyed on `request.kind`, because the real semantics follow the execution path: native provider-side resolution of a present `by_id`/`by_key` target yields `unique` with a real structured identity; native provider-side resolution of a target whose identity is invisible to the executor legitimately yields `outcome=passed` with `resolution=not_attempted`; and a resolver that itself resolves a text node may yield `unique` with `selected.id=null` and a non-empty `selected.bounds`.

Where `unique` is claimed it SHALL be strict: `candidate_count=1`, `selected` non-null, at least one of `selected.id`/`selected.bounds` non-empty, and the request value SHALL NOT be backfilled into `selected.id` to impersonate a real identity. `not_attempted` means **no identity evidence**: it SHALL NOT flip an otherwise legal passed step to failed, and it SHALL NOT be read as proof that a target was actually selected — a downstream identity requirement simply stays unproven. `not_found` is the resolver's confirmed zero-candidate fact, not a blanket failure: a passing absence assertion legitimately carries `not_found` with `candidate_count=0` and `selected=null`. `ambiguous` and `unresolvable` SHALL be consumed per the frozen contract and builder decision table, without deriving a second status from resolution.

The runtime gate SHALL NOT reject a hit merely because that selector is absent from the feature ui-spec; the ui-spec MAY still prove a known ambiguity, but a ui-spec miss is not a runtime failure condition. Identity guardrail: a P0 checkpoint's required/forbidden identity evidence SHALL be carried by `by_id` assertions — a successful `by_text` observation SHALL NOT substitute for identity proof, since `required_element_ids` are ids. Rich-text fragments SHALL be independently declared interaction targets and SHALL fail as an unresolvable inline target when real fragment semantics/bounds are unavailable; Maison MUST NOT click a parent Text/Row center or estimate coordinates and MUST NOT implement OCR here.

Enforcement: `profiles/hmos-app/harness/selector-contract.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/hylyre-selector-gates-v1.ts`

#### Scenario: Canonical contains is statically valid only when unique

- **WHEN** an explicit `match=contains` selector maps to one canonical ui-spec node on its screen
- **THEN** static selector authorization SHALL pass independently of the current dump/cache contents

#### Scenario: Ambiguous canonical text is rejected without disambiguation

- **WHEN** the same contains substring maps to multiple canonical nodes and no existing disambiguator is present
- **THEN** static authorization SHALL fail and SHALL not choose a candidate from the dump

#### Scenario: Runtime ambiguity is rejected

- **WHEN** an executed StepResult reports `resolution.state=ambiguous` with `candidate_count>1` and no existing disambiguator actually selected one
- **THEN** the action SHALL fail with the frozen selector classification rather than silently selecting the first candidate

#### Scenario: A selector outside the feature ui-spec warns instead of blocking

- **WHEN** a plan targets a pre-existing entry element by `by_id` that the feature ui-spec does not model, and no ambiguity, illegal match, aggregate-parent, or checkpoint conflict applies
- **THEN** the static gate SHALL emit a provenance WARN, SHALL allow the case to compile and run, and the run's own native selector evidence SHALL decide legitimacy

#### Scenario: Missing identity evidence neither fails nor credits a step

- **WHEN** a native step passes with a matching observation while its `selector.resolution` is `not_attempted`
- **THEN** the runtime gate SHALL NOT raise a selector violation, and SHALL NOT record a proven selected-target identity for it
- **WHEN** a step failed and its resolution is `not_attempted`
- **THEN** it SHALL still route by `outcome.failure` and SHALL NOT be laundered into a pass

#### Scenario: A resolver-resolved text node is a legal unique

- **WHEN** `resolution.state=unique` carries `candidate_count=1`, `selected.id=null` and a non-empty `selected.bounds`
- **THEN** it SHALL be accepted
- **WHEN** `selected.id` merely echoes the request value
- **THEN** it SHALL be rejected as an impersonated identity

#### Scenario: Cross-screen duplication without a known screen is not a determinable error

- **WHEN** the same selector maps to nodes on two screens and the case's precondition does not uniquely determine the current screen
- **THEN** the static gate SHALL WARN and allow execution, leaving the decision to the run's own selector evidence
- **WHEN** the current screen is uniquely determined and that screen alone holds multiple candidates without a disambiguator
- **THEN** the static gate SHALL BLOCK

#### Scenario: A structured checkpoint conflict blocks while prose does not

- **WHEN** an acceptance checkpoint structurally binds an action with `target_element_id` that differs from the plan action's non-empty `by_id`
- **THEN** the static gate SHALL BLOCK
- **WHEN** the checkpoint has no structured action binding and only its prose mentions a different element
- **THEN** no conflict SHALL be declared and no ID SHALL be inferred from that prose

### Requirement: Report-only reconciliation fully recomputes testing projections without a device

For native `schema_version=0.4-p0`, the timing producer SHALL sum each case's `steps[].duration_ms` and set `step_count` to the native ledger row count; log `cost:` allocation is permitted only for legacy schemas. Blocked, skipped, and trailing `expected_check` rows SHALL remain in the native case duration calculation.

Testing SHALL expose `--report-reconcile-only` as a testing-specific mode that reads only the existing authoritative trace, test plan, final device-test timing, build/install/run metadata, and current report inputs. It SHALL not invoke hvigor, hdc, Hylyre, any device/provider execution, visual capture, or executable lifecycle hook; it SHALL not create a new phase or sidecar. The mode SHALL rerun the complete report/static checks and use the existing writers to fully recompute `script-report`, summary, quality axes, and repair candidates rather than patching selected fields. The authoritative trace bytes SHALL remain unchanged. Before the writers consume the inputs, the mode SHALL close the same final run using existing fields: build/install `hapPath` and current HAP content fingerprint, build/install/run timestamps and `run_ended_at`, `timing.generated_at`, build/install reused values, trace feature, exact trace/timing case-id sets, run `trace_path`/`report_path`/`log_path`, and every report pipeline/case duration value. Report duration fields SHALL use exact integer milliseconds in `Nms` form (a valid comma-grouped form such as `1,234ms` MAY be read for legacy reports); a skip or blocked case already present in trace/timing SHALL use `0ms`, while `—` is reserved for an explicit skip not present in trace/timing. A missing or mismatched field SHALL FAIL closed. Report generation SHALL count skips in the correct denominator, use final build/install reused state and final timing, and backfill every case duration from the final run.

Enforcement: `harness/scripts/check-testing.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/summary-blockers.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `skills/reference/device-testing-workflow-detail.md`

#### Scenario: Reconciliation uses no device tools or lifecycle hooks

- **WHEN** an existing run has authoritative trace, plan, timing, report, and build/install/run metadata
- **THEN** `--report-reconcile-only` SHALL complete report/static reconciliation without invoking hvigor, hdc, Hylyre, device/provider execution, visual capture, or any executable lifecycle hook

#### Scenario: Reconciliation preserves the trace and recomputes outputs

- **WHEN** the report or summary contains stale derived values before report-only reconciliation
- **THEN** the mode SHALL leave trace bytes identical, reject any cross-run artifact combination, and rewrite the complete derived report/summary/quality axes from the authoritative inputs

### Requirement: Native StepResult evidence retires the telemetry bridge in stages

When native StepResult evidence is present, Maison SHALL consume only that evidence. Historical old-schema telemetry may be read for its actual pre/post dump, action hit, required/forbidden observation, and identity-bound checkpoint facts, but new runs SHALL invoke Hylyre directly and SHALL NOT use a private `_execute_one_step` monkey-patch. When both are present, native StepResult SHALL be authoritative and any mismatch SHALL be an explicit consistency warning, never a second verdict source; no compatibility layer may synthesize a generic `CaseResult.steps[]` ledger.

Enforcement: `profiles/hmos-app/harness/providers/device-test-run.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/hylyre-failure-routing-v1.ts`, `harness/scripts/check-testing.ts`

#### Scenario: Native evidence wins when both sources are present

- **WHEN** a trace contains native StepResults and old telemetry for the same checkpoint with different outcomes
- **THEN** Maison SHALL use the native StepResult outcome and emit a consistency warning without changing the verdict source

#### Scenario: Old telemetry cannot prove an unobserved checkpoint

- **WHEN** old telemetry lacks an action hit, required/forbidden observation, or identity binding for a checkpoint
- **THEN** that checkpoint SHALL remain unproven and Maison SHALL not synthesize a StepResult for it

### Requirement: Every top-level test case declares one compile-time execution channel

The top-level `test-plan.md` SHALL declare exactly one `execution_channel` per test case, with the frozen value domain `hylyre`, `visual`, `manual`, or `provider:<capability-id>`. The channel is a compile-time dispatch declaration authored and reviewed by the test author; it is not an execution status and SHALL NOT create a second result ledger. A formal plan whose case lacks a channel, declares an illegal value, or declares the same test case id on more than one row SHALL FAIL as a one-time migration requirement; a repeated id fails even when both rows carry the same value, because a duplicate cannot prove uniqueness and would place one case into two channel sets at once. Maison MUST NOT guess a channel from case names, prose steps, priority, or capability heuristics. The declaration SHALL be resolved once **before any build, install, Hylyre, or device action**: when it does not close, the run SHALL emit a structured BLOCKER with zero device calls and SHALL NOT execute the merely-legal subset. What a broken declaration blocks is device action, not analysis: the device-free report-only mode SHALL still recompute in full, because its own BLOCKER already keeps the phase failing and a historical run must remain diagnosable. The channel column SHALL participate in test-plan review and phase evidence/freshness: changing a channel changes plan identity and MUST NOT be rewritten silently during derive, execution, or report reconciliation. A P0 device checkpoint retains its runtime StepResult evidence obligation regardless of channel; `visual` and `manual` SHALL NOT be used to bypass it. Legacy plans without the column remain readable for historical artifacts only and SHALL NOT have their old explicit skips laundered into passes.

Enforcement: `harness/scripts/utils/test-plan-derive-hint.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/skills/device-testing/templates/test-plan-template.md`, `profiles/generic/skills/device-testing/templates/test-plan-template.md`

#### Scenario: A formal plan without the channel column blocks once

- **WHEN** a formal `test-plan.md` case carries no `execution_channel`
- **THEN** testing SHALL FAIL with a one-time migration instruction and SHALL NOT infer a channel from the case text

#### Scenario: An illegal channel value blocks

- **WHEN** a case declares `execution_channel` outside `hylyre|visual|manual|provider:<capability-id>`
- **THEN** the plan structure gate SHALL FAIL and name the frozen value domain

#### Scenario: A duplicated case id is rejected

- **WHEN** the same test case id appears on two rows of the case table, whether with the same channel or with two different channels
- **THEN** the declaration SHALL FAIL and that id SHALL NOT be counted into any channel set

#### Scenario: A broken declaration costs no device action

- **WHEN** the declaration is missing, incomplete, illegal, or duplicated
- **THEN** the run SHALL stop before build, install, Hylyre, and any device call, and SHALL NOT produce a partial trace from the legal subset

#### Scenario: Changing a channel changes plan identity

- **WHEN** a channel value differs between the reviewed top-level plan and the artifact consumed at execution or report reconciliation
- **THEN** the run SHALL FAIL closed rather than silently adopting the rewritten channel

### Requirement: Non-Hylyre channel cases carry a machine evidence obligation

A test case whose `execution_channel` is not `hylyre` SHALL still owe machine evidence, and SHALL remain in the pass-rate denominator as FAIL/UNVERIFIED until that evidence closes. A channel declaration is a dispatch fact, never a pass.

For `visual`, the obligation MAY close only through a binding whose every hop is an id-to-id lookup over existing structured artifacts: the case's structured acceptance references in the top-level plan, then those acceptance criteria's structured `checkpoint.pre_screen`/`post_screen`, then the same screen ids in the feature's authoritative visual-diff report. Maison MUST NOT infer the binding from case names, notes, linked flows, or report prose, and a missing hop SHALL be unbound rather than covered. The report SHALL be read from the feature's own visual artifact directory, validated by the existing visual-diff validator, and each bound screen SHALL additionally pass the existing evaluated-screenshot-hash, build-fingerprint, and evaluation-freshness checks; a screen whose recorded verdict cannot be re-verified against the on-disk screenshot and the current build SHALL NOT close the obligation. This obligation SHALL be evaluated **after** the visual capture and the visual gate itself, and SHALL consume that gate's actual verdict for the current run: an obligation evaluated before its evidence exists can only consume a stale artifact and SHALL NOT be treated as proof. Maison MUST NOT introduce a second, weaker reader of the visual report.

For `provider:<capability-id>`, the obligation SHALL remain fail-closed until the provider itself emits per-test-case results — at minimum a test case id, a machine-decided outcome, and a re-checkable artifact reference bound to the current run identity. Feature-level capability resolution state SHALL NOT close it: that a capability resolved does not prove that a given case executed and passed.

For `manual`, the obligation SHALL remain permanently fail-closed by design. Human confirmation, a confirmation receipt, a quality receipt, or a manual resume SHALL NOT satisfy it.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/execution-channel.ts`

#### Scenario: A visual case closes only through the full id chain over fresh evidence

- **WHEN** a `visual` case declares structured acceptance references whose checkpoints declare screens, the current-run visual gate passed, and every bound screen in the feature's visual-diff report carries a re-verifiable passing verdict for the current build
- **THEN** the obligation SHALL close for that case, and the closure SHALL cite the case, the acceptance ids, and the screen ids

#### Scenario: A visual case with an unverifiable screen verdict stays uncovered

- **WHEN** a bound screen's recorded verdict cannot be re-verified — the evaluated screenshot hash is absent or no longer matches the on-disk file, the evaluated build fingerprint is not the current build, or the evaluation is marked invalidated
- **THEN** the obligation SHALL NOT close, and the failure SHALL name the screen and the specific re-verification that failed

#### Scenario: The obligation is not evaluated before its evidence exists

- **WHEN** the channel evidence obligation would run before the visual capture and visual gate of the current run
- **THEN** it SHALL NOT close from any pre-existing artifact, because such an artifact cannot prove the current run

#### Scenario: A resolved capability does not close a provider case

- **WHEN** a `provider:<capability-id>` case's capability resolves successfully but no per-test-case provider result exists
- **THEN** the obligation SHALL remain unbound and the case SHALL stay FAIL/UNVERIFIED

### Requirement: The Hylyre channel compiles all-or-nothing and the derive writer owns no skip decision

The formal derive writer SHALL emit exactly the set of test cases whose top-level `execution_channel` is `hylyre`, and SHALL NOT add, remove, or rewrite a channel. It SHALL NOT emit new `explicit_skip_tc_ids`; legacy explicit-skip frontmatter and derive-manifest entries remain readable for historical artifacts only and SHALL NOT be produced by a new writer. When any `channel=hylyre` case fails to compile — unparseable steps, a step-lint BLOCKER, a selector-contract BLOCKER, or a missing same-case setup/navigation action before its first assertion — the whole Hylyre run plan SHALL NOT start, and the compiler SHALL report that case's real root cause and next responsible phase instead of degrading it to a skip.

Every `channel=hylyre` case SHALL contain at least one action step before its first assertion step in the same case. This is a structural minimum that keeps a page assertion from being evaluated on an unentered screen; it is not a screen state machine. The linter SHALL NOT parse precondition prose, derive cross-case screen state, or build a reachability graph.

Enforcement: `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/derive-hylyre-plan-hint.ts`

#### Scenario: An uncompilable entry case stops the whole run

- **WHEN** one `channel=hylyre` entry case cannot be compiled
- **THEN** no Hylyre plan SHALL be started, the report SHALL name that case's root cause and next responsible phase, and the writer SHALL NOT move it into an explicit skip

#### Scenario: An assertion without a same-case setup action does not compile

- **WHEN** a `channel=hylyre` case's first step is an assertion with no preceding action step in that case
- **THEN** compilation SHALL FAIL for that case, and therefore for the whole Hylyre plan

#### Scenario: New derive output carries no explicit skip

- **WHEN** a formal derive writes a new `test-plan.hylyre.md`
- **THEN** it SHALL contain no `explicit_skip_tc_ids`, while an existing historical artifact carrying them SHALL still be readable

### Requirement: The manual channel keeps an open obligation and cannot close a quality gate

`manual` SHALL mean the test obligation currently has no machine evidence carrier. Maison SHALL NOT provide a manual pass writer, `confirmed_by`, human quality receipt, or manual resume that closes testing for the run. Any case declared `manual` SHALL remain in the denominator as FAIL/UNVERIFIED, and the feature's testing verdict SHALL NOT reach PASS while such a case exists. This is frozen design rather than an executor defect, and the guidance SHALL state it plainly. A human observation MAY become correction input for a later phase, but never evidence that closes this run.

`visual` is intended to route into the existing visual capture/diff evidence path and `provider:<capability-id>` into the existing capability registry; neither may pass without its own machine evidence. A registered capability whose provider is missing or cannot be resolved SHALL surface as an explicit capability gap and SHALL NOT be converted into a skip; an id absent from the capability registry is a `plan_contract` BLOCKER at declaration time and never reaches capability resolution.

Because non-Hylyre cases are deliberately excluded from the derived/trace/timing exact sets, they SHALL still be adjudicated by an explicit obligation carrier rather than by a self-reported report row. Until a per-case evidence binding exists for a channel — a machine mapping from the case to its visual target or to its capability evidence — every case on that channel SHALL remain in the denominator as FAIL/UNVERIFIED. Fail-closed is required here: a channel with no binding MUST NOT be treated as passed, and the gap SHALL be reported as a missing binding rather than as an executor defect.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/capability-registry.ts`

#### Scenario: A manual case keeps the feature out of PASS

- **WHEN** every other case passes and one case is declared `manual`
- **THEN** testing SHALL remain FAIL/UNVERIFIED for the feature and no writer SHALL accept a human confirmation as this run's evidence

#### Scenario: A channel without a per-case evidence binding cannot pass

- **WHEN** a case is declared `visual` or `provider:<capability-id>` and no machine binding proves that case's own evidence
- **THEN** it SHALL stay in the denominator as FAIL/UNVERIFIED and SHALL NOT be closed by a report row that claims it passed

#### Scenario: A missing provider is a capability gap, not a skip

- **WHEN** a case declares `provider:<capability-id>` for a registered capability whose provider cannot be resolved
- **THEN** the run SHALL report an explicit capability gap and SHALL NOT rewrite the case as skipped

### Requirement: Coverage and report-only reconciliation are channel-precise

Derived-plan, trace, and timing exact-set reconciliation SHALL close against the `channel=hylyre` subset only. Non-Hylyre cases SHALL NOT be reported as missing trace rows, missing timing rows, or laundered as legacy explicit skips; each channel SHALL be reconciled by its own evidence rule. The report's overall denominator SHALL still close against every top-level test case, so a non-Hylyre case without evidence stays visible and unpassed. `--report-reconcile-only` SHALL apply the same channel-precise sets and SHALL NOT report trace-missing for a case that was never routed to Hylyre.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/utils/testing-trace-gates.ts`

#### Scenario: A visual case is not reported as missing from the trace

- **WHEN** a case is declared `visual` and therefore absent from the Hylyre derived plan, trace, and timing
- **THEN** the derived/trace/timing reconciliation SHALL treat the Hylyre sets as exactly closed and SHALL NOT emit a trace-missing finding for that case

#### Scenario: The overall denominator still covers every case

- **WHEN** the Hylyre subset reconciles exactly but a `manual` case has no evidence
- **THEN** the report denominator SHALL still include that case and the feature SHALL NOT be reported as fully covered

### Requirement: One fail-closed boundary dispatches trace schema and result protocol

Acceptance for any of these gates SHALL be driven by the frozen contract package's own golden corpus or by a released entry's real output. A hand-assembled trace, receipt, or evidence document SHALL NOT stand in for it, and a negative test SHALL assert the specific rejection reason rather than only the verdict: an assertion that merely observes FAIL cannot distinguish "rejected for the reason under test" from "rejected because the fixture itself was invalid", and has already hidden three separate invalid fixtures in this change. A test that drives a vendored CLI SHALL be proven device-free by inspecting that entry's source before it is registered in the default suite.

Maison SHALL decide the trace schema version and the declared result protocol at a single parse boundary and SHALL NOT scatter per-helper schema guesses across consumers. The boundary SHALL classify three outcomes: the frozen Hylyre Step Outcome protocol pair enters typed consumption **after** passing the frozen schema and cross-row verification; `0.3-p0` and `0.2` are explicitly legacy-unsupported-for-evidence and MAY be read only as non-blocking diagnostics; every other, missing, or mismatched combination is an explicit BLOCKER. The typed view SHALL NOT be produced by a bare type assertion — the boundary MUST validate against the frozen `output-schema.json` carried by the vendored contracts (the release excludes `harness/tests/**`, so a fixture path is not a legal production source) and MUST fail closed when that schema cannot be located, cannot be parsed, or uses a keyword the validator does not implement. No required testing gate may answer a schema mismatch by returning an empty result set, SKIP, or a no-op, and none may fall back to legacy Chinese case status, flat step fields, `tool_calls`, logs, or the retired runtime telemetry. An optional diagnostic helper MAY declare itself not-applicable after the boundary has dispatched, but MUST NOT swallow an unknown schema itself.

When Hylyre exits non-zero and produced no trace, the consumer SHALL first attempt the frozen pre-run plan-contract rejection envelope on stdout and classify a valid rejection as a testing/plan-contract failure. Only a missing, invalid, or protocol-mismatched envelope SHALL fall through to the existing subprocess crash classifier, which is an out-of-protocol backstop that MUST NOT read or synthesize protocol results. Standard error text SHALL NOT participate in machine classification.

The concrete typed field shapes — outcome variants, failure/cause/reason and resolution code faces, selector request/resolution, artifacts, and CaseResult/RunResult reduction — are owned by the external Hylyre contract freeze and are deliberately NOT restated here; this requirement fixes only the dispatch discipline that holds regardless of those shapes.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`, `profiles/hmos-app/harness/hylyre-spawn.ts`

#### Scenario: An unknown schema fails loudly instead of returning nothing

- **WHEN** a required testing gate receives a trace whose schema/protocol pair is unknown or mismatched
- **THEN** the gate SHALL emit an explicit BLOCKER and SHALL NOT return an empty result set, SKIP, or a legacy-status fallback

#### Scenario: A valid pre-run rejection is a plan-contract failure, not a crash

- **WHEN** Hylyre exits non-zero with no trace and stdout carries a single valid pre-run rejection envelope
- **THEN** the result SHALL be classified as a testing/plan-contract failure and SHALL NOT enter the subprocess crash classifier

#### Scenario: A missing envelope still reaches the crash backstop

- **WHEN** Hylyre exits non-zero with no trace and no valid rejection envelope on stdout
- **THEN** the existing subprocess crash classifier SHALL run and SHALL NOT fabricate a protocol result

### Requirement: A responsibility failure route requires an actually-executed failure

Exactly one responsibility failure route SHALL be produced per step that was actually attempted and actually failed. Ledger-completeness rows for steps that were never attempted — the unexecuted suffix after a root failure, and policy-skipped expected checks — SHALL produce zero failure routes, zero owner assignments, and zero coding candidates; they explain causality only and SHALL NOT inherit the root failure's classification. A case carrying no step ledger at all SHALL produce zero failure routes; that gap is reported only by execution completeness, which keeps it a testing-owned FAIL. Several genuinely failed steps in one case SHALL each produce their own route, with no first-only deduplication. Summary blockers and repair-candidate budgets SHALL consume only real failure routes, so one root failure cannot consume budget proportional to the number of unexecuted rows.

A machine-proven capability or infrastructure blockage that prevented execution SHALL produce zero failure routes and exactly one existing capability defer or external/toolchain disposition per root cause, deduplicated by case, index, and cause; the unexecuted suffix that depends on it SHALL NOT project again. A capability failure that did occur after the operation was attempted SHALL produce its single failure route whose disposition is the existing capability defer with zero coding candidates.

An assertion mismatch SHALL be admitted as a coding candidate only when the same case contains a smaller-index action step that actually passed. Without that fact the route SHALL stay testing-owned with zero coding candidates, so a first assertion evaluated on the wrong screen cannot forge a product-fix candidate. Maison MUST NOT derive that precondition from prose, diagnostics, or a neighbouring case.

Enforcement: `harness/scripts/utils/hylyre-failure-routing-v1.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/check-testing.ts`

#### Scenario: One root failure does not multiply into many routes

- **WHEN** a case records one genuinely failed step, five unexecuted rows that depend on it, and one policy-skipped expected check
- **THEN** exactly one responsibility failure route SHALL be produced and the unexecuted and skipped rows SHALL produce none

#### Scenario: A blocked capability defers without a failure route

- **WHEN** a step never executed because a machine probe proved the required capability unavailable
- **THEN** zero failure routes SHALL be produced, exactly one capability defer SHALL be projected, and the dependent unexecuted suffix SHALL NOT project a second one

#### Scenario: A wrong-screen first assertion is not a coding candidate

- **WHEN** the first failing assertion in a case has no smaller-index action step that passed
- **THEN** the route SHALL be testing-owned with zero coding candidates
- **WHEN** a smaller-index action step in that case did pass
- **THEN** the assertion mismatch MAY produce one coding candidate

### Requirement: A provider channel id must exist in the capability registry at plan time

`provider:<capability-id>` is a compile-time dispatch declaration, and its id SHALL be checked for **existence** in the capability registry when the execution-channel declaration is resolved — before any build, install, Hylyre, or device action — not after the run has finished. The registry is the active profile's declared `capabilities` map (`ctx.resolvedProfile.capabilities`). Both the declared id and every registry key are normalized with `normalizeCapabilityKey` (explicit alias table only) and MUST match by exact string equality: Maison SHALL NOT fold hyphen/underscore/dot variants, case, prefixes, or similarity into a match, because guessing a capability from its name is the same discipline violation as guessing a channel from case prose. A registered capability whose severity is `SKIP` exists for this check; whether it is usable remains the responsibility of capability resolution and the channel evidence obligation.

An unknown id SHALL make the declaration not closed (`ok=false`): `testing_execution_channel` SHALL FAIL as a `plan_contract` BLOCKER, the device pipeline SHALL NOT start, and the detail SHALL say that the capability does not exist in the registry so the case can never pass, name the registered capability keys (normalized, sorted; an empty registry is stated explicitly), and direct the author to change the channel or register the capability with a provider. Device-free report-only reconciliation SHALL still recompute in full. `parseExecutionChannel` remains a pure lexical parser and SHALL NOT read the profile; plans without provider cases SHALL be unaffected.

Enforcement: `harness/scripts/utils/execution-channel.ts`, `harness/scripts/check-testing.ts`

#### Scenario: An unregistered provider id blocks before any device action

- **WHEN** a top-level test case declares `execution_channel=provider:device-test.perf-probe` and the active profile registers no capability with that normalized key
- **THEN** `testing_execution_channel` SHALL FAIL with `failure_kind=plan_contract`, the detail SHALL list the registered capability keys, and no build, install, Hylyre, or device call SHALL be made

#### Scenario: A registered id passes the existence check without proving a result

- **WHEN** a case declares `provider:device_test.visual_diff` and the profile registers `device_test.visual_diff`, including with `severity: SKIP`
- **THEN** the declaration SHALL treat the id as existing and the case SHALL continue to be judged only by capability resolution and the channel evidence obligation

#### Scenario: A separator or case variant is not a match

- **WHEN** the plan declares `provider:device_test.visual-diff` or `provider:Device_Test.visual_diff` while the profile registers `device_test.visual_diff`
- **THEN** the id SHALL be treated as unknown and the declaration SHALL FAIL

#### Scenario: Report-only is not truncated by an unknown id

- **WHEN** `--report-reconcile-only` runs against a historical run whose top plan carries an unknown provider id
- **THEN** the run SHALL still recompute every report projection and keep the phase failing through the declaration BLOCKER alone

### Requirement: A Hylyre case may reset the app only with a leading stop_app→start_app preamble

Formal derived Hylyre plans compile in one shared device session and do not clear the navigation stack between cases. A case that needs a known starting state MAY begin with exactly one **reset preamble**: `{"stop_app":{"bundle":B}}` immediately followed by `{"start_app":{"bundle":B,"page_name":P}}`, placed at the head of the case. `B` and `P` SHALL equal the identity the harness itself uses for its pre-launch (the install candidate bundle name and the resolved Hypium page name) and SHALL be injected into the linter and the derive knowledge by the harness; the derive writer SHALL NOT invent them. The step linter SHALL reject a `start_app` without a directly preceding `stop_app`, a `stop_app` that is not immediately followed by `start_app`, any `start_app` or `stop_app` outside the case head, a second lifecycle group in the same case, a preamble whose bundle or page name differs from the harness identity, and a preamble whose identity cannot be resolved. The decision rule is deliberately simple: only step index 0 may be `stop_app` and only step index 1 may be `start_app`, and any `start_app`/`stop_app` root key at any other index is a STEP-003 BLOCKER — this is what makes the preamble exactly one and always paired. `clear_app` is not part of this preamble and SHALL NOT be added by the derive writer; the `action`-wrapped `start_app` form remains rejected. The adhoc steps path keeps its full `start_app` prohibition because the harness cold-restarts there. Runner-level pre-launch and cold restart behavior SHALL NOT change, and no screen state machine, reachability graph, or Hylyre teardown state machine SHALL be introduced.

Enforcement: `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/utils/hylyre-standard-derive-knowledge.ts`, `harness/scripts/utils/hylyre-planned-step-lint.ts`, `harness/scripts/check-testing.ts`

#### Scenario: A leading stop_app→start_app preamble compiles

- **WHEN** a `channel=hylyre` case begins with `stop_app` and `start_app` carrying the harness bundle and page name, followed by its business steps
- **THEN** the step linter SHALL report zero violations for the preamble, and NAV/STEP-SETUP rules SHALL treat it as a setup action

#### Scenario: start_app without stop_app is rejected

- **WHEN** a case begins with `start_app` and no directly preceding `stop_app`
- **THEN** compilation SHALL FAIL for that case with a STEP-003 BLOCKER

#### Scenario: stop_app without start_app is rejected

- **WHEN** a case begins with `stop_app` and the next step is a business step or the case ends
- **THEN** compilation SHALL FAIL for that case with a STEP-003 BLOCKER

#### Scenario: A second reset preamble in the same case is rejected

- **WHEN** a case begins with `stop_app`, `start_app`, `stop_app`, `start_app`
- **THEN** compilation SHALL FAIL for that case, because at most one preamble is allowed and any lifecycle root key beyond index 0/1 is rejected

#### Scenario: A lifecycle step in the middle of a case is rejected

- **WHEN** `start_app` or `stop_app` appears after the first business step of a case
- **THEN** compilation SHALL FAIL for that case

#### Scenario: A preamble with a foreign identity is rejected

- **WHEN** the preamble's `bundle` or `page_name` differs from the harness pre-launch identity, or that identity cannot be resolved
- **THEN** compilation SHALL FAIL and the detail SHALL name the expected identity source

#### Scenario: The adhoc path still forbids start_app

- **WHEN** an adhoc steps file contains `start_app` in any position
- **THEN** the adhoc linter SHALL reject it as before

