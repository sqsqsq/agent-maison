# instance-extension-management Specification

## Purpose
TBD - created by archiving change extension-manifest-1-1. Update Purpose after archive.
## Requirements
### Requirement: Manifest 1.1 is static, closed, and backward compatible

The extension loader MUST accept manifest `schema_version: "1.1"` with object knowledge entries, `provides.mcp_actions`, and top-level `phase_bindings`. It MUST reject unknown 1.1 fields and forbidden MCP connection or credential fields. A 1.0 manifest MUST retain its six-domain parsing and directory-driven bridge behavior without knowledge consumption, actions, bindings, or new gates. No manifest or no extension directory MUST yield an empty bundle with no side effects.

#### Scenario: 1.0 remains behaviorally unchanged
- **WHEN** a project uses a valid 1.0 manifest containing string knowledge and directory skills
- **THEN** the loader accepts it, bridges remain directory-driven, and no knowledge/action/binding prompt or gate is emitted

#### Scenario: connection details are rejected
- **WHEN** a 1.1 mcp action declares `server`, `url`, `token`, `command`, or login configuration
- **THEN** extension validation fails and no action/binding behavior is applied

#### Scenario: invalid manifest cannot masquerade as legacy absence
- **WHEN** a 1.1 manifest is invalid while an undeclared directory Skill and required binding are present
- **THEN** no directory Skill is materialized and Feature harness/receipt emit the existing manifest diagnostics as BLOCKER instead of disabling the binding gate

#### Scenario: extension root cannot escape the project
- **WHEN** `paths.extension_dir` is absolute, drive-qualified, or contains a `..` segment
- **THEN** loader, init, and materialize reject it through the existing project-relative-path validator before any read or write outside project root

> **Enforced by:** `specs/instance-extension-manifest.schema.yaml`, `harness/extension-loader.ts`, extension loader unit tests

### Requirement: Materialization uses the versioned SSOT and protects owned derivatives

For 1.1 manifests, bridge materialization MUST use `provides.skills[]` as its complete SSOT and target every project-level `materialized_adapters[]`; it MUST NOT read personal `agent_adapter`. For 1.0 it MUST remain directory-driven. Generated extension bridges MUST carry ownership metadata. A marked canonical derivative MAY be overwritten or removed, a marked derivative with content drift MUST be reported and preserved, and an unmarked file MUST remain untouched.

#### Scenario: all project adapters receive a declared skill
- **WHEN** a 1.1 manifest declares one existing extension skill and the project declares multiple materialized adapters
- **THEN** each supported adapter receives its canonical bridge and the AGENTS/CLAUDE entry projection lists the skill

#### Scenario: drift is never destroyed
- **WHEN** a previously generated marked bridge has manual content changes or a colliding target is unmarked
- **THEN** materialization reports the path and does not overwrite or delete it

> **Enforced by:** `harness/scripts/render-agents-md.ts`, `harness/scripts/utils/instance-skill-bridge.ts`, `/extension materialize`

### Requirement: Inspect and reconciliation are pure projections

`/extension inspect` MUST derive machine JSON and a human table from the manifest, loaded bundle, project adapter declarations, generated bridges, and produced files. Each row MUST include type, source, effective timing, consumer, strength (`available|scheduled|evidenced`), and status. Directory/manifest drift, missing/stale/orphan bridges, bad references, action visibility source, and M7 seam consumers MUST be shown. Reconciliation findings MUST flow through the existing `check-extensions` CheckResult channel and MUST NOT create a second ledger or checker framework.

#### Scenario: M7 consumer is explicit
- **WHEN** an action produces a requirement materialization or blueprint feedback artifact
- **THEN** inspect names `/component-design` and the corresponding M7 seam as its consumer

> **Enforced by:** `harness/scripts/utils/extension-inspect.ts`, `harness/scripts/check-extensions.ts`, `/extension inspect`

### Requirement: Knowledge routes only to its declared audience

