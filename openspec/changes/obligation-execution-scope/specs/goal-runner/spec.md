## ADDED Requirements

### Requirement: Execution scope is bound at real Goal birth

Fresh scoped runs SHALL consume the Feature candidate once and freeze execution_scope with phase_chain and the existing run_created identity. Resume/attach SHALL validate birth and ignore candidate/track changes; damaged new scope SHALL NOT become legacy absence. Feature completion SHALL validate this independent scope, all required duties, actual closure and reused evidence identities. request-only results and unresolved scopes SHALL NOT receive Feature completion.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`.

#### Scenario: Interactive scoped implementation has genuine completion lineage
- **WHEN** prepare CLI and attended bridge execute coding/review/ut through the canonical runtime
- **THEN** real run_created, phase_start, attempts and run_end SHALL support VALID completion and CU consumption without spec/plan/testing execution

#### Scenario: Completion narrows its own chain
- **WHEN** a completion claims UT only while the birth scope also requires coding and review
- **THEN** verification SHALL reject the claim even if its projection hash is self-consistent

### Requirement: Scope successors use existing owner release and birth mechanisms

At a real phase boundary, sourced new facts MAY propose scope_revision_input through the existing checker report. runtime SHALL preserve request boundaries and required duties, record one scope_revision_requested with a fixed successor ID, seal according to actual outcomes and release existing owner/locks before successor creation. Successors SHALL use inheritSuccessorManifest/createGoalRun, inherit budgets/pins/authority and preserve real source outcomes; PARTIAL/HALTED source PASS SHALL NOT become reusable completion evidence.

Repeated continue SHALL recover the recorded successor, reject partial birth through existing diagnostics, and verify an already completed successor without another invocation. No mtime selection, force takeover, new ledger or extra run-state directory SHALL be introduced.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-run-control.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-manifest.ts`.

#### Scenario: Spec reveals a device obligation
- **WHEN** spec produces new device acceptance and its scoped slice closes
- **THEN** the source SHALL release execution ownership before the registered successor executes the new frozen chain, preserving source evidence and consumed budget

#### Scenario: Handoff is interrupted
- **WHEN** execution stops after intent, after release, or after birth before dispatch
- **THEN** continue SHALL use the same successor ID and execute its first phase once, without repeating the source investigation

#### Scenario: Coding discovers a design gap
- **WHEN** coding reports a sourced new design decision and remains failed
- **THEN** source status SHALL remain PARTIAL/HALTED and the successor SHALL return to the design owner before implementation, without crediting the failed source's PASS records
