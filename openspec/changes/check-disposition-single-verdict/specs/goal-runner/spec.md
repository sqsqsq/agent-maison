## ADDED Requirements

### Requirement: Result-basis and aggregate-only failures are deterministic gate failures

Attribution, affected-file extraction and the responsible owner SHALL consume one effective mapping: a check registered in the disposition table as `result_basis` reads the table, every other check reads the existing deterministic-gate id table and ownership registry, and neither table requires duplicate registration. A round whose blockers include a registered `result_basis` check, or a check in the deterministic-gate id table (which now includes `authoritative_content_aligned`), SHALL be classified `deterministic_gate_or_artifact_missing`, not `code_regression`, and its retry prompt SHALL carry the missing-artifact/gate guidance without the instruction to revert earlier changes. A round whose blockers are all aggregate run-status checks (`coding_run_status`, `testing_run_status`) — which after aggregate de-duplication remain listed only when no source blocker exists — SHALL be classified the same way, so its signature is non-empty and the no-progress guard still applies. Ledger-shape failures the disposition function discloses are not blockers and SHALL NOT take part in attribution. Both rules SHALL stay below the existing higher-priority attributions, in their existing order: agent-level signals (operator interrupt, timeout, API error, no output, harness failure without a fresh summary, stale summary), then a closure-finalization failure, a current integrity blocker, a deferrable external blocker, and any framework-class blocker (`framework_bug`, even when content blockers are mixed in) are decided first.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/check-disposition.ts`

#### Scenario: An authoritative-content drift is not a code regression

- **WHEN** a spec or plan round fails only on `authoritative_content_aligned`
- **THEN** the attempt SHALL be classified `deterministic_gate_or_artifact_missing`, SHALL produce no backtrack candidate, and the retry prompt SHALL NOT tell the agent to revert changes made since the run started

#### Scenario: An aggregate caused only by a skipped gate halts on repeat

- **WHEN** a testing round fails only through `testing_run_status` because a blocking gate was skipped, and the next round repeats the same signature with no artifact change
- **THEN** both rounds SHALL be classified `deterministic_gate_or_artifact_missing` with signature `testing_run_status`, and the no-progress guard SHALL halt on the repeat

### Requirement: Failures owned by the design owner stop on first occurrence

A failed blocking check whose owner is outside the feature phase chain SHALL carry the existing field `repair_owner: 'external'` without a `blocking_class`: `authoritative_content_aligned` when the design-authority projection itself is invalid, and the Change Unit construction-projection checks routed `reconcile_blueprint` (for example `cu_scope_matches_blueprint`). The goal runtime SHALL stop the run on the first round that fails with such a blocker, using the existing halt reason `execution_scope_unresolved` and its existing disposition, instead of retrying the current phase until the no-progress guard trips. The halt event SHALL state that the design owner is responsible, carry an excerpt of each such blocker's details (the summary keeps at most 800 characters per blocker and the guidance line is further shortened), and say what to do next: repair the blueprint or Change Unit through `/component-design`, bump the Change Unit pointer through design-handoff readiness, then re-issue the same request. The check's verdict logic SHALL NOT change; a handwritten artifact that merely drifts from a valid authority SHALL NOT carry the field and SHALL keep being repaired and retried by the current phase. External blockers that carry a `blocking_class` (device toolchain and the like) SHALL keep their existing routes.

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: An invalid design authority hands off to the design owner at once

- **WHEN** a successor's spec round fails on `authoritative_content_aligned` because the blueprint's acceptance projection is invalid
- **THEN** the spec agent SHALL have been invoked once, the run SHALL halt with `execution_scope_unresolved`, and the halt guidance SHALL name the design owner, the invalid-authority detail and the next step

#### Scenario: A drifting handwritten acceptance is still repaired in place

- **WHEN** the spec round fails on `authoritative_content_aligned` because the handwritten acceptance differs from a valid authority
- **THEN** the spec phase SHALL be retried and, with no change between rounds, the run SHALL halt with `no_progress_guard`

## MODIFIED Requirements

### Requirement: Timeout attribution follows the freshness decision table

For a timed-out attempt the classifier SHALL apply, in order: stale summary → `agent_timeout`; fresh summary containing any integrity blocker → `framework_integrity_block`; fresh summary with a non-empty blocker set consisting entirely of `framework_bug` → `framework_bug`; otherwise (mixed or content-only) → `agent_timeout`. The all-framework_bug branch SHALL require `blockers.length > 0`. It SHALL judge the facts as they were before aggregate de-duplication: a failing aggregate run-status check recorded in `run_statuses` but removed from the blocker list because its source failure is listed SHALL still count as one non-framework blocker, so a timed-out round with a single `framework_bug` source failure and its aggregate stays `agent_timeout`. The blocker list and signature themselves SHALL remain de-duplicated.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Fresh integrity evidence is not masked by timeout

- **WHEN** an attempt is tree-killed at its timeout budget and the post-kill harness summary (stale_summary=false) contains a current integrity blocker (`node_options_injection`, classification `process_injection`)
- **THEN** classification SHALL be `framework_integrity_block` (halt) rather than `agent_timeout` (free retry)

#### Scenario: A de-duplicated aggregate keeps a timed-out round continuing

- **WHEN** an attempt times out, the summary is fresh, its only listed blocker is a checker crash attributed `framework_bug`, and `run_statuses` records the failing aggregate that listed it
- **THEN** classification SHALL be `agent_timeout`, as it was before de-duplication, while a timed-out round with the same crash and no aggregate SHALL still be `framework_bug`
