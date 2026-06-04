## ADDED Requirements

### Requirement: Tier_1 init readiness is machine-verifiable before S1

The system SHALL provide `harness/scripts/init-readiness.mjs` that uses only Node.js
built-in modules to verify Tier_1 harness dependencies before any `npx ts-node`
invocation of init orchestration. The script MUST check
`node_modules/ts-node/package.json`, `node_modules/@types/node/package.json`,
`package.json` under the harness root, and that the current working directory is
the harness directory. It MUST output JSON `{ ok, missing, recommended_command }`
with `recommended_command` of `cd framework/harness && npm install`. It MUST NOT
run `npm install` automatically.

#### Scenario: Missing local node_modules reported before orchestrate
- **WHEN** `init-readiness.mjs` runs with cwd `framework/harness` and
  `node_modules/@types/node/package.json` is absent
- **THEN** `ok` MUST be `false` and `missing` MUST name the absent artifacts
- **AND** agents MUST NOT invoke `npx ts-node scripts/init-orchestrate.ts` until
  the user runs the recommended install command

> **Enforced by:** `harness/scripts/init-readiness.mjs`,
> `harness/tests/unit/init-readiness.unit.test.ts`,
> `skills/00-framework-init/SKILL.md`

### Requirement: Run-log entries carry optional skip reason

The orchestrator SHALL allow `InitRunLogEntry` to include optional `reason` with values
`satisfied`, `drift_default_keep`, `decision_skip`, `keep`, `preflight_blocked`,
or `dependency_blocked`. `schema_version` on the run-log MUST remain `"1.0"`.
Human-facing `message` MUST reflect the skip category; `buildRunSummary` MAY
continue to display `message` only.

#### Scenario: Satisfied task skip is auditable
- **WHEN** `executeInitPlan` skips a task with `status: satisfied`
- **THEN** the entry MUST have `reason: satisfied` and message `已满足，跳过`

#### Scenario: Doc drift default skip is auditable
- **WHEN** a doc task has `status: drift`, `default_action: skip`, and resolved
  action `skip`
- **THEN** the entry MUST have `reason: drift_default_keep` and message
  `drift 默认保留，跳过`

#### Scenario: Preflight and dependency blocks carry reason
- **WHEN** `buildPreflightBlockedLog` marks tasks skipped after a violation
- **THEN** those entries MUST have `reason: preflight_blocked`
- **WHEN** a task is skipped because a dependency failed
- **THEN** the entry MUST have `reason: dependency_blocked`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Run-log top-level audit metadata

The orchestrator SHALL allow `InitRunLog` to include optional `mode`, `plan_generated_at`, `project_root`, and
`materialized_adapters`. CLI execute and blocked preflight paths MUST populate
available fields. `buildRunSummary` MUST include a short metadata section when
present.

#### Scenario: Successful execute run-log includes audit fields
- **WHEN** `--execute` completes for a project init with adapters `["claude"]`
- **THEN** written `run-log.json` MUST include `project_root` and
  `materialized_adapters` when supplied by the orchestrator

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Staging context metadata is normalized

`normalizeStagingContext` MUST strip `projectRoot`, `harnessRoot`, `plan`,
`schema_version`, and `scope` from staging `context.json` before execution context
is built. Execution payloads (`configWritePayload`, `docWritePayload`,
`materializedAdapters`, etc.) MUST be retained.

#### Scenario: schema_version and scope stripped before execute
- **WHEN** `context.json` includes `schema_version`, `scope`, and `configWritePayload`
- **THEN** `normalizeStagingContext` MUST remove the metadata keys
- **AND** MUST retain `configWritePayload` for S3 execution

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

### Requirement: Smart implicit task action respects allowed_actions

The system SHALL ensure that when `decision_mode` is `smart` and no explicit
decision entry exists for a task, `resolveTaskAction` MUST choose only actions
listed in `allowed_actions`, using
drift priority `overwrite` then `keep` then `skip`, and MUST throw when no action
is allowed (e.g. never return `overwrite` for doc drift tasks that only allow
`run` and `skip`).

#### Scenario: Doc drift without explicit entry resolves to skip
- **WHEN** `resolveTaskAction` runs in smart mode for a doc task with
  `status: drift`, `default_action: skip`, `allowed_actions: ['run','skip']`, and
  no explicit decision entry
- **THEN** the resolved action MUST be `skip`

> **Enforced by:** `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`

## MODIFIED Requirements

### Requirement: S4 init summary lists optional next steps only

Skill 00 and materialized `/framework-init` command templates MUST list optional
downstream steps after init without prompting the user to immediately enter
catalog-bootstrap, glossary-bootstrap, or prd-design (no default yes/no gate to
the next Skill).

#### Scenario: S4 does not prompt immediate catalog-bootstrap
- **WHEN** framework-init completes successfully
- **THEN** the agent summary MUST NOT ask「是否现在进入 catalog-bootstrap」or equivalent default yes/no gate
- **AND** MUST only list optional next steps for the user to choose explicitly

> **Enforced by:** `skills/00-framework-init/SKILL.md`,
> `agents/claude/templates/commands/framework-init.md`
