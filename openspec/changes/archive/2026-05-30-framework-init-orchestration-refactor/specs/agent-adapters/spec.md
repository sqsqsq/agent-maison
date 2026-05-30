# Delta: Agent Adapters — Multi-adapter materialization

## ADDED Requirements

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

> **Enforced by:** `skills/00b-framework-setup/SKILL.md`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate-smoke.unit.test.ts`