Object knowledge with `audience: global` MUST appear in the AGENTS/CLAUDE instance knowledge section. Object knowledge with Feature phase audiences MUST appear as dynamically rendered index rows only in those phases' `ai-prompt.md`. Legacy string knowledge in a 1.1 manifest MUST appear in every Feature phase index and MUST NOT enter AGENTS/CLAUDE. Knowledge for `/component-design` or `app-component-blueprint` MUST use existing `skill_assets`, not a new audience value.

#### Scenario: phase filtering is exact
- **WHEN** two knowledge entries target different Feature phases
- **THEN** each generated phase prompt lists only the entry that includes that phase

#### Scenario: only active workflow Feature phases are accepted
- **WHEN** audience or phase_bindings names an unknown slug or a global phase, or the active workflow cannot be resolved
- **THEN** manifest validation fails; full/lite Feature phases from the active workflow union remain accepted, including custom Feature phases

> **Enforced by:** extension loader, `template-renderer.ts`, `harness-runner.ts`, prompt assembly tests

### Requirement: Phase bindings use exactly three Feature phase slots

Bindings MUST support only `before_phase_work`, `before_phase_verify`, and `after_phase_verify_before_close` for Feature phases. The framework MUST NOT add `before_component_design` or a post-close slot. `before_phase_work` MUST be visible as a bounded AGENTS routing hint and phase prompt instruction; `before_phase_verify` MUST validate produces through existing harness CheckResults; `after_phase_verify_before_close` MUST validate produces through the existing receipt gate without modifying completion facts or receipt schema.

#### Scenario: after-verify missing required output blocks closure
- **WHEN** an `after_phase_verify_before_close` binding references a required action whose produces file is absent
- **THEN** the existing receipt check fails with the declared MAJOR/BLOCKER severity and no completed fact is rewritten

#### Scenario: optional output degrades honestly
- **WHEN** a bound optional action has no produces file
- **THEN** inspect/check reports the missing output without blocking the phase

> **Enforced by:** harness runner CheckResult injection, `check-receipt.ts`, phase binding unit/fixture tests

### Requirement: MCP actions describe host execution and repository outputs only

Each mcp action MUST declare a tool id, required flag, one or more project-relative produces paths, and usage; severity MAY be MAJOR or BLOCKER and defaults to MAJOR. The agent MUST self-check tool visibility at use time and inspect MUST label this source `agent_self_report`; the framework MUST NOT materialize tools, install servers, manage credentials, or treat the self-report as completion evidence. Produced files MUST join the existing CheckResult/evidence chain.

#### Scenario: required ordinary output is absent
- **WHEN** a bound required action did not create its declared project file
- **THEN** the applicable existing check/receipt gate emits a failing CheckResult with actionable path detail

> **Enforced by:** extension loader, `/extension` Skill, produces gate tests

### Requirement: M7 seam outputs reuse component blueprint validators

When an action output declares artifact `requirement-source-materialization@1` or `blueprint-review-feedback@1`, the framework MUST invoke the existing component blueprint materialization or feedback validator respectively. It MUST NOT introduce a parallel schema, checker, lifecycle slot, server configuration, or Story extension implementation. The host adaptation guide and packaged sample MUST show the extension-skill → materialization → `/component-design` → publication consumer → optional feedback flow.

#### Scenario: source hash mutation fails the existing seam
- **WHEN** a declared materialization output passes and its `source_sha256` is then changed
- **THEN** the same existing materialization validator fails with the established hash-mismatch diagnostic

#### Scenario: feedback authority mutation fails the existing seam
- **WHEN** a declared valid authoritative feedback output passes and required authority is removed
- **THEN** the same existing feedback validator fails with the established insufficient-authority diagnostic

#### Scenario: usage text cannot claim M7 validation
- **WHEN** action usage mentions an M7 artifact but the produced JSON has no recognized artifact
- **THEN** ordinary file existence MAY pass, but inspect does not name an M7 consumer or validator result and the explicit component-blueprint seam CLI still fails

> **Enforced by:** `blueprint-host-seams.ts`, `check-component-blueprint.ts`, M7 extension fixture chain
