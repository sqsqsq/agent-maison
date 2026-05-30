# Delta: Init Orchestration

## ADDED Requirements

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

### Requirement: Context payload required for config and doc writes

S3 tasks that write `framework.config.json` or doc skeletons MUST require
Skill-provided context. Missing payload MUST fail the task (not report executed).

#### Scenario: ensure-config fails without configWritePayload
- **WHEN** S3 executes `ensure-config` with action `run` and no
  `configWritePayload` in execution context
- **THEN** the run-log entry MUST be `failed` and MUST NOT write
  `framework.config.json`

#### Scenario: ensure-config fails on invalid architecture before write
- **WHEN** S3 executes `ensure-config` with `configWritePayload.architecture`
  that fails `validateArchitectureDsl` (e.g. `can_depend_on` references missing layer)
- **THEN** the run-log entry MUST be `failed`, MUST NOT write or backup
  `framework.config.json`, and tasks depending on `ensure-config` MUST be skipped

#### Scenario: ensure-config does not persist normalized personal or legacy aliases
- **WHEN** S3 executes `ensure-config` with a legal `configWritePayload` that
  lists `materialized_adapters` but omits `agent_adapter`
- **THEN** the written `framework.config.json` MUST NOT contain `agent_adapter`
  or legacy `project_type`, and MUST NOT contain personal DevEco `installPath`

#### Scenario: write-architecture fails without docWritePayload
- **WHEN** S3 executes `write-architecture` with action `run` and no
  `docWritePayload.architecture_md`
- **THEN** the run-log entry MUST be `failed` and MUST NOT create
  `doc/architecture.md`

> **Enforced by:** `harness/scripts/utils/init-task-executor.ts`,
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
