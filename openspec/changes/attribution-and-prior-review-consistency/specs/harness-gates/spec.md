# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: check-receipt adjudicates verifier evidence by subject echo

The finalize step SHALL adjudicate verifier evidence from the resolved plan alone. plan `disabled` → nothing required; plan `enabled` → load `<reports>/verifier.report.<subject>.md` for the current subject through the shared loader, which SHALL accept it only when the terminal block echoes `summary.verifier_subject_id` and `verdict` agrees with `blocker_count`.

Adjudication SHALL NOT dispatch on `summary.schema_version`. Splitting the read surface into a current generation and a grandfathered one made "the capability was legitimately turned off" indistinguishable from "this is an old artifact"; a phase re-validated without a current report is simply reviewed again, which costs one review and removes an entire dispatch axis.

When the current subject has no report but the phase holds any verified PASS report, closure SHALL proceed with `verifier: completed_with_prior_review` and `current_material_not_reverified` listing the differing material; it SHALL NOT be described as PASS for the current material. BLOCKER SHALL remain only when the policy is `required` and the phase never obtained a PASS report.

When a phase is closed that way, the run-level phase archive SHALL archive the very report the closure relied on and SHALL mark it as reused. The archive SHALL resolve evidence by trying the current subject first and then `summary.verifier_closure.reviewed_subject_id`, taking the first evidence that passes the shared loader's verification; on the reuse path it SHALL copy that report under the archive's fixed report name and SHALL record that the archived evidence comes from a prior review. It MUST NOT record the phase as holding no trustworthy verifier conclusion while its own `summary.json` copy states the closure reused a prior PASS. Where the current subject has its own verified report, that evidence SHALL take precedence and SHALL NOT be marked reused; where the phase never obtained a PASS report, the archive SHALL keep no verifier evidence and no report file rather than falling back to a FAIL or absent report. The archived report name and the archived file set SHALL NOT change, and no new evidence validation state SHALL be introduced.

When the plan is `disabled` for reason `adapter_has_no_reviewer`, the gate SHALL pass and SHALL disclose the verifier axis as `not_reviewed` in a non-blocking warning. A tool that cannot dispatch a subagent is an environment fact; refusing to close the phase over it makes the whole `full` track unusable on that adapter, while an honest disclosure keeps the closure record truthful.

Hand-written receipt fields SHALL hold no adjudication authority; a mismatch with the machine fact SHALL be a warning, never a verdict.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/goal-phase-snapshot.ts`

#### Scenario: Changed material with a prior PASS completes honestly

- **WHEN** spec.md changed after a verified PASS and the dispatcher did not re-run the verifier
- **THEN** the phase SHALL close with `completed_with_prior_review` and the summary SHALL list `spec.md` under `current_material_not_reverified`

#### Scenario: An adapter without a reviewer closes with disclosure

- **WHEN** the active adapter declares no `verifier_subagent` and a `full` phase's script gate passes
- **THEN** no request SHALL have been issued, the gate SHALL pass, and the verifier axis SHALL be recorded as `not_reviewed` with a non-blocking warning

#### Scenario: An unreadable report is a re-run, not a closure wall

- **WHEN** the report for the current subject is missing, carries zero or multiple terminal blocks, or contradicts its own blocker count
- **THEN** the gate SHALL name that single failure and SHALL instruct the dispatcher to re-run the verifier and rewrite the report

#### Scenario: A reused prior review is archived with the phase

- **WHEN** a phase closes with `completed_with_prior_review` and the run archives that phase's harness artifacts
- **THEN** the archive SHALL contain the reused report's bytes under the fixed report name, its evidence SHALL name the reviewed subject with verdict PASS, and that evidence SHALL be marked as coming from a prior review
- **AND** the archived `summary.json` copy SHALL still carry `verifier_closure.mode = completed_with_prior_review` and the `semantic_not_reverified` readiness signal

#### Scenario: A phase that was never reviewed archives no verifier evidence

- **WHEN** a phase has never obtained a verified PASS report, so no reuse closure was derived
- **THEN** the archive SHALL record no verifier evidence and no report file, and SHALL NOT fall back to a FAIL or absent report
