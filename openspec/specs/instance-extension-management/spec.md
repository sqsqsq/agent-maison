# instance-extension-management Specification

## Purpose
Define how locally installed instance contributions are selected, handed to existing Maison consumers, and reconciled against request evidence.
## Requirements
### Requirement: The manifest normalizes versioned and legacy declarations

The loader MUST accept `schema_version: "2.0"` and normalize its `bindings.<ability>.<id>` entries by source, ability ID, binding ID, timing, kind, and reference. It MUST accept 1.1 object knowledge entries, `provides.mcp_actions`, and top-level `phase_bindings` with their prior audience and execution semantics. A 1.0 manifest MUST retain directory-driven skill discovery and its legacy knowledge boundary. Reading or inspecting a manifest MUST leave it untouched. On the first persistent change requiring 2.0, migration MUST preserve effective legacy choices, host identity, rules, hand-authored material, and existing adapters. The loader MUST reject unknown fields in closed manifest structures and forbidden MCP connection or credential fields. No manifest or no extension directory MUST yield an empty bundle with no side effects.

#### Scenario: 1.0 remains behaviorally unchanged
- **WHEN** a project uses a valid 1.0 manifest containing string knowledge and directory skills
- **THEN** the loader accepts it, bridges remain directory-driven, and no knowledge/action/binding prompt or gate is emitted

#### Scenario: connection details are rejected
- **WHEN** a 1.1 mcp action declares `server`, `url`, `token`, `command`, or login configuration
- **THEN** validation reports the invalid action and any affected binding while healthy contributions remain eligible

#### Scenario: invalid manifest cannot masquerade as legacy absence
- **WHEN** manifest YAML, its root structure, or its protocol version cannot be trusted
- **THEN** no extension contribution is projected, and the existing Feature harness and receipt report the root diagnostic as BLOCKER

#### Scenario: a malformed contribution is isolated
- **WHEN** an enabled binding has an unknown timing or version, bad reference, missing configuration, or malformed fields
- **THEN** validation and inspect identify its source, ability, binding ID, timing, and reason, and the contribution is unavailable
- **AND** independent healthy bindings and skills remain eligible, an optional dependency degrades, and a selected required dependency reports its gap at the relevant consumer

#### Scenario: extension root cannot escape the project
- **WHEN** `paths.extension_dir` is absolute, drive-qualified, or contains a `..` segment
- **THEN** loader, init, and materialize reject it through the existing project-relative-path validator before any read or write outside project root

> **Enforced by:** `specs/instance-extension-manifest.schema.yaml`, `harness/extension-loader.ts`, extension loader unit tests

### Requirement: Materialization uses the versioned SSOT and protects owned derivatives

For 1.1 manifests, bridge materialization MUST use `provides.skills[]`; for 2.0 it MUST project its effective enabled selection from the host manifest. Both versions MUST target every project-level `materialized_adapters[]`. For 1.0 it MUST remain directory-driven. Generated extension bridges MUST carry ownership metadata. A marked canonical derivative MAY be overwritten or removed, a marked derivative with content drift MUST be reported and preserved, and an unmarked file MUST remain untouched.

#### Scenario: all project adapters receive a declared skill
- **WHEN** a 1.1 manifest declares one existing extension skill and the project declares multiple materialized adapters
- **THEN** each supported adapter receives its canonical bridge and the AGENTS/CLAUDE entry projection lists the skill

#### Scenario: drift is never destroyed
- **WHEN** a previously generated marked bridge has manual content changes or a colliding target is unmarked
- **THEN** materialization reports the path and does not overwrite or delete it

> **Enforced by:** `harness/scripts/render-agents-md.ts`, `harness/scripts/utils/instance-skill-bridge.ts`, `/extension materialize`

### Requirement: Inspect and reconciliation are pure projections

`/extension inspect` MUST derive machine JSON and a human table from the manifest, loaded bundle, project adapter declarations, generated bridges, and produced files. Each row MUST include type, source, effective timing, consumer, strength (`available|scheduled|evidenced`), and status. A timing with no real consumer MUST report its cause and remain unscheduled. Evidence of a previous artifact on disk MUST be distinguished from the delivery and result of a specific request. Directory/manifest drift, missing/stale/orphan bridges, bad references, action visibility source, and M7 seam consumers MUST be shown. Reconciliation findings MUST flow through the existing `check-extensions` CheckResult channel and MUST NOT create a second ledger or checker framework.

#### Scenario: M7 consumer is explicit
- **WHEN** an action produces a requirement materialization or blueprint feedback artifact
- **THEN** inspect names `/component-design` and the corresponding M7 seam as its consumer

> **Enforced by:** `harness/scripts/utils/extension-inspect.ts`, `harness/scripts/check-extensions.ts`, `/extension inspect`

### Requirement: Knowledge routes only to its declared audience

