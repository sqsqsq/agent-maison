## MODIFIED Requirements

### Requirement: Completion status projects gaps and non-reverified verification honestly

The completion projection SHALL distinguish `COMPLETE`, `COMPLETE_WITH_GAPS`, `COMPLETE_WITH_P0_GAPS` and `FAILED`. A phase closed on a prior verifier PASS with changed material SHALL carry `verifier: completed_with_prior_review` and `current_material_not_reverified`; a phase re-closed by `--revalidate` SHALL carry `script_revalidated` and `semantic_not_reverified`. Each failure the disposition function discloses (listed in `summary.disclosed_failures`) SHALL count as one completion gap alongside unsupported gaps, so a phase otherwise complete reads `COMPLETE_WITH_GAPS`. None of these states SHALL be rendered as PASS for the current material, and none SHALL block normal development completion.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: Gaps and stale review are visible together

- **WHEN** a feature completes with two P0 unsupported gaps and a testing phase closed on a prior review
- **THEN** the projection reads `COMPLETE_WITH_P0_GAPS` with both facts listed

#### Scenario: A disclosed ledger failure is a gap, not a block

- **WHEN** a phase's only failure is a disclosed ledger check
- **THEN** the phase verdict SHALL be PASS and its completion label SHALL read `COMPLETE_WITH_GAPS`
