# Delta: Framework Local Config

## ADDED Requirements

### Requirement: Personal settings in gitignored local file

The system SHALL store personal settings in `<projectRoot>/framework.local.json`
(gitignored), including `agent_adapter` and `toolchain.devEcoStudio.installPath`.
Project-level `framework.config.json` MUST use `materialized_adapters: string[]`
instead of a single active adapter.

#### Scenario: Local merge at runtime
- **WHEN** both project config and local config exist
- **THEN** `loadFrameworkConfig()` MUST expose merged runtime values with
  `agent_adapter` from local overriding project legacy fields

> **Enforced by:** `harness/config.ts`, `specs/framework.local.schema.json`

### Requirement: Personal setup status with forced callers

The system SHALL expose `getFrameworkPersonalSetupStatus()` returning
`local | project_legacy | fallback` for `agent_adapter`, and MUST be invoked
before phase runs (harness-runner), Skill bootstrap, and adapter slash commands.
When status is `fallback`, the system MUST guide personal setup and MUST NOT
silently continue as generic.

#### Scenario: Feature phase blocked without personal setup
- **WHEN** harness-runner starts a feature phase and
  `getFrameworkPersonalSetupStatus().source` is `fallback`
- **THEN** the runner MUST exit non-zero and direct the user to
  `/framework-setup` before continuing

#### Scenario: check-personal-setup CLI for Skill and adapter entry
- **WHEN** `check-personal-setup.ts --project-root <repo>` runs and personal
  setup status is `fallback`, or active adapter is not in
  `materialized_adapters`, or the adapter entry file is missing
- **THEN** the script MUST exit non-zero with guidance to `/framework-setup`
  or `/framework-init` as appropriate

> **Enforced by:** `harness/config.ts`, `harness/harness-runner.ts`,
> `harness/scripts/check-personal-setup.ts`,
> `harness/scripts/utils/personal-setup-gate.ts`,
> `harness/tests/unit/personal-setup-gate.unit.test.ts`,
> `skills/reference/personal-setup-gate.md`

### Requirement: Migrate legacy personal fields on UPDATE

UPDATE init MUST migrate `agent_adapter` and DevEco installPath from project
config to local file via `extract_personal_to_local` migration rule.

#### Scenario: Legacy agent_adapter moves to local on migrate-config
- **WHEN** S3 executes `migrate-config` on a project config that still contains
  `agent_adapter` and `toolchain.devEcoStudio.installPath`
- **THEN** project config MUST gain `materialized_adapters`, lose personal
  fields, and `framework.local.json` MUST receive the migrated values

> **Enforced by:** `harness/scripts/utils/config-field-merger.ts`
