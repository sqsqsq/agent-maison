## ADDED Requirements

### Requirement: Init never reads or writes host SCM configuration

Project init SHALL treat the host's source-control configuration as outside the
Maison contract. No init stage — readiness, S1 probe, S2 approval, S3 execution,
or S4 summary — MAY read, diagnose, create, or modify the host `.gitignore`, and
no init task, writer, inspection, advisory, or always-SKIP placeholder MAY exist
for it. `ensure-gitignore`, `ensureCanonicalGitignore`, canonical host ignore
patterns, the ignore-equivalence map, ignore advisories, and the
`CHECK_INIT_SKIP_GITIGNORE_SYNC` environment bypass SHALL all be deleted rather
than retained as compatibility shells.

Config input SHALL come only from the current on-disk `framework.config.json`,
template/backfill/migration defaults, and the S2-approved payload. Init SHALL NOT
recover config from any SCM history, index, stash, or ref; the
`show-last-committed-framework-config.mjs` helper and the
`recovered_framework_config` prefill SHALL be removed.

Existing host `.gitignore` bytes SHALL be left untouched: Maison neither migrates
nor reverse-cleans them, it simply stops managing them.

Enforcement: `harness/scripts/check-init.ts`, `harness/scripts/utils/init-task-planner.ts`, `harness/scripts/utils/init-task-executor.ts`, `skills/project/framework-init/SKILL.md`

#### Scenario: S1 and S3 leave host .gitignore untouched

- **WHEN** a full init runs S1 probe and an approved S3 execution against a host project that has a `.gitignore`
- **THEN** the file's bytes MUST be unchanged, the task plan and run-log MUST contain no `ensure-gitignore` entry, and no `.gitignore` inspection row MUST appear

#### Scenario: Missing config is not recovered from SCM history

- **WHEN** S1 finds `framework.config.json` missing in a host project that is a Git repository with a previously committed config
- **THEN** init MUST proceed by the CREATE/migration contract using disk, template and S2 payload only, and MUST NOT read committed, staged, or stashed config snapshots

### Requirement: framework-init is entered only by positive init intent

The framework-init Skill SHALL start or continue only when one of these facts
holds: the user explicitly selects or invokes framework-init; the user explicitly
asks to onboard a Maison release package for the first time; the user explicitly
asks to create, complete, or migrate `framework.config.json`; the user explicitly
asks to refresh config, adapters, or materialized artifacts after integrating a
new release package; or an unfinished real S1 `InitTaskPlan` exists in the current
conversation and the user supplies a legal plan/adapters approval that neither
cancels nor switches the task.

framework-init SHALL NOT be a global request router, preflight, or public gate.
Ordinary requests SHALL NOT select, read, or pass through the Skill; the main
agent handles them on its normal path. The Skill SHALL NOT classify, name,
explain, enumerate, or hand back ordinary task kinds, and SHALL NOT contain a
route/result enum, a natural-language route table, a route parser, an
expected-label fixture, or sequencing logic for "finish X, then init". Ordering
across a non-init task and a later explicit init action belongs to the main
agent, which completes X first and calls framework-init only at the explicit init
action.

An explicit cancellation SHALL stop only the unfinished init, producing no S3 run
and no report; any other task in the same message stays with the main agent.

Enforcement: `skills/skills.index.yaml`, `skills/project/framework-init/SKILL.md`, `agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md`, `agents/{claude,codeagent,cursor}/templates/commands/framework-init.md`

#### Scenario: Explicit invocation enters the init kernel

- **WHEN** the user explicitly selects or invokes framework-init with no cancellation in the same message
- **THEN** the Skill MUST enter Tier_1 readiness → S1 without asking whether to run init, and S3 MUST still wait for S2 approval

#### Scenario: Discovery description carries no negative SCM vocabulary

- **WHEN** the machine-readable framework-init description is read from `skills/skills.index.yaml` and every checked-in bridge/command frontmatter
- **THEN** all of them MUST be byte-identical, MUST state only the positive init scope, and MUST NOT contain `Git`, `SCM`, `status`, `diff`, `add`, `stage`, `commit`, or `push`

#### Scenario: An ordinary request never reaches the Skill

- **WHEN** the user sends an ordinary request such as a code change, a review, a document edit, or a version-control action
- **THEN** the main agent MUST handle it directly, and framework-init MUST NOT be selected, read, or invoked, and MUST NOT be asked to classify or return the task

### Requirement: A misloaded framework-init exits with zero init side effects

A misloaded framework-init SHALL stop before any init effect. When a client or
model has already loaded the Skill while the latest message does not satisfy
positive init intent, there SHALL be no readiness probe, no S1, no planner, no
harness command, no init tool, and no generated, restated, or linked init result. It SHALL NOT explain,
classify, or take over the ordinary task, SHALL NOT ask whether to run init, and
SHALL NOT ask the user to rephrase an invocation.

This fallback SHALL remain an unnamed, unenumerated stop expressed in the
canonical Skill text ahead of readiness, S1, and every harness command. It SHALL
NOT become a route, an outcome label, a route table entry, or a formal input path
for ordinary requests, and it SHALL NOT introduce a router function, state
machine, config or environment key, persistent session state, nonce, token,
lease, or route database.

