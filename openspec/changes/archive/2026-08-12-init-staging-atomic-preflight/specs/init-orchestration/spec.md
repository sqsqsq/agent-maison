## ADDED Requirements

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

## MODIFIED Requirements

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
