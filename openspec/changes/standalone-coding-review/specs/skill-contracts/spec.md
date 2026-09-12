## ADDED Requirements

### Requirement: Coding and review consume bound construction inputs

Modern coding and combined review SHALL consume P1 resolved contracts and acceptance, including P3 blueprint projections. Narrative spec/plan documents MUST NOT be mandatory when no corresponding document is consumed. Contract files, CU projections, module boundaries and native compilation MUST remain enforced.

Enforcement: `skills/feature/coding/contract.yaml`, `skills/feature/code-review/contract.yaml`, `harness/scripts/check-coding.ts`, `harness/scripts/check-review.ts`.

#### Scenario: Sufficient design without narrative documents
- **WHEN** a run has valid typed contracts and acceptance but no spec.md or plan.md
- **THEN** coding and combined review SHALL consume that design without creating empty documents

#### Scenario: Missing or expanded construction authority
- **WHEN** CU mappings or declared files are missing, or implementation exceeds the bound contract
- **THEN** the existing checks MUST reject the implementation and direct correction to its design owner
