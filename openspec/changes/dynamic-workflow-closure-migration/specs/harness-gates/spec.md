## ADDED Requirements

### Requirement: Dynamic completion binds authoritative scope and resolved requirements

Modern Feature completion SHALL bind execution_scope_fingerprint to the independently verified effective scope of whichever carrier holds it. Required obligations, reused evidence and original artifact location MUST remain verified for both carriers; **run/attempt/event lineage MUST remain verified for the run carrier**. The feature carrier — a completion cut without any run — MUST instead be verified by the phase receipt, the phase evidence manifest integrity, the `gate_fingerprint`, evidence freshness, required-obligation coverage and the integrity of the frozen feature record (its scope content and its revision chain); it MUST NOT fabricate a run identity to satisfy the run-carrier checks, and its per-phase `run_id` MUST be null. Completion verification SHALL select the birth scope source by the record's `scope_source`, and every other criterion SHALL stay unchanged. A candidate alone, or bare phase reports without a generated completion record, MUST be INVALID. Requirement aggregation and P0 runtime responsibility SHALL consume actual P1-bound content rather than requiring physical narrative or acceptance files. Legacy completion SHALL retain its versioned contract.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-run-creation.ts`.

#### Scenario: A runless completion is verified without run lineage
- **WHEN** a Feature is delivered interactively with no run and its completion record declares the feature carrier
- **THEN** verification SHALL accept it on the phase-level evidence above and SHALL reject it if the frozen record is tampered with, if a run identity is fabricated, or if only bare reports exist

#### Scenario: Authorized implementation omits device testing
- **WHEN** a real attended run completes coding, review and UT with verified scope and no device obligation
- **THEN** Feature completion SHALL validate without inventing testing evidence

#### Scenario: Forged scope or missing actual runtime proof
- **WHEN** completion changes its scope fingerprint or a derived P0 device acceptance lacks required runtime evidence
- **THEN** completion MUST fail without falling back to legacy or empty obligations
