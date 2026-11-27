# instance-extension-management Specification

## Purpose
Define how locally installed instance contributions are selected, handed to existing Maison consumers, and reconciled against request evidence.
## Requirements
### Requirement: The host registers separate versioned plugin manifests

Framework 3.1 MUST load schema `2.0` with a top-level `kind: host` manifest and a `kind: plugin` manifest in each registered, same-named plugin directory. The host manifest owns installation source, team selection, timing overrides, and package-relative import fingerprints. Each plugin manifest owns identity, version, bindings, declared resources, and steps. The loader MUST resolve declared package paths within that package. Repository delivery paths, including MCP outputs, remain relative to the project root. It MUST reject unknown fields in closed structures and forbidden MCP connection or credential fields. An unused or absent extension root MUST yield an empty bundle.

#### Scenario: An existing host installs Framework 3.1 over 3.0
- **WHEN** the configured extension root contains a flat 1.0 manifest or an earlier internal layout
- **THEN** the loader leaves the files, existing bridges, and request records untouched and reports a manual onboarding diagnostic
- **AND** ordinary work continues with framework and profile inputs, and an explicitly requested legacy contribution has no delivery evidence
- **AND** the manager preserves the occupied root and lets the host select a separate clean root or manually retain the old root before installing

#### Scenario: One registered plugin is malformed
- **WHEN** a registered package has a malformed manifest, a mismatched identity, or an invalid contribution
- **THEN** validation identifies the plugin and affected contribution and skips their unavailable inputs while independent plugins remain eligible

#### Scenario: Extension paths preserve the project boundary
- **WHEN** an extension location is absolute, drive-qualified, traverses parent directories, or resolves outside its authorized root
- **THEN** the loader and management entry points reject it before reading or writing the external path

> **Enforced by:** `specs/instance-extension-manifest.schema.yaml`, `harness/extension-loader.ts`, extension loader unit tests

### Requirement: Materialization uses registered packages and protects owned derivatives

For each supported project-level `materialized_adapters[]`, bridge materialization MUST project the selected manual Skills from enabled registered plugins. A bridge MUST prepare its plugin at actual invocation when necessary. Generated bridges MUST carry ownership metadata. Materialization MAY refresh or remove an unchanged marked derivative and MUST preserve marked derivatives with content drift and unmarked files.

#### Scenario: All project adapters receive a declared skill
- **WHEN** an enabled plugin declares an existing Skill and the project declares multiple materialized adapters
- **THEN** each supported adapter receives its canonical bridge and the project entry lists the Skill

#### Scenario: Drift is never destroyed
- **WHEN** a previously generated marked bridge has manual content changes or a colliding target is unmarked
- **THEN** materialization reports the path and preserves the file

> **Enforced by:** `harness/scripts/render-agents-md.ts`, `harness/scripts/utils/instance-skill-bridge.ts`, `/extension materialize`

### Requirement: Inspect and reconciliation derive facts from the active worktree

The underlying inspection and validation routines MUST leave extension resources untouched. The management entry may collect a deleted plugin’s attributable local leftovers before reporting. `/extension inspect` MUST derive machine JSON and a human table from the manifest, loaded bundle, project adapter declarations, generated bridges, and produced files. Each row MUST include type, source, effective timing, consumer, strength (`available|scheduled|evidenced`), and status. A timing with no real consumer MUST report its cause and remain unscheduled. Evidence of a previous artifact on disk MUST be distinguished from the delivery and result of a specific request. Directory/manifest drift, missing/stale/orphan bridges, bad references, action visibility source, and M7 seam consumers MUST be shown. Reconciliation findings MUST flow through the existing `check-extensions` CheckResult channel and MUST NOT create a second ledger or checker framework.

#### Scenario: M7 consumer is explicit
- **WHEN** an action produces a requirement materialization or blueprint feedback artifact
- **THEN** inspect names `/component-design` and the corresponding M7 seam as its consumer

