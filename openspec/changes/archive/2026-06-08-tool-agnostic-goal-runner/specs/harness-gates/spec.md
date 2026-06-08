## ADDED Requirements

### Requirement: Workflow manifest supports goal transition fields

The system SHALL extend `specs/workflow-schema.json` and `workflow-loader` to accept optional `transition_policy` and `auto_chain` on workflow manifests.

Enforcement: `specs/workflow-schema.json`, `harness/workflow-loader.ts`, `workflows/spec-driven.workflow.yaml`

#### Scenario: Spec-driven workflow loads transition_policy

- **WHEN** `spec-driven.workflow.yaml` includes `transition_policy: manual`
- **THEN** workflow-loader MUST parse it without validation error

### Requirement: Phase transition policy supports goal_mode resolution

The system SHALL implement `resolveAutoChain` and `classifyPhaseVerdict` in `phase-transition-policy.ts` for goal-runner consumption.

Enforcement: `harness/scripts/utils/phase-transition-policy.ts`

#### Scenario: INCOMPLETE with deferrable block continues when allowed

- **WHEN** classifyPhaseVerdict receives INCOMPLETE with deferrable blocking_class per dependency_policy
- **THEN** it MUST return `defer_external_and_continue_if_allowed`
