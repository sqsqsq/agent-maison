## ADDED Requirements

### Requirement: One pure scope resolver derives obligations and stable order

The framework SHALL resolve normalized request results, sourced facts, valid P1 content and registered workflow providers through resolveExecutionScope. It SHALL distinguish required/not_applicable/unknown, information reuse and real control predecessors. Acceptance layers SHALL use the existing layering check; device availability, test FAIL, manual or timeout SHALL NOT subtract obligations. Explicit request endpoints SHALL not become full Feature completion.

Enforcement: `harness/scripts/utils/execution-scope.ts`, `harness/scripts/utils/acceptance-layering.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/runtime-policy.ts`.

#### Scenario: Host-only verification completes at UT
- **WHEN** valid scoped acceptance requires unit evidence and no device evidence
- **THEN** testing SHALL be absent from the execution chain, without placeholder reports

#### Scenario: Unknown downstream evidence preserves safe investigation
- **WHEN** spec investigation is required but later device responsibility is unknown
- **THEN** spec SHALL remain executable and unknown-dependent work/completion SHALL remain unresolved

#### Scenario: Existing control predecessor is not an information substitute
- **WHEN** a required control predecessor is neither scheduled nor backed by valid execution evidence
- **THEN** range validation SHALL reject the dependent operation