#### Scenario: A host with no extensions can discover the target catalog
- **WHEN** unfiltered inspect runs against a target release with no installed extensions
- **THEN** both text and JSON show the complete supported timing catalog, including actual trigger, scope, phase requirement, consumer and resources
- **AND** those timings produce no scheduled or evidenced contribution rows; a missing or unsupported catalog identifies the target release and cause

> **Enforced by:** `harness/scripts/utils/extension-inspect.ts`, `harness/scripts/check-extensions.ts`, `/extension inspect`

### Requirement: Knowledge and actions route to their declared timings

Extensions MUST declare knowledge through `kind: knowledge` bindings. `project.entry@1` MUST generate a static index of eligible versioned repository knowledge when materializing the project entry. `component-design.before_discovery@1` delivers applicable inputs to the directly invoked or managed design author. Feature bindings MUST use an active Feature phase and one of three versioned timings. `feature.before_phase_work@1` prepares knowledge and Skill or MCP instructions for the Feature author; the existing harness checks declared MCP outputs. `feature.before_phase_verify@1` checks MCP outputs before the phase checker. `feature.after_phase_verify_before_close@1` checks outputs at the existing receipt gate. Each consumer MUST retain provenance, established evidence, and severity.

#### Scenario: A required MCP output is missing before close
- **WHEN** a selected after-verify binding references a required MCP action whose declared output is absent
- **THEN** the existing receipt check fails with the declared MAJOR or BLOCKER severity and preserves existing completion facts

#### Scenario: Phase filtering is exact
- **WHEN** knowledge bindings target different Feature phases
- **THEN** each Feature author receives only the selected knowledge for that phase
- **AND** inspect reports unknown phases and incompatible timing overrides on the affected plugin and binding

