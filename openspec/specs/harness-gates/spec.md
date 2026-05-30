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

### Requirement: Phase check scripts enforce phase-rules

The system SHALL enforce each harness phase using a dedicated check script paired
with a phase-rules YAML file under `specs/phase-rules/`.

#### Scenario: PRD phase has check and rule pair
- **WHEN** harness-runner executes the `prd` phase
- **THEN** it MUST invoke `harness/scripts/check-prd.ts` against `specs/phase-rules/prd-rules.yaml`

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

`skills/00-framework-init/prompts/**` and `templates/**` MUST NOT instruct
agents to collect architecture DSL fields via conversational questionnaires
(fully custom flows, field-by-field collection, sublayer follow-up prompts).

#### Scenario: architecture preset docs use select-or-stop only
- **WHEN** `check-skills-confirmation-ux.ts` lints init prompts and templates
- **THEN** files MUST NOT contain interactive patterns such as
  `完全自定义`, `收集字段`, `手工拼装 JSON`, `逐项确认`, `追加问卷`,
  or `继续追问` (except lines explicitly marked as forbidden anti-patterns)

> **Enforced by:** `skills/00-framework-init/prompts/**`,
> `skills/00-framework-init/templates/**`,
> `skills/reference/user-confirmation-ux.md`,
> `harness/scripts/check-skills-confirmation-ux.ts`

