## ADDED Requirements

### Requirement: Review follows the actual object and invocation boundary

Review SHALL require an existing object and an identified baseline rather than an unconditional coding phase in the current request. Required design comparisons MUST remain required. A request review SHALL write only its request result; Feature attestations and completion remain owned by the existing Feature path. Coding as the first phase MUST establish facts before source writes.

Enforcement: `skills/feature/coding/SKILL.md`, `skills/feature/code-review/SKILL.md`, `harness/scripts/check-review.ts`, `harness/scripts/utils/request-phase.ts`.

#### Scenario: Independent review of existing code
- **WHEN** a user requests review of existing code through the request CLI
- **THEN** the same checker SHALL validate the real report and baseline without starting coding or writing Feature evidence

#### Scenario: Implementation is not complete delivery
- **WHEN** coding passes but another required obligation has no valid evidence
- **THEN** existing completion verification MUST continue to reject Feature completion
