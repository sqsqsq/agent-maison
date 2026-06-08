## ADDED Requirements

### Requirement: Goal orchestration skill is a thin entry point

The system SHALL provide `skills/project/goal-orchestration/SKILL.md` that documents how to invoke `goal-runner` and interpret reports, without duplicating verdict classification logic.

Enforcement: `skills/project/goal-orchestration/SKILL.md`, `skills/skills.index.yaml`

#### Scenario: Agent reads skill for goal run

- **WHEN** user requests full-chain delivery via agent skill
- **THEN** agent is directed to run goal-runner CLI with manifest fields rather than implementing its own phase loop
