## ADDED Requirements

### Requirement: Workflow 1.2 declares static obligation providers

Workflow loader/schema SHALL support 1.2 with registered obligation_provider_id per phase. Track fields SHALL remain 1.1-only. auto_chain SHALL be a valid stable preference order, not an unconditional execution obligation. Legacy information requires SHALL NOT become unconditional control predecessors in the new protocol. Unknown custom providers/phases SHALL fail with an explicit missing declaration.

Enforcement: `specs/workflow-schema.json`, `harness/workflow-loader.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/execution-scope.ts`.

#### Scenario: Custom phase lacks applicability rule
- **WHEN** workflow 1.2 declares a custom phase without a registered obligation provider
- **THEN** loading SHALL fail rather than silently excluding that responsibility

#### Scenario: Legacy workflow remains usable
- **WHEN** an existing consumer loads workflow 1.0 or 1.1
- **THEN** its existing track rules SHALL remain unchanged
