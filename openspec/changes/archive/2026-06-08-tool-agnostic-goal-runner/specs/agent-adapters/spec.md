## ADDED Requirements

### Requirement: Adapters may declare optional goal_capability

The system SHALL allow adapters to declare an optional `goal_capability` block in `adapter.yaml` with `mode` (`native_goal` | `external_runner`), headless invoke templates, and unattended permission contract.

Enforcement: `agents/adapter-schema.yaml`, `harness/scripts/check-init.ts`

#### Scenario: check-init warns on missing goal_capability

- **WHEN** framework-init check-init runs and adapter lacks `goal_capability`
- **THEN** check-init MUST emit WARN only and MUST NOT BLOCKER-fail init

#### Scenario: goal-runner preflight blocks missing capability

- **WHEN** goal-runner starts with active adapter lacking valid `goal_capability`
- **THEN** preflight MUST exit non-zero before agent invocation
