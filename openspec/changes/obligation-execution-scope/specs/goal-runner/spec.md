## ADDED Requirements

### Requirement: Execution scope is bound at real Goal birth

Fresh scoped runs SHALL consume the Feature candidate once and freeze execution_scope with phase_chain and the existing run_created identity. Resume/attach SHALL validate birth and ignore candidate/track changes; damaged new scope SHALL NOT become legacy absence. Feature completion SHALL validate this independent scope, all required duties, actual closure and reused evidence identities. request-only results and unresolved scopes SHALL NOT receive Feature completion.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`.

#### Scenario: Interactive scoped implementation has genuine completion lineage
- **WHEN** prepare CLI and attended bridge execute coding/review/ut through the canonical runtime
- **THEN** real run_created, phase_start, attempts and run_end SHALL support VALID completion and CU consumption without spec/plan/testing execution

#### Scenario: Completion narrows its own chain
- **WHEN** a completion claims UT only while the birth scope also requires coding and review
- **THEN** verification SHALL reject the claim even if its projection hash is self-consistent

### Requirement: Scope revisions are appended inside the same run

At a real phase boundary, sourced new facts MAY propose scope_revision_input through the existing checker report. runtime SHALL validate the proposal against the current effective scope and append exactly one `scope_revised` record to the same run's events, then SHALL continue dispatching in that same run. runtime SHALL NOT seal the run, release owner/Feature locks, or create a successor for a legal revision. Request boundaries and required duties SHALL be preserved: a revision MUST NOT delete or downgrade a required obligation, while unknown → required/not_applicable, not_applicable → required, added duties, added `satisfied_by` and withdrawal of invalidated `satisfied_by` are legal.

The effective scope SHALL be the birth scope plus every `scope_revised` applied in `revision_index` order. manifest.execution_scope, manifest.phase_chain and the run_created identity binding SHALL keep their birth values; every runtime consumer SHALL read the effective scope. A broken revision chain (index gap or duplicate, `previous_scope_fingerprint` not chaining to the birth fingerprint or to the prior entry, or content failing validation) SHALL be treated as corruption and recovered through existing mechanisms, and SHALL NOT silently fall back to the birth scope.

Re-entry SHALL NOT apply a revision twice: runtime SHALL deduplicate by the revision input fingerprint, and a proposal that resolves to the scope already in force SHALL be a no-op rather than an error. A revision that does change the scope SHALL be driven by a new sourced fact — either a basis binding the frozen scope does not already carry, or the verified closure evidence of a phase that just executed in this run.

A phase whose reuse a revision revokes SHALL actually run again, including after an interruption. The revoked set SHALL be DERIVED from the revision record itself — the obligations that carried phase-closure evidence before it and carry none after — so one appended event is complete on its own and no interrupt can leave the new scope readable while the revocation is not. A duty SHALL count as revoked only when it is left with no phase evidence at all; withdrawing one of several proofs while another remains does not send its phase back. Recovery SHALL drop the pre-revision result for those phases, using the same terminal-outcome condition the events rebuild uses (a PASS still pending closure is not a re-validation), and EVERY recovery reader — invalidation filtering, validation-only eligibility and closure-only retry — SHALL consume the same projected stream, so a revoked phase cannot be resumed past its agent. Explicitly requested phases keep their request-marker duty `required` across revisions.

The new sourced fact a revision stands on SHALL come from this run: a basis binding the frozen scope does not carry, or phase-closure evidence this run produced. A historical run's evidence SHALL NOT qualify. An impact judgement SHALL be inherited only when the field is absent; an explicitly null or malformed judgement SHALL be rejected. Execution history SHALL remain in events; the outcome projection SHALL remain the current effective result per phase, so a phase re-entering the chain after a revision SHALL be judged by its latest result.

A 1.2 completion record SHALL carry `scope_revision_count` as a non-negative integer; a missing field SHALL be INVALID rather than read as zero.

`run_base_sha` is a birth identity field with a write-once defence and SHALL NOT be back-filled into the manifest. When a run born without it first acquires a coding- or ut-bearing effective chain, the first such `scope_revised` SHALL carry the baseline, and only that one; every baseline reader SHALL resolve "birth value, or the single revision that froze it".

No mtime selection, force takeover, new ledger, new registry, lease or extra run-state directory SHALL be introduced.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/execution-scope.ts`.

#### Scenario: Spec reveals a device obligation
- **WHEN** spec produces new device acceptance and its scoped slice closes
- **THEN** the run SHALL append one `scope_revised` and keep executing the revised chain in the same run, producing no second `run_created` and leaving manifest.execution_scope byte-identical

#### Scenario: Revision is interrupted
- **WHEN** execution stops immediately after the revision is appended, or before the revision is validated
- **THEN** re-entry SHALL converge on exactly one revision and dispatch the next phase once, without repeating the source investigation

#### Scenario: Coding discovers a design gap
- **WHEN** coding reports a sourced new design decision and remains failed
- **THEN** the same run SHALL revise to return to the design owner before implementation, the failure record SHALL remain in events, and the run SHALL NOT be sealed as successful at the time of the revision

#### Scenario: Baseline is frozen by the first coding-bearing revision
- **WHEN** a run born with an investigation-only chain is revised into a chain containing coding or ut
- **THEN** that revision SHALL carry `run_base_sha` once, later revisions SHALL NOT carry or rewrite it, and diff baselines SHALL resolve consistently from it
