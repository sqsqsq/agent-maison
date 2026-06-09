# goal-mode-skill Specification

## Purpose

Define the host-facing goal-mode thin entry (`/goal-mode` / skill id `goal-mode`) that directs agents to self-run `goal-runner` without duplicating harness verdict logic.
## Requirements
### Requirement: Goal mode skill is a thin entry point

The system SHALL provide `skills/project/goal-mode/SKILL.md` that documents how to invoke `goal-runner` and interpret reports, without duplicating verdict classification logic. Host entry SHALL be `/goal-mode` (Claude slash) or skill id `goal-mode` (cursor/codex/generic bridge).

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/skills.index.yaml`, `agents/*/adapter.yaml`

#### Scenario: Agent reads skill for goal run

- **WHEN** user requests goal mode via `/goal-mode`, natural language（目标模式 / 全自动）, or skill bridge
- **THEN** agent is directed to self-run goal-runner with manifest fields rather than implementing its own phase loop

#### Scenario: Goal mode NL takes priority over batch

- **WHEN** user message matches both goal-mode phrases and batch_authorized phrases
- **THEN** `resolveTransitionPolicy` MUST return `goal_mode` before `batch_authorized`

