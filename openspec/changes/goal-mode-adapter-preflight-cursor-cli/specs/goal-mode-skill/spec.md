## MODIFIED Requirements

### Requirement: Goal mode skill is a thin entry point

The system SHALL provide `skills/project/goal-mode/SKILL.md` that documents how to invoke `goal-runner` and interpret reports, without duplicating verdict classification logic. Host entry SHALL be `/goal-mode` (Claude slash) or skill id `goal-mode` (cursor/codex/generic bridge). Before starting goal-runner, the agent SHALL run `check-personal-setup.ts --json --ensure` per `personal-setup-gate.md`.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/skills.index.yaml`, `agents/*/adapter.yaml`

#### Scenario: Agent reads skill for goal run

- **WHEN** user requests goal mode via `/goal-mode`, natural language（目标模式 / 全自动）, or skill bridge
- **THEN** agent is directed to self-run goal-runner with manifest fields rather than implementing its own phase loop

#### Scenario: Goal mode NL takes priority over batch

- **WHEN** user message matches both goal-mode phrases and batch_authorized phrases
- **THEN** `resolveTransitionPolicy` MUST return `goal_mode` before `batch_authorized`

#### Scenario: Personal setup before goal-runner

- **WHEN** personal setup `--ensure` returns `needs_adapter_choice`
- **THEN** agent completes adapter selection via `init-orchestrate --scope personal` `record-adapter` before starting goal-runner

## ADDED Requirements

### Requirement: Goal mode accepts optional user adapter

The goal-mode skill SHALL document optional user-specified `adapter`, mapping to `--adapter` when the adapter is materialized with entry artifacts present.

Enforcement: `skills/project/goal-mode/SKILL.md`

#### Scenario: User specifies cursor adapter

- **WHEN** user requests goal mode with explicit cursor adapter and cursor is materialized
- **THEN** agent passes `--adapter cursor` to goal-runner
