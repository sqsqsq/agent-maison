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

#### Scenario: PRD phase has check and rule pair
- **WHEN** harness-runner executes the `prd` phase
- **THEN** it MUST invoke `harness/scripts/check-spec.ts` against `specs/phase-rules/spec-rules.yaml`

#### Scenario: Workflow DAG defines phase dependencies
- **WHEN** harness resolves the active workflow
- **THEN** it MUST load `workflows/spec-driven.workflow.yaml` (or the configured `active_workflow`) and honor each artifact's `requires` dependencies

> **Enforced by:** `workflows/spec-driven.workflow.yaml`, `specs/workflow-schema.json`, `harness/scripts/check-*.ts`, `specs/phase-rules/*.yaml`

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

Enforcement: `harness/scripts/utils/canonical-gitignore.ts`, `harness/scripts/utils/init-task-executor.ts`

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
The closure finalizer SHALL validate evidence, construct final summary 1.2 bytes, generate the phase evidence manifest from the staged summary hash while recording the canonical summary path, strictly update `.current-phase.json`, and atomically publish the staged summary last. Enforcement SHALL be implemented in `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-state.ts`, and `harness/scripts/utils/phase-evidence-manifest.ts`.

#### Scenario: Manifest generation fails
- **WHEN** closure evidence validation passes but attestation, manifest, or pointer generation fails
- **THEN** canonical summary MUST remain open and downstream recommendation MUST remain ineligible

#### Scenario: Staged summary is published
- **WHEN** finalization succeeds
- **THEN** recomputing the manifest entry for canonical `summary.json` SHALL match the bytes published by the atomic rename

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

`fidelity_capability_pregate` SHALL load `fidelity-intent.json` and re-verify: internal consistency (`effective == clamp(selected, capability-snapshot)`), spec.md Visual Handoff projection consistency (`fidelity_target`/`asset_acquisition_mode` mismatches are BLOCKER with an agent-auto-fix-the-projection suggestion — never escalated to a user question), goal-env requirement-sha staleness, and the single genuine conflict (selected=pixel ∧ hard ∧ clamped → DEFERRED semantics). For UI-relevant features a missing SSOT is BLOCKER pointing at the initializer command; non-UI features (no ui-spec, no handoff, no reference images) proceed without one. The pregate SHALL NOT produce the decision.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: projection drift is agent-fixable, not a user question

- **WHEN** spec.md declares fidelity_target=semantic_layout while the SSOT selected pixel_1to1
- **THEN** the gate FAILs naming the projection mismatch and instructs the agent to fix the projection from the SSOT

### Requirement: Ruling-class escalation reads the hard-pixel contract; execution keeps the pixel target

Severity ratcheting (WARN→BLOCKER), human-confirmation requirements and completion capping SHALL key on `isHardPixelContract` (effective=pixel_1to1 ∧ strictness=hard); high-fidelity execution machinery (extraction, diff/metrics, layout dumps) keeps keying on the pixel execution target. Under best_effort, quality gaps keep their default severities and are recorded as visual debt — never silently dropped. Deterministic integrity failures (corruption, path escape, forged evidence, ledger tampering) remain unconditional BLOCKERs regardless of strictness.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/harness-runner.ts`

#### Scenario: best_effort records debt without ratchet halt

- **WHEN** a pixel-target best_effort run has an unconfirmed visual gap
- **THEN** the finding stays at its default severity with debt recorded, and no human final confirmation is demanded; the same scenario with strictness=hard escalates to BLOCKER

### Requirement: Blind-crop c3 waiver requires this-invocation machine verification with binding revalidation

Under a blind adapter, a crop asset SHALL be admitted without per-item human pre-confirmation ONLY when the spec asset-acquisition provider confirmedly executed in the current invocation (skip/throw disqualifies disk reports), the entry is `verified` by the strict producer (sanity — including existing blank/uniform detection — plus independent VL recognition or human bbox overrule; producer semantics are not lowered), and the artifact's hash/resolved_path binding revalidates. Otherwise the asset falls back to visible placeholder + visual debt (proceeding) or the human-confirmation route; a pre-written verified-looking report grants no waiver.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: forged verified report with a skipped provider does not waive c3

- **WHEN** an agent pre-writes a complete verified entry and the provider did not run in this invocation
- **THEN** the crop stays unadmitted and the run proceeds via placeholder+debt or human confirmation, not via the forged report

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

The phase-driven `/spec` path (no goal run identity) SHALL obtain its authoritative requirement from a `fidelity-intent.json` SSOT whose `requirement_provenance` is `explicit_cli` and whose `execution_identity` matches the current `phase:<feature>:spec`. The shared `FidelityRoutingInitInput` SHALL require `requirementProvenance` at every call site: goal mode passes `goal_manifest`, the phase CLI passes `explicit_cli` (explicit non-empty requirement) or `intent_fallback` (broad-intent fallback only) and SHALL NOT emit `goal_manifest`. The `fidelity-intent-init` CLI SHALL accept `--requirement-file` through the same shared resolver, and SHALL fail fast on an explicitly empty `--requirement` rather than silently falling back to broad intent text. Broad intent text (README/notes/`spec.md`) or a missing/`intent_fallback`/legacy SSOT SHALL NOT satisfy `on_missing: fail`; `change.md` remains the legacy fallback.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`

#### Scenario: manual spec links to an explicit requirement

- **WHEN** a fresh feature is produced by `fidelity-intent-init --feature <f> --requirement "<text>"` (or `--requirement-file <path>`)
- **THEN** the SSOT records `requirement_provenance: explicit_cli` with `execution_identity: phase:<f>:spec`, and `derive.requirement` resolves, binding `fidelity-intent.json` (path + sha256) as the closure dependency

#### Scenario: no explicit requirement stays blocked

- **WHEN** Step 1 runs without a requirement (falling back to broad intent text) and no `change.md` exists
- **THEN** `derive.requirement` stays absent, the requirement capability stays blocked (INCOMPLETE), and the failure detail lists the attempted sources plus the two repair paths (goal manifest / re-run Step 1 with `--requirement(-file)`); a legacy SSOT without `requirement_provenance` is NOT treated as corrupt

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

