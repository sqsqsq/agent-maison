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

