## ADDED Requirements

### Requirement: Dynamic completion binds authoritative scope and resolved requirements

Modern Feature completion SHALL bind execution_scope_fingerprint to the independently verified run scope. Required obligations, reused evidence, original artifact location and run/attempt/event lineage MUST remain verified. Requirement aggregation and P0 runtime responsibility SHALL consume actual P1-bound content rather than requiring physical narrative or acceptance files. Legacy completion SHALL retain its versioned contract.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-run-creation.ts`.

#### Scenario: Authorized implementation omits device testing
- **WHEN** a real attended run completes coding, review and UT with verified scope and no device obligation
- **THEN** Feature completion SHALL validate without inventing testing evidence

#### Scenario: Forged scope or missing actual runtime proof
- **WHEN** completion changes its scope fingerprint or a derived P0 device acceptance lacks required runtime evidence
- **THEN** completion MUST fail without falling back to legacy or empty obligations
