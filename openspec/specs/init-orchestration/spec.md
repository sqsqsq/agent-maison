# init-orchestration Specification

## Purpose
TBD - created by archiving change framework-init-orchestration-refactor. Update Purpose after archive.
## Requirements
### Requirement: Readonly probe produces task DAG

The system SHALL provide `init-task-planner.ts` that probes project state without
writing to disk and outputs an `InitTaskPlan` JSON with tasks, dependencies,
`allowed_actions`, and `skippable` flags.

#### Scenario: Probe does not mutate filesystem
- **WHEN** the planner runs against a fixture project root
- **THEN** no `.gitignore`, adapter artifacts, or backup directories MUST be
  created or modified during probe

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/tests/unit/init-task-planner.unit.test.ts`

### Requirement: Orchestrator accepts enum decision JSON only

The system SHALL provide `init-orchestrate.ts` that executes approved task plans
using decision JSON referencing only declared `task.id`, `action`, and `param`
values; unknown or dependency-violating decisions MUST be rejected.

#### Scenario: Unknown task id rejected
- **WHEN** execute receives a decision referencing `task.id` not in the plan
- **THEN** execution MUST fail without applying partial writes

> **Enforced by:** `harness/scripts/init-orchestrate.ts`

### Requirement: Side effects are explicit DAG tasks

Gitignore ensure, deprecated artifact cleanup, and auto_overwrite sync MUST NOT
run during probe; they MUST run only as named tasks after plan approval.

#### Scenario: Mechanism sync only via orchestrate S3
- **WHEN** `probeInitTaskPlan` or `runInitProbe` runs on a project with drifted
  auto_overwrite hooks
- **THEN** hook files MUST remain unchanged; aligning them requires an approved
  S3 decision for `sync-auto-overwrite:*` or `materialize-adapter:<name>`

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`

### Requirement: Project probe ignores personal active adapter

For `--scope project`, the planner MUST derive adapter hint and
`materialized_adapters` from project config only. Merged
`framework.local.json` `agent_adapter` MUST NOT influence project init tasks.

#### Scenario: Local claude does not override materialized cursor
- **WHEN** project config has `materialized_adapters: ["cursor"]` and local config
  has `agent_adapter: "claude"`
