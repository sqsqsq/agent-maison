# Agent Adapters Specification

## Purpose

Define how AgentMaison exposes framework skills to different AI coding assistants
via adapter plugins without duplicating skill logic or phase rules.
## Requirements
### Requirement: Each adapter is a self-contained plugin directory

The system SHALL require every adapter to live under `agents/<adapter_name>/` with
an `adapter.yaml` that conforms to `agents/adapter-schema.yaml`.

#### Scenario: Known adapters present
- **WHEN** the framework is inspected for supported adapters
- **THEN** `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, and `agents/generic/adapter.yaml` MUST exist and validate against the schema

> **Enforced by:** `agents/adapter-schema.yaml`, `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, `agents/generic/adapter.yaml`

### Requirement: Adapters do not contain skill logic

The system MUST NOT allow adapters to embed phase rules or skill workflow logic;
adapters SHALL only expose skill entry points (slash commands, bridge files, rules)
to the instance project root.

#### Scenario: Phase rules remain centralized
- **WHEN** an adapter generates instance-level configuration
- **THEN** it MUST NOT write phase rules; all phase rules MUST remain in `specs/phase-rules/*.yaml`

> **Enforced by:** `agents/adapter-schema.yaml` (design constraints section), `specs/phase-rules/`

### Requirement: Adapter outputs target instance project root

The system SHALL generate all adapter artifacts relative to the consumer instance
project root, not inside the framework submodule directory.

#### Scenario: Agent entry file targets instance root
- **WHEN** framework-init runs with a selected adapter
- **THEN** the generated agent entry file (e.g. `AGENTS.md`) MUST appear at the instance project root as defined by `agent_entry_file.target_path` in the adapter config

> **Enforced by:** `agents/*/adapter.yaml`, `skills/project/framework-init/SKILL.md`, `harness/scripts/check-init.ts`

### Requirement: Project init materializes multiple adapters

Project init MUST support `materialized_adapters` with one
`materialize-adapter:<name>` task per adapter. Committed artifacts for each
adapter MUST be rendered using that adapter identity, not the personal
`local.agent_adapter`.

#### Scenario: Claude and Cursor artifacts coexist
- **WHEN** `materialized_adapters` is `["claude","cursor"]`
- **THEN** both `.claude/` and `.cursor/` (and entry files) MAY exist without conflict

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`

### Requirement: Personal setup does not write project artifacts

Personal setup MUST only write `framework.local.json` and MUST use
`assert-active-adapter-materialized` as a read-only check **before**
`record-adapter`. If the chosen adapter is not materialized, setup MUST stop
and direct the user to project init without writing local config.

#### Scenario: Setup writes only framework.local.json
- **WHEN** personal setup completes S3 for `record-adapter` and optional
  `record-deveco-path`
- **THEN** only `framework.local.json` MUST be created or updated; project
  config and adapter directories MUST NOT be modified by setup tasks

#### Scenario: Assert failure does not write local config
- **WHEN** S3 runs personal setup with `activeAdapter` whose entry file is not
  materialized
- **THEN** `assert-active-adapter-materialized` MUST fail, `record-adapter` MUST
  be skipped, and `framework.local.json` MUST NOT be created or updated

> **Enforced by:** `skills/reference/personal-setup-gate.mdSKILL.md`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate-smoke.unit.test.ts`

### Requirement: Adapters may declare optional goal_capability

The system SHALL allow adapters to declare an optional `goal_capability` block in `adapter.yaml` with `mode` (`native_goal` | `external_runner`), headless invoke templates, and unattended permission contract.

Enforcement: `agents/adapter-schema.yaml`, `harness/scripts/check-init.ts`

#### Scenario: check-init warns on missing goal_capability

- **WHEN** framework-init check-init runs and adapter lacks `goal_capability`
- **THEN** check-init MUST emit WARN only and MUST NOT BLOCKER-fail init

#### Scenario: goal-runner preflight blocks missing capability

- **WHEN** goal-runner starts with active adapter lacking valid `goal_capability`
- **THEN** preflight MUST exit non-zero before agent invocation

### Requirement: Adapter goal capabilities declare reconcile execution support
`agents/adapter-schema.yaml` SHALL allow adapters to declare support for in-session reconciliation, phase-context isolation, external unattended execution, resume, and bidirectional handoff. `harness/scripts/utils/goal-adapter-capability.ts` SHALL validate the declaration.

#### Scenario: Adapter declares handoff without resume
- **WHEN** an adapter capability enables handoff but lacks the required resume capability
- **THEN** adapter validation MUST fail

### Requirement: Capability routing is fail-closed
The goal driver SHALL route in-session, unattended, and handoff behavior only when the active adapter declares and passes the corresponding capability/preflight. Missing capability SHALL select a documented fallback or halt rather than optimistic execution.

#### Scenario: Unattended permission contract is incomplete
- **WHEN** unattended mode is requested and the active adapter fails existing external-runner preflight
- **THEN** the run MUST halt before autonomous mutation and report the missing capability

#### Scenario: In-session capability is absent
- **WHEN** attended goal mode is requested without in-session support
- **THEN** the framework SHALL fall back to manual harness+assess

### Requirement: Existing adapter behavior remains backward compatible
Adapters that currently support external-runner goal execution SHALL retain their existing headless invoke, permission, output-delivery, tool-event, and usage-capture semantics unless they explicitly opt into new in-session or handoff capability fields.

#### Scenario: Legacy adapter omits new capability fields
- **WHEN** an existing adapter is loaded after upgrade
- **THEN** external-runner behavior SHALL remain available under existing preflight while new in-session/handoff behavior remains disabled

### Requirement: Phase-driven fidelity routing initialization has one flow owner and one implementation

The phase-driven initializer SHALL be owned by `skills/feature/spec` Step 1 (invoked before generating spec.md) and implemented solely by the runner-owned `fidelity-intent-init` CLI wrapping the same `initializeFidelityRouting` used by the goal preflight. Adapter thin entries (cursor/claude/codex slash commands, bridge files, rules) SHALL only pass user input through and direct the agent to the Skill — they MUST NOT initialize routing or write the intent/snapshot artifacts, so every adapter gets identical auto-tiering behavior and the SSOT has a single writer.

Enforcement: `skills/feature/spec/SKILL.md`, `harness/scripts/fidelity-intent-init.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: adapters do not fork the initialization behavior

- **WHEN** a phase-driven spec session starts from any adapter's thin entry
- **THEN** routing artifacts are produced only via the Skill-invoked runner-owned CLI, and no adapter-specific entry writes fidelity-intent.json

