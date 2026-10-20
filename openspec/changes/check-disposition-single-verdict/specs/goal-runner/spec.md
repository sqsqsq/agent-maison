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

### Requirement: Unattended original-scope design and architecture repair uses the existing owner chain

For an unattended original-scope task the runtime SHALL dispatch the design owner before retrying an incapable downstream stage. B1/B2 labels and the legacy personal opt-in SHALL NOT replace task authorization. Design/CU changes and all existing architecture_impact variants SHALL use drafts, isolated questioning, existing validation and writers, and re-evaluation. The current caller MAY lend its existing locks to the CU content consumer; unrelated live runs SHALL remain busy. Runtime publication SHALL preserve identity and unrelated configuration, and source/verification changes SHALL NOT reset accumulated budget.

If bindings remain valid, the same run SHALL continue; otherwise the existing continuation decision SHALL automatically select the successor, without an outer Agent or a human re-issuing the request. New effective input SHALL be distinguished from unchanged repeated failure using existing events and bounded recovery. Missing facts SHALL NOT be fabricated. Changes to original requirements or substantive acceptance, explicit prohibitions, secrets, irreversible external actions and user budget limits retain their real authority boundaries. Attended behavior remains unchanged.

#### Scenario: A CU lacks a required selection reference
- **WHEN** a design-owned failure occurs during an authorized unattended task
- **THEN** the runner SHALL obtain a revised design/CU through the original consumer, validate and rebind it, and continue construction without asking the outer Agent to edit files

#### Scenario: A genuine authority boundary remains
- **WHEN** the repair would change the original product requirement or violate an explicit restriction
- **THEN** the request SHALL remain incomplete and report the concrete decision needed, without publishing a fabricated authorization

#### Scenario: A repair changes architecture permission
- **WHEN** a necessary original-scope dependency or module decision requires a new DSL value
- **THEN** the design owner SHALL provide the decision and candidate DSL, the existing init writer SHALL publish the validated configuration before construction, and questioning SHALL inspect the original request and both candidates

Enforcement: `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/init-task-executor.ts`, `harness/scripts/goal-phase-runtime.ts`