- **THEN** `probeInitTaskPlan` MUST include `materialize-adapter:cursor` and
  MUST NOT include `materialize-adapter:claude`

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate-smoke.unit.test.ts`

### Requirement: S3 execution plan honors S2 materialized adapter selection

For `--execute` with `context.json`, the orchestrator MUST rebuild
`materialize-adapter:*` tasks from `materializedAdapters` or
`configWritePayload.materialized_adapters`. Readonly S1 probe MUST remain
unchanged when no context is supplied.

#### Scenario: CREATE with context cursor materializes cursor not generic
- **WHEN** `prepareInitExecutionPlan` runs on an empty project root with
  context `materializedAdapters: ["cursor"]`
- **THEN** the plan MUST include `materialize-adapter:cursor` and MUST NOT
  include `materialize-adapter:generic`

#### Scenario: CREATE with two adapters materializes both
- **WHEN** context lists `["claude", "cursor"]`
- **THEN** the plan MUST include both `materialize-adapter:claude` and
  `materialize-adapter:cursor`

#### Scenario: Unknown decision task_id is rejected after reconcile
- **WHEN** `--execute` runs with a decision containing `totally-unknown-task`
  (not a stale `materialize-adapter:*` entry)
- **THEN** execution MUST fail validation and MUST NOT write project artifacts

#### Scenario: Non-stale materialize-adapter task_id is rejected
- **WHEN** `--execute` runs with a decision containing `materialize-adapter:evil`
  that is not in the S3 plan and not in the S1→S2 stale whitelist
- **THEN** execution MUST fail validation and MUST NOT write project artifacts

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: DAG execution propagates task failure

When an approved task fails during S3, dependent tasks MUST be skipped and MUST
NOT produce side effects.

#### Scenario: Dependent tasks skipped after failure
- **WHEN** `executeInitPlan` runs a task that throws and a downstream task lists
  the failed task in `deps`
- **THEN** the downstream entry MUST be `skipped` with a dependency message and
  MUST NOT invoke its executor

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Execute performs no-side-effect preflight

The system SHALL run a no-side-effect preflight in `init-orchestrate.ts` before
`executeInitPlan` applies any project business or mechanism artifact writes. The
preflight MUST validate decision structure and enums, plan-relative decision JSON
(`validateDecisionJson`), and Skill-provided payload presence and legality for all
write-class tasks (`resolveTaskAction` not `skip` or `keep`).

When preflight fails, the orchestrator MUST NOT modify project business or
mechanism artifacts (including `.gitignore`, `framework.config.json`, adapter
materialization, and doc skeletons). It MAY write an audit run-log under
`framework/harness/reports/_global/init-orchestrate/<stamp>/` (gitignored), MUST
emit a blocked run-log summary, and MUST exit non-zero.

#### Scenario: Invalid decision structure rejected before reconcile
- **WHEN** `--execute` runs with a decision file missing `tasks` or with invalid
  `schema_version` / `scope` / `decision_mode`
- **THEN** the CLI MUST fail with a friendly error before `reconcileInitRunDecisionForPlan`
- **AND** MUST NOT throw an uncaught TypeError

#### Scenario: Unknown task_id blocked with audit run-log and zero project writes
- **WHEN** preflight runs after reconcile and `validateDecisionJson` rejects an
  unknown `task_id`
- **THEN** the orchestrator MUST write a blocked run-log with a synthetic `failed`
  entry naming the violation
- **AND** all plan tasks MUST be `skipped` in that run-log
- **AND** no project business or mechanism artifacts MUST be created or modified

#### Scenario: Missing docWritePayload blocked atomically
- **WHEN** preflight resolves `write-architecture` (or catalog/glossary doc tasks)
  to a write action and `context.docWritePayload` lacks the required content
- **THEN** the blocked run-log MUST mark that task `failed`
- **AND** other plan tasks MUST be `skipped`
- **AND** `framework.config.json`, `.gitignore`, and doc skeleton paths MUST
  remain unchanged

#### Scenario: Invalid configWritePayload blocked before ensure-gitignore
- **WHEN** preflight resolves `ensure-config` to a write action and
  `configWritePayload.architecture` fails `validateArchitectureDsl`
- **THEN** preflight MUST fail before `executeInitPlan`
- **AND** `framework.config.json` and `.gitignore` MUST NOT be created or modified

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Context payload required for config and doc writes

S3 tasks that write `framework.config.json` or doc skeletons MUST require
Skill-provided context with valid payload. Missing or illegal payload MUST be
detected during preflight when the resolved action is a write. Preflight failure
MUST produce a blocked run-log without project business or mechanism writes.
Executor guards remain as defense-in-depth when preflight passes.

#### Scenario: ensure-config fails without configWritePayload
- **WHEN** preflight resolves `ensure-config` with action `run` and no
  `configWritePayload` in execution context
- **THEN** preflight MUST fail with a blocked run-log entry `failed` for
  `ensure-config`
- **AND** MUST NOT write `framework.config.json` or other project mechanism artifacts

#### Scenario: ensure-config fails on invalid architecture before write
- **WHEN** preflight resolves `ensure-config` with `configWritePayload.architecture`
  that fails `validateArchitectureDsl` (e.g. `can_depend_on` references missing layer)
- **THEN** preflight MUST fail with `ensure-config` marked `failed` in the blocked run-log
- **AND** MUST NOT write or backup `framework.config.json`
- **AND** MUST NOT write `.gitignore` or other independent mechanism tasks

#### Scenario: ensure-config does not persist normalized personal or legacy aliases
- **WHEN** S3 executes `ensure-config` with a legal `configWritePayload` that
  lists `materialized_adapters` but omits `agent_adapter`
- **THEN** the written `framework.config.json` MUST NOT contain `agent_adapter`
  or legacy `project_type`, and MUST NOT contain personal DevEco `installPath`

#### Scenario: write-architecture fails without docWritePayload
- **WHEN** preflight resolves `write-architecture` with action `run` and no
  `docWritePayload.architecture_md`
- **THEN** preflight MUST fail with `write-architecture` marked `failed` in the
  blocked run-log
- **AND** MUST NOT create `doc/architecture.md`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/scripts/utils/init-task-executor.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`,
> `harness/tests/unit/init-task-executor.unit.test.ts`

### Requirement: Manual mode explicit decisions for prompt tasks

The orchestrator MUST reject manual-mode execute when any plan task with
`decision_class` or `default_action: prompt` lacks an explicit decision entry.
It MUST NOT default such tasks to `keep` or `skip`.

#### Scenario: Drift prompt task without decision rejected
- **WHEN** manual execute runs with an empty decision and the plan includes a
  drift task with `default_action: prompt` and `decision_class: init.task_decision`
- **THEN** validation MUST fail with an error naming the task id

#### Scenario: Personal record-adapter without decision rejected
- **WHEN** manual execute runs on a personal plan without a decision for
  `record-adapter` (`skippable: false`, `allowed_actions: ['run']`)
- **THEN** validation MUST fail and MUST NOT write `framework.local.json`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

