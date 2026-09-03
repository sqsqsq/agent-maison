# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Goal-env source-mutation gating shares the review-closure baseline and never trusts self-reported approvals

In the goal orchestration environment, the UT source-mutation gate SHALL judge drift against the review closure attestation baseline through the same reconciliation and classification used by the runner, never against the run-start diff: legitimate coding-phase changes are outside the adjudication domain. Agent-written gap-notes and preauthorization SHALL remain provenance only. Any post-review protected-source drift SHALL fail the current invocation, invalidate affected closure trust, and route through the responsible-phase write-boundary/backtrack contract; a missing or corrupt review attestation SHALL fail closed without a run-start fallback. These blockers MUST NOT be registered `human_only` or released by a fingerprint-matching receipt. The non-goal path SHALL use the same machine boundary when invocation attribution is available and otherwise fail closed for owner revalidation.

Enforcement: `harness/scripts/check-ut.ts`, `harness/scripts/utils/mutation-authorization.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: legitimate coding work is not flagged by the UT gate

- **WHEN** coding legitimately changed 36 files before review closure and only 1 file drifted after review
- **THEN** the goal-env gate SHALL flag only the 1 post-review drift as `goal_post_review_source_mutation_unresolved` and the 36 coding changes SHALL not block

#### Scenario: the self-signed seam no longer whiplashes harness-PASS into runner-HALT

- **WHEN** an agent registers its own seam in gap-notes and modifies protected source after review closure in a goal run
- **THEN** the harness gate itself SHALL FAIL with `goal_post_review_source_mutation_unresolved` instead of passing on the self-approval, and runner reconciliation SHALL invalidate trust and route to the responsible owner

#### Scenario: a deleted attestation cannot be washed through a fallback baseline

- **WHEN** the review closure attestation is missing while a goal run reaches ut
- **THEN** the gate SHALL fail closed as `goal_review_closure_baseline_unavailable` without computing a run-start diff or consulting gap-notes
