# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Plan chapters accept a grounded not-applicable declaration only when the contract source is trustworthy

`data_model_typed`, `interface_signatures_complete` and `component_tree_per_page` SHALL accept a chapter that states it does not apply, provided the chapter is present and carries a declaration line with the author's grounds, and the corresponding `contracts.yaml` collection (`data_models`, `interfaces`, `components`) is empty. The judgement SHALL be made by one shared pure function consumed by all three checks — no per-check copy, no applicability ledger, no registry file, and no structure whose name would read as an exemption registry.

Trustworthiness of the source SHALL be a precondition written into that function, not assumed from upstream. All three SHALL hold: `featureSpec.contracts` is mounted; `contracts.yaml` parsed successfully (an unparseable root mounts nothing, so the two conditions merge); and `shape_issues` carries no entry for that collection. This last one matters because the loader normalizes a non-array truthy value such as `data_models: {}` into an empty array and only records `shape_issues`, so "the collection is empty" is otherwise indistinguishable from "the shape was written wrong". If any precondition fails, the function SHALL return no verdict and every existing judgement SHALL stand unchanged.

A true declaration SHALL record `SKIP` at the check's existing severity, with `details` naming both the criterion (the contracts collection and its length) and the author's stated grounds. A false declaration — the collection is non-empty — SHALL record `FAIL` at that same existing severity, name the contract entries it found, and carry a suggestion. Severities SHALL NOT be raised: `component_tree_per_page` stays MAJOR, so its false-declaration FAIL is a check failure and not a phase blocker, while the other two remain BLOCKER and do block the phase.

Chapter presence SHALL remain required by `required_chapters` — this exit is for "the chapter is there and honestly says the feature has none of these", never for a missing chapter. The judgement SHALL read only whether the contracts collection is empty; it SHALL NOT attempt to infer whether contracts itself under-declares, and SHALL NOT interpret the `components[].kind` field.

A confirmed not-applicable result SHALL be machine-readable, and the run summary's `blocking_skips` SHALL exclude it. A `SKIP` at BLOCKER severity otherwise means "the gate did not run", which routes the run to `review_blocking_skips_then_verifier` — mislabelling a confirmed non-applicable chapter as outstanding work and short-circuiting the disabled and verifier-FAIL branches of the next-action resolution. The marker SHALL NOT change the check's `status` or `severity`, so display, blocker aggregation and quality-axis counting stay exactly as they are today.

Enforcement: `harness/scripts/check-plan.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/harness-runner.ts`

#### Scenario: A grounded declaration on an empty collection records SKIP

- **WHEN** the chapter is present, states that it does not apply with grounds, `contracts.yaml` is mounted and parsed, the matching collection is empty, and no `shape_issues` names that collection
- **THEN** the check SHALL record `SKIP` at its existing severity with the criterion and the grounds in `details`, and SHALL NOT record FAIL

#### Scenario: A declaration contradicted by contracts still fails

- **WHEN** the chapter declares that it does not apply but the matching contracts collection has entries
- **THEN** the check SHALL record `FAIL` at its existing severity, name the entries found in contracts, and carry a suggestion to remove the declaration or fix `contracts.yaml`

#### Scenario: An untrustworthy contract source never accepts the declaration

- **WHEN** `contracts.yaml` is missing, or its root node is not a mapping, or `shape_issues` names that collection
- **THEN** the declaration SHALL NOT be accepted, no `SKIP` SHALL be produced, and the check SHALL fall back to its existing judgement; the shape deviation SHALL keep surfacing through `feature_spec_shape` on the runner path

#### Scenario: A confirmed not-applicable SKIP does not block the run

- **WHEN** a plan run records a confirmed not-applicable `SKIP` at BLOCKER severity and every other check passes
- **THEN** the summary's `blocking_skips` SHALL be empty and `next_action` SHALL NOT be `review_blocking_skips_then_verifier`; when the axis is off and a carried verifier FAIL exists, `next_action` SHALL still resolve to the verifier-fix branch