Enforcement: `skills/project/framework-init/SKILL.md`, `agents/{claude,codeagent,cursor}/templates/commands/framework-init.md`

#### Scenario: Misloaded Skill stops before any init command

- **WHEN** framework-init is loaded into context but the latest user message carries no positive init intent
- **THEN** the Skill MUST stop before readiness/S1/planner/harness, MUST produce no init report or restated result, and MUST NOT ask whether to run init

#### Scenario: The fallback creates no production routing machinery

- **WHEN** the shipped framework-init text and init production code are inspected
- **THEN** they MUST contain no route/result enum, natural-language route table, route parser, expected-label fixture, or route state key introduced for this fallback

### Requirement: An init result proves only the turn and run that produced it

An S4 summary SHALL attest only to the S3 run recorded in its own `run_log`
(`started_at` / `finished_at` / `project_root`). Once the user sends the next
message, any earlier `InitTaskPlan`, run-log, summary, or S4 SHALL be historical
context only and SHALL NOT be presented as the current completion result.

The single exception is an unfinished real S1 acting as approval context for a
legal S2; even then the current turn MUST actually create a new S3 run before a
new S4 may be produced. When the current turn creates no new init run or report,
the agent SHALL NOT claim init completed this turn, restate the earlier
executed/skipped/failed counts, or list the earlier report directory as this
turn's output. A task title, an earlier Skill selection, a command chip, or a
prior S4 SHALL NOT carry an init forward on its own; commentary, tool actions,
and the final message SHALL all reflect the current turn's real work.

This is a turn-local result constraint on the Skill and command text, not a new
runtime state protocol: it uses facts already present in the conversation, writes
no disk state, changes no run-log schema, adds no report token, and does not turn
report-directory scanning into a production router.

Enforcement: `skills/project/framework-init/SKILL.md`, `agents/{claude,codeagent,cursor}/templates/commands/framework-init.md`

#### Scenario: A later ordinary turn does not replay the prior S4

- **WHEN** turn A ran a real init and produced an S4, and turn B is an ordinary request with no new init run
- **THEN** turn B MUST be handled by the main agent, MUST NOT restate turn A's counts or report path, and MUST NOT claim init completed this turn

#### Scenario: Legal S2 continuation still requires a fresh run

- **WHEN** an unfinished real S1 is approved in a later turn
- **THEN** a new S4 MAY only be reported after that turn actually executes a new S3 run producing a new run-log

## MODIFIED Requirements

### Requirement: Readonly probe produces task DAG

The system SHALL provide `init-task-planner.ts` that probes project state without
writing to disk and outputs an `InitTaskPlan` JSON with tasks, dependencies,
`allowed_actions`, and `skippable` flags.

#### Scenario: Probe does not mutate filesystem
- **WHEN** the planner runs against a fixture project root
- **THEN** no adapter artifacts, config, or backup directories MUST be
  created or modified during probe

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/tests/unit/init-task-planner.unit.test.ts`

### Requirement: Side effects are explicit DAG tasks

Deprecated artifact cleanup and auto_overwrite sync MUST NOT run during probe;
they MUST run only as named tasks after plan approval. No host `.gitignore`
mechanism task exists in the plan at any stage.

#### Scenario: Mechanism sync only via orchestrate S3
- **WHEN** `probeInitTaskPlan` or `runInitProbe` runs on a project with drifted
  auto_overwrite hooks
- **THEN** hook files MUST remain unchanged; aligning them requires an approved
  S3 decision for `sync-auto-overwrite:*` or `materialize-adapter:<name>`

#### Scenario: Plan contains no gitignore mechanism task
- **WHEN** a CREATE or UPDATE plan is produced
- **THEN** it MUST NOT contain `ensure-gitignore` or any renamed successor task,
  including a non-executing placeholder entry

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`

### Requirement: Execute performs no-side-effect preflight

The system SHALL run a no-side-effect preflight in `init-orchestrate.ts` before
`executeInitPlan` applies any project business or mechanism artifact writes. The
preflight MUST validate decision structure and enums, plan-relative decision JSON
(`validateDecisionJson`), and Skill-provided payload presence and legality for all
write-class tasks (`resolveTaskAction` not `skip` or `keep`).

When preflight fails, the orchestrator MUST NOT modify project business or
mechanism artifacts (including `framework.config.json`, adapter materialization,
and doc skeletons). It MAY write an audit run-log under
`framework/harness/reports/_global/init-orchestrate/<stamp>/`, MUST
emit a blocked run-log summary, and MUST exit non-zero. Whether the host ignores
that report directory is the host's decision and is not an init concern.

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
- **AND** `framework.config.json` and doc skeleton paths MUST remain unchanged

#### Scenario: Invalid configWritePayload blocked before any project write
- **WHEN** preflight resolves `ensure-config` to a write action and
  `configWritePayload.architecture` fails `validateArchitectureDsl`
- **THEN** preflight MUST fail before `executeInitPlan`
- **AND** `framework.config.json` MUST NOT be created or modified

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
- **AND** MUST NOT write any other independent mechanism task target

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
