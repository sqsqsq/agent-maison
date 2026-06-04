## ADDED Requirements

### Requirement: Project init decision records materialized adapter evidence

For `scope: project`, the decision JSON (`schema_version` `1.0`) SHALL include
`materialized_adapters` as a non-empty `string[]` representing the user's
S2 `init.materialized_adapters` selection for the current run. For
`scope: personal`, `materialized_adapters` on the decision object MUST NOT be
required.

`assertDecisionStructure` SHALL validate `materialized_adapters` element types
only when the field is present. Missing or empty `materialized_adapters` for
project scope MUST be rejected in `validateDecisionJson` / `preflightExecute`
with a blocked run-log (not an uncaught throw before run-log).

#### Scenario: Project execute without materialized_adapters blocked with run-log
- **WHEN** `--execute` runs with `scope: project` and decision omits
  `materialized_adapters` or supplies an empty array
- **THEN** preflight MUST fail with a blocked run-log
- **AND** no project business or mechanism artifacts MUST be modified

#### Scenario: Personal execute does not require decision materialized_adapters
- **WHEN** `--execute` runs with `scope: personal` and decision omits
  `materialized_adapters`
- **THEN** preflight MUST NOT fail solely for that omission

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: S3 execution plan uses decision materialized_adapters as SSOT

For project `--execute`, the orchestrator MUST derive
`materialize-adapter:*` tasks from `decision.materialized_adapters` before
relying on `context.materializedAdapters` or `configWritePayload.materialized_adapters`.
Context/config values MAY be used as UPDATE recommendations but MUST NOT
override a validated decision list. When both decision and context supply lists,
they MUST match as sets or preflight MUST block.

#### Scenario: Decision claude with context cursor blocked
- **WHEN** preflight runs with `decision.materialized_adapters: ["claude"]` and
  context `materializedAdapters: ["cursor"]`
- **THEN** preflight MUST fail with a blocked run-log citing mismatch

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/scripts/utils/init-task-planner.ts`

### Requirement: Staging context excludes CLI root fields

`context.json` for staging MUST NOT include `projectRoot`, `harnessRoot`, or
`plan`. When reading context for execute, the orchestrator MUST strip these
fields if present and MUST apply CLI `--project-root` / harness root after
context defaults so context cannot override CLI paths.

#### Scenario: Context projectRoot does not override CLI
- **WHEN** execute runs with CLI `--project-root` A and context contains
  `projectRoot` B
- **THEN** `executeInitPlan` MUST use A as `projectRoot`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Satisfied dependency explicit skip does not break closure

The system SHALL NOT treat an explicit `skip` on a dependency task whose plan
`status` is `satisfied` as a dependency-closure violation when validating
decisions.

#### Scenario: harness-install satisfied and explicitly skipped
- **WHEN** `harness-install` has `status: satisfied` and decision marks it
  `skip`, and `run-global-phases` is `run`
- **THEN** `validateDecisionJson` MUST NOT report dependency closure violation
  for that pair

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Emit staging template without pre-existing context file

When `--emit-staging-template` is used, the CLI SHALL treat a missing
`--context-file` path as empty context and emit a staging template (including
`decision.materialized_adapters: []` as a placeholder). The `--execute` path
MUST still require a readable context file when `--context-file` is supplied.

#### Scenario: Emit without context file succeeds
- **WHEN** `--emit-staging-template --context-file <missing>` runs
- **THEN** the CLI MUST exit 0 and print JSON with `decision` and `context`
- **AND** `decision.materialized_adapters` MUST be `[]`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`
