## MODIFIED Requirements

### Requirement: Source drift is invalidated and revalidated by its responsible phase

The mutation scope and current drift fingerprint SHALL remain normalized machine facts, and `pre_authorized_mutations` or agent gap-notes MAY be retained as intent provenance only. No receipt, signer, or preauthorization SHALL classify drift as accepted. Post-review product-source drift SHALL be adjudicated exactly once, by the phase checker that owns it — `ut_no_src_mutation` for UT and `review_closure_attestation` for testing — which reclassifies the change as a coding change, grades it by risk, and states the review it requires. No other stage SHALL re-derive a disposition from the same attestation facts. In particular the goal runtime MUST NOT recompute a second, stricter disposition, upgrade a checker WARN into a forced chain backtrack, or halt because the closure attestation baseline is absent; and the clean-pass collector that gates run status and the feature completion certificate MUST NOT record reconciled-baseline drift as a completion-blocking issue, since doing so ends an otherwise passing chain as PARTIAL with a non-zero exit and no certificate — a third block rather than the disclosure this contract requires. An absent attestation remains a completion-blocking issue: that is missing evidence, not graded evidence. When the owning checker itself judges the drift blocking, the existing `backtrack_to_phase` transaction to the responsible owner applies when that owner is present in the resolved chain; a truncated chain without the owner SHALL use `backtrack_target_absent` and guide a full/successor run; it SHALL NOT create an adjudication request or human release route. A testing phase with no successor phase SHALL still disclose an unreviewed drift through the current run's readiness signals, derived from the in-memory script report rather than a previously written report file.

Enforcement: `harness/scripts/utils/mutation-authorization.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-ut.ts`, `harness/harness-runner.ts`

#### Scenario: preauthorization does not pass drift

- **WHEN** a frozen `pre_authorized_mutations` entry covers a post-review drift
- **THEN** the entry SHALL remain audit provenance while the drift is graded by its owning checker and disclosed as unreviewed

#### Scenario: the runtime does not re-judge a graded WARN

- **WHEN** `review_closure_attestation` reports post-review source drift as a graded WARN with its required reviews
- **THEN** the goal runtime SHALL continue on the harness verdict, SHALL NOT move the phase index, and SHALL NOT invalidate the coding closure

#### Scenario: graded drift does not block the completion certificate

- **WHEN** every phase passes and the only outstanding fact is reconciled-baseline drift already graded by its owning checker
- **THEN** the run SHALL conclude as a completed chain slice with a zero exit and SHALL generate the feature completion certificate, with the unreviewed drift disclosed through the checker result and the run's readiness signals

#### Scenario: a missing baseline does not stop the run

- **WHEN** `review-closure-attestation.json` is absent or unreadable in a goal run
- **THEN** the owning checker SHALL report the unavailable baseline and its required final merged diff review, and the run SHALL continue instead of halting or demanding a successor run

#### Scenario: the final testing phase discloses unreviewed drift

- **WHEN** testing is the last phase in the chain and its `review_closure_attestation` is a WARN
- **THEN** the current run summary SHALL carry a readiness signal of status `unknown` naming the required reviews, computed from this run's checks

#### Scenario: a truncated chain cannot reach the owner

- **WHEN** the chain is `ut→testing` and a blocking drift disposition belongs to coding
- **THEN** the runner SHALL report `backtrack_target_absent` with a coding-rooted successor/full-chain route and SHALL NOT request a human mutation receipt
