## ADDED Requirements

### Requirement: Current structured semantic findings reach the original repair owner

Spec/plan SHALL consume current `verification_result.checks` through the existing issue-verification, repair candidate and design-authority route. A finding SHALL require readable current file evidence, concrete repair targets, known required acceptance IDs, independent row confirmation and consistent responsibility. Optional MAJOR advice MUST NOT be upgraded by severity alone. The verifier report MUST NOT enter its own material fingerprint. Current evidence SHALL match exact bytes first, then the existing registered identity-neutral digest semantics where applicable; real design or expected-result changes SHALL invalidate it without introducing a second material ledger. The existing id/status/severity/details/suggestion and issue-verification issue/verdict/evidence/repair_owner fields SHALL be reused; acceptance_ids and affected_files are new optional check fields in this change. A legacy valid report lacking them SHALL retain its original findings and return them to the original independent verifier for batch clarification through existing diagnosis feedback; explicit acceptance_ids: [] SHALL classify advice without dispatch. Design/CU conflicts SHALL reach design owner, be re-signed and projected, then continue plan/coding/UT/testing as actually required; no new plan issue file SHALL be created.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/verifier-material.ts`, `harness/scripts/utils/repair-responsibility.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/prompts/verify-spec.md`, `harness/prompts/verify-plan.md`.

#### Scenario: A PASS report contains a mandatory semantic inconsistency

- **WHEN** a current independently confirmed MAJOR FAIL affects AC-3 countdown/resend or navigation test boundaries
- **THEN** the original design owner SHALL receive the concrete finding even though aggregate verifier verdict is PASS, and completion SHALL remain open until repaired or validly refuted

#### Scenario: Same-invocation design publication supersedes an earlier definition proposal

- **WHEN** a confirmed finding publishes and recovers the design authority but the current run must halt for stale frozen bindings
- **THEN** the runtime SHALL leave that invocation's pre-publication definition proposal unused, retain binding validation, and follow its existing halt/successor path so the producing phase recomputes a current proposal

### Requirement: Refusal returns to the current independent source review

The original owner SHALL supply concrete requirement or executable factual evidence when refusing. Existing refusal ledgers and goal brief SHALL carry the reason back to independent verification. A carried old subject that did not read the reason MUST NOT reconfirm the same proposal; ungrounded refusal MUST NOT erase a required obligation. Existing no-progress and budget limits SHALL bound unchanged repetition. Unattended repair SHALL remain within existing task authorization; attended confirmation and real secrets/irreversible actions/hard budgets SHALL remain protected.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/goal-brief.ts`.

#### Scenario: Old confirmation cannot ignore a new refusal reason

- **WHEN** a refusal is recorded but only a carried historical subject confirms the finding
- **THEN** no new repair SHALL be dispatched from that confirmation; the current independent source review SHALL first consume the reason