> **Enforced by:** `harness/extension-loader.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, contribution tests

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

The published `specs/lifecycle-hooks-schema.yaml` MUST define the finite supported timings, versions, allowed contribution resources, and consumers. The loader and inspect MUST use these definitions. Each owning entry point MUST control dispatch and keep request applicability and write authorization. A configured timing yields only the consumer's stated outputs. A binding identity is deduplicated and preserves source provenance. Independent knowledge contributions are appended in the consumer's stable order. Conflicting exclusive facts MUST go to their existing authority.

#### Scenario: Harness hooks keep their actual order and context
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

The `/extension` CLI and materialized adapter entry points MUST provide install, inspect, enable, disable, and uninstall operations, with equivalent natural-language intent reaching the same operation. Install MUST accept a local source manifest or a valid bare Skill, verify the target release can read the needed schema before writing, and import selected resources within the configured path and resolved link boundaries. The host manifest MUST own per-package installation identity, team and binding choices, overrides, and package-relative import fingerprints. Inspect derives lifecycle facts from the current worktree and any in-flight operation or request. First install of a manifest-backed package applies explicit source defaults through enable unless requested to install only. A bare Skill MUST publish only its manual entry at first install, with no extension command invoked or automatic binding declared. Selection updates and manifest writes MUST preserve unrelated declarations and user documents. Reinstallation keeps existing choices and disables newly introduced automatic bindings by default. Failed or interrupted changes MUST be recoverable against the manifest and files.

#### Scenario: A bare source describes an optional automatic command
- **WHEN** a bare Skill describes an additional capability or contains an install script
- **THEN** install leaves the source untouched and publishes its manual entry without invoking the script
- **AND** the management Skill can propose a named binding with timing, phase, resource, consumer and rationale; a proposed command requires approval of its concrete run, undo, working directory, parameters and outputs before it is written or executed

#### Scenario: A provider package can be selected at two levels
- **WHEN** the host installs the optional UX package and disables its fill-missing binding
- **THEN** the manual skill and read-upstream binding remain available and reinstallation retains the disabled choice
- **AND** a request with an applicable upstream draft can reuse its evidence while a direct text correction does not trigger design work

#### Scenario: disable applies to new work and uninstall respects prior requests
- **WHEN** the host disables an ability while a request bound to it is still open
- **THEN** new requests omit the target and the prior request can still access its signed inputs and installed resources
- **AND** the command releases its lock and returns the active request IDs and original retry command before the request hands back
- **AND** inspect shows whether use has ended and cleanup remains pending; repeating the same command removes only attributable unchanged, unshared effects and resources, and reports retained content

> **Enforced by:** `harness/scripts/extension.ts`, `harness/scripts/utils/extension-lifecycle.ts`, `harness/scripts/utils/instance-skill-bridge.ts`

### Requirement: Local preparation checks clone readiness before delivery

A plugin MAY declare ordered `activation.steps` with stable IDs, a package-relative working directory, argument arrays, exclusive outputs and a readiness check. Local steps MUST be repeatable and confined to declared package-local artifacts. A request must prepare each affected enabled plugin once under worktree concurrency protection before giving inputs to its consumer. Ready artifacts MUST be reused. Stale or missing local artifacts MUST be rebuilt when ownership is established. Failure MUST withdraw that plugin from the current delivery, preserve unrelated plugins, and permit retry without rewriting the team selection.

#### Scenario: A clone inherits a package upgrade but keeps old local files
- **WHEN** the required artifact is missing or its readiness evidence identifies a different plugin version
- **THEN** the next request replaces the exclusive local artifacts, checks readiness again, and delivers the new version
- **AND** a later request with ready outputs reuses them

#### Scenario: One local generator fails
- **WHEN** the selected plugin's local step fails or its result fails readiness
- **THEN** the affected plugin reports its preparation failure and its outdated material is withheld
- **AND** unrelated enabled plugins continue, and a subsequent request can try the failed plugin again

> **Enforced by:** `harness/scripts/utils/extension-activation.ts`, `harness/scripts/utils/extension-runtime.ts`, `harness/scripts/utils/extension-lifecycle.ts`

### Requirement: Explicit effects can be reversed and deleted clone leftovers can be collected

Shared files, project-level or non-file effects MUST be handled only by authorized management steps with a repeatable undo. Management MUST run steps in order and undo effects in reverse order, preserving user edits and prior deliveries. Same-source, same-version content drift MUST request a provider version bump. A version change MUST preflight the new package, stop new use, and exit old effects before replacing managed inputs, preserving the prior team choice. An uncommitted replacement failure MUST attempt to restore the original package; a failed activation after commitment leaves the new version installed and reports the failure.

A stable extension-root Git ignore file MUST distinguish package-local outputs from source, lock files and repository artifacts and retain the applicable ignore rules after a plugin is deleted. A management entry (including inspect) or a formal preparation entry MUST collect an attributable deleted-plugin directory when it contains only managed ignored resources and has no effective in-flight references. A package that remains registered or contains a tracked file, manual material or an effective in-flight reference MUST be preserved and explained. Cleanup preserves existing business deliverables.

#### Scenario: A teammate pulls a plugin deletion
- **WHEN** the plugin is gone from the host manifest and the clone still contains only that plugin's managed ignored files
- **THEN** Git status remains clean and the next management or preparation entry collects the directory and reports it
- **AND** tracked or unignored content and in-flight references prevent deletion

> **Enforced by:** `harness/scripts/extension.ts`, `harness/scripts/utils/extension-activation.ts`, `harness/scripts/utils/extension-lifecycle.ts`

### Requirement: Host timing selection applies consistently to new consumers

The host MAY store a timing and phase override for a named binding in its 2.0 host installation selection. The loader MUST validate the effective timing, resource and active workflow phase, preserve source defaults and identify incompatible overrides. All consumers MUST receive the effective selection for new requests. Previously signed inputs retain their original authority.

#### Scenario: A phase changes after activation
- **WHEN** an enabled knowledge binding is changed from coding to review with the same valid activation inputs and effects
- **THEN** newly prepared review input receives the same knowledge, newly prepared coding input omits it, and no run or undo command is repeated

#### Scenario: An enabled source changes the binding incompatibly
- **WHEN** the stored host override is incompatible with the new binding resource or current workflow
- **THEN** inspect identifies the affected binding and retains the choice for adjustment, and unrelated valid contributions remain eligible

> **Enforced by:** `harness/extension-loader.ts`, `harness/scripts/utils/extension-lifecycle.ts`, `specs/lifecycle-hooks-schema.yaml`
