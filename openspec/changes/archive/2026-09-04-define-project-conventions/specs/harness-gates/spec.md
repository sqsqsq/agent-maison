## ADDED Requirements

### Requirement: Review gate validates convention coverage at MAJOR severity

The review phase SHALL register one conventions coverage rule at MAJOR severity. When activated, the deterministic checker SHALL validate unique asset, declaration and ledger ids before set comparisons; exact asset/ledger equality; verdict vocabulary; VIOLATION issue references; declaration membership; full-segment planned-location fulfillment against `contracts.files`; blueprint convention continuity; gate-ref existence in resolved phase rules; and the bidirectional gate-card/`GATE_DELEGATED` invariant. The checker MUST NOT read or compare another phase's current result and MUST NOT create a cross-report verdict authority.

#### Scenario: All convention representations agree

- **WHEN** asset ids, normalized declarations, blueprint refs, target files and review ledger satisfy every invariant
- **THEN** the review conventions rule SHALL pass without changing other review results

#### Scenario: Gate ref uses a known id in the wrong phase

- **WHEN** a gate card names an existing rule id under a phase where that id is not registered
- **THEN** the review conventions rule SHALL fail at MAJOR severity because gate identity is the `(phase, rule_id)` pair

#### Scenario: No asset and no declaration

- **WHEN** no conventions file exists and normalized contracts contain no declaration
- **THEN** the conventions rule SHALL skip and all pre-existing review behavior SHALL remain unchanged

> **Enforced by:** `specs/phase-rules/review-rules.yaml`, `harness/scripts/check-review.ts`, `harness/harness-runner.ts`, `harness/prompts/verify-review.md`

### Requirement: Review verifier receives conventions and target source together

When conventions are activated, the existing review context collector SHALL add the configured conventions file alongside contracts, acceptance, report and all target source files. The existing AI prompt assembler SHALL include both the full conventions content and target source content. `verify-review.md` MUST describe the target-file-set scope and legacy advisory policy rather than treating a feature diff as review authority.

#### Scenario: Activated review prompt is assembled

- **WHEN** the conventions file exists and contracts target a source file
- **THEN** the assembled review prompt SHALL contain both complete file contents for semantic assessment

#### Scenario: Historical coding diff report is mentioned

- **WHEN** review guidance refers to a coding-phase self-healing diff report as evidence
- **THEN** that narrow evidence reference MAY remain, but it MUST NOT redefine the review target set

#### Scenario: Target set contains source text and binary resources

- **WHEN** an activated review targets text source files together with a PNG or other non-text resource
- **THEN** the existing collector SHALL retain the full text source and only a path reference for binary resources, without injecting decoded binary bytes or NUL into the verifier prompt

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/report-generator.ts`, `harness/prompts/verify-review.md`, `harness/tests/unit/verifier-production-routing.unit.test.ts`