Object knowledge with `audience: global` MUST appear in the AGENTS/CLAUDE instance knowledge section. Object knowledge with Feature phase audiences MUST appear as dynamically rendered index rows only in those phases' `ai-prompt.md`. Legacy string knowledge in a 1.1 manifest MUST appear in every Feature phase index and MUST NOT enter AGENTS/CLAUDE. The legacy `skill_assets.component-design.knowledge` slot MUST still select one design background using the existing extension-over-profile precedence. Native knowledge bindings MUST add to that background through the public component design timing. Bound knowledge MUST keep its provenance and order.

#### Scenario: phase filtering is exact
- **WHEN** two knowledge entries target different Feature phases
- **THEN** each generated phase prompt lists only the entry that includes that phase

#### Scenario: only active workflow Feature phases are accepted
- **WHEN** audience or phase_bindings names an unknown slug or a global phase, or the active workflow cannot be resolved
- **THEN** manifest validation fails; full/lite Feature phases from the active workflow union remain accepted, including custom Feature phases

> **Enforced by:** extension loader, `template-renderer.ts`, `harness-runner.ts`, prompt assembly tests

### Requirement: Phase bindings use exactly three Feature phase slots

Feature bindings MUST normalize to the three versioned timings registered in `specs/lifecycle-hooks-schema.yaml` and use an active Feature phase. `feature.before_phase_work@1` prepares knowledge and skill or MCP action instructions for the Feature author, with bounded AGENTS routing and the existing harness validation of declared MCP outputs. `feature.before_phase_verify@1` checks declared MCP outputs through existing harness CheckResults before the phase checker. `feature.after_phase_verify_before_close@1` checks declared MCP outputs through the existing receipt gate before closure. These checks MUST retain existing severity, completion facts, and receipt schemas.

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

### Requirement: The timing registry describes actual owners and recipients

The published `specs/lifecycle-hooks-schema.yaml` MUST define the finite supported timings, versions, compatible legacy names, allowed contribution resources, and consumers. The loader and inspect MUST use these definitions. Each owning entry point MUST control dispatch and keep request applicability and write authorization. A configured timing yields only the consumer's stated outputs. A binding identity is deduplicated and preserves source provenance. Independent knowledge contributions are appended in the consumer's stable order. Conflicting exclusive facts MUST go to their existing authority.

#### Scenario: legacy harness hooks keep their actual order and context
- **WHEN** a normal harness check emits lifecycle events
- **THEN** `pre_phase` follows the running phase state, `pre_check` precedes the checker, `post_check` follows it, and `on_violation` runs for each classified violation
- **AND** the check ends with `pre_verifier`, `on_context_load`, `post_verifier`, and `post_phase`, in that order before verification request eligibility is determined
- **AND** framework, profile, and extension contributions run in their existing source order with existing context and failure severity
- **AND** Markdown and script fragments are delivered only when this run actually builds the verifier prompt, and hook scripts may return checker results

#### Scenario: component design prepares knowledge and action instructions for its author
- **WHEN** the direct or managed design entry binds the blueprint ID, requirement source, and writable scope
- **THEN** both use `component-design.before_discovery@1` before P1 discovery or the first design write
- **AND** the entry supplies enabled, applicable knowledge and action instructions to its actual author using the original request or direct input
- **AND** a read-only preparation emits knowledge and action instructions for the authorized author without writing business artifacts
- **AND** knowledge delivered by pointer requires the author to read the relevant original, and the existing handoff records action reuse, output, skip, or failure

> **Enforced by:** `specs/lifecycle-hooks-schema.yaml`, `harness/harness-runner.ts`, `harness/hooks-dispatcher.ts`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/initial-design-delivery.ts`

### Requirement: Local installation is scoped, repeatable, and safe to remove

The `/extension` CLI and materialized adapter entry points MUST provide install, inspect, enable, disable, and uninstall operations, with equivalent natural-language intent reaching the same operation. Install MUST read a local source directory with a manifest, verify that the target can read 2.0 before writing, and import selected resources within the configured path and resolved link boundaries. The host manifest MUST own package identity, selected abilities, binding switches, and host-relative file ownership hashes. Initial install applies explicit source defaults. Reinstallation keeps existing choices and disables newly introduced automatic bindings by default. Selection updates and manifest writes MUST preserve unrelated declarations and user documents. Failed or interrupted installation MUST be recoverable by repeating the same operation against the manifest and files.

#### Scenario: the bundled UX ability can be selected at two levels
- **WHEN** the host installs UX and disables just its fill-missing binding
- **THEN** the manual skill and read-upstream binding remain available and reinstallation retains the disabled choice
- **AND** a request with an applicable upstream draft can reuse its evidence while a direct text correction does not trigger design work

#### Scenario: disable applies to new work and uninstall respects prior requests
- **WHEN** the host disables an ability while a request bound to it is still open
- **THEN** new requests omit it and the prior request can still access its signed inputs and installed resources
- **AND** uninstall reports its blocking request IDs and preserves the copy until the requests complete
- **AND** a later uninstall removes only attributable unchanged, unshared managed resources and generated entries and reports retained content

> **Enforced by:** `harness/scripts/extension.ts`, `harness/scripts/utils/extension-lifecycle.ts`, `harness/scripts/utils/instance-skill-bridge.ts`
