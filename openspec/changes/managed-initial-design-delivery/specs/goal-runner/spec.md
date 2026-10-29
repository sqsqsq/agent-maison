## MODIFIED Requirements

### Requirement: Fresh delivery uses the existing design handoff

Fresh launcher and runtime birth SHALL share the managed initial-design decision specified in `complex-capability-meta-model`. Raw detach without feature.yaml SHALL enter the same runtime rather than end after printing preparation steps. The initial-design manifest variant SHALL use the existing run directory/events/control contract and immutable blueprint workspace key without construction scope, baseline or synthetic Feature phase chain. Normal Feature/CU birth requirements MUST remain unchanged. Prepare-scope SHALL NOT write a flat construction candidate for a nonexistent CU. Valid continuation/frozen scopes, canonical CU identity, generic profiles and single-duty endpoints SHALL retain their original entry; initial-design errors SHALL use existing disposition/recovery rather than add a halt reason.

Enforcement: `harness/scripts/utils/design-delivery-entry.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-runner.ts`.

#### Scenario: Fresh complete delivery starts before design admission

- **WHEN** a fresh manifest-only launch requests formal complete spec/plan delivery with no canonical CU or valid prior task
- **THEN** launcher and runtime SHALL create/attach the managed initial-design variant from the effective original inputs and continue its real work
- **AND** they MUST NOT claim background RUNNING without the existing startup handshake

## ADDED Requirements

### Requirement: Initial design and CU delivery share recoverable original request continuity

The runtime SHALL reuse existing design author/questioning/check/publication and P2 progress calls, then create normal canonical CU runs with immutable optional `delivery_origin: {feature, run_id}` bound by their original run birth and identity. Normal child birth plus that origin SHALL be the sole handoff fact; no parallel handoff event, active-child file or request ledger SHALL be introduced. Old runs without the key SHALL retain existing identity semantics. Original design and child construction author windows MUST NOT overlap; each control/report SHALL use the real current run and fence.

Each initial-design responsibility SHALL receive its actual preceding role output, existing materials and current machine diagnostics before transport dispatch. Notes SHALL NOT substitute for the required blueprint, questioning, decomposition or scope artifact. Normal incomplete content SHALL remain within the existing role quota. An exhausted run SHALL NOT reset that quota through resume, force-resume or repeated next/report. An explicit `--supersede` of the current original run SHALL reach the existing audited initial-design successor path through prepare and runtime entries, retaining original input and cumulative turns/active time; a superseded target SHALL rejoin its current successor rather than fork. Existing live-owner, unreported-request, adapter, authorization and total-budget boundaries SHALL remain.

Child reports, including direct reports through the child entry, SHALL automatically return to the original P2 caller after formal completion. Re-entry SHALL locate real origin-bound runs and reread current completion/P2 facts, including birth-before-stdout and accepted-report-before-root-reassessment interruption windows; it MUST NOT repeat acceptance, create another active child or abandon the original request while applicable CUs remain unfinished. All applicable CU formal completion/carry-forward SHALL establish the original request's endpoint. Existing component closure SHALL then be checked once read-only and disclosed without automatic repair, write, closure or verdict changes. Request completion MUST NOT establish component closure PASS or relax existing Feature/CU/UT acceptance. A completed original request SHALL return its reread valid result on identical re-entry rather than create a new initial-design run.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/utils/change-unit-completion.ts`, `harness/scripts/check-component-closure.ts`.

#### Scenario: Explicit recovery after initial-design content exhaustion

- **WHEN** initial design exhausted its role quota with only notes and the same original request explicitly supersedes the current stopped run
- **THEN** the audited successor SHALL consume the real old role output and notes, retain all prior turns and active time, and continue real author/questioning/admission/CU handoff within the remaining budget
- **AND** plain re-entry SHALL retain exhaustion, pending old execution SHALL refuse successor birth, and a stale supersede target SHALL rejoin the current successor

#### Scenario: Child birth survives a lost launcher response

- **WHEN** a normal CU child was born with the original delivery origin but the command exited before returning stdout
- **THEN** re-entry SHALL find and resume that child from its actual birth instead of starting another child or accepting the CU again

#### Scenario: All CU completions reach the request endpoint

- **WHEN** the current child formally completes and all applicable CU completion facts are valid
- **THEN** the original runtime SHALL reread P2, reach the original request endpoint and perform one existing read-only component-closure check
- **AND** a component gap SHALL be disclosed with its unchanged result, without automatic P3 repair or claiming component closure PASS

### Requirement: Birth inputs retain explicit actions and stale candidates return to their original owner

A new initial-design root SHALL preserve only phase actions explicitly supplied by the original input. When no action list is supplied it MUST NOT inject coding or a default six-phase request. Existing start/end boundaries, actual workflow and budget semantics SHALL remain; boundaries MUST NOT manufacture explicit requested actions or remove real acceptance/device/visual duties.

After a design revision, a stale scope candidate for a selected CU without any born child or frozen scope SHALL return to the existing scope author with the real diagnosis and the existing `--prepare-scope --overwrite` command. The author SHALL regenerate the whole candidate using current authoritative input, and birth SHALL still use the same strict parser. A hash-only refresh or reusing stale impact/satisfaction claims MUST NOT replace regeneration. A born child or frozen scope SHALL retain existing rules; unstarted-child input correction and historical-root phase-field override migration are outside this change.

#### Scenario: Revised design invalidates an unfrozen candidate

- **WHEN** a design revision changes inputs bound by a CU's birth candidate and no child or frozen scope exists
- **THEN** the runtime SHALL return the complete current issue to the original scope author for full regeneration with the existing command and revalidate strictly before birth
- **AND** it SHALL NOT restart already-qualified design work or silently update only hashes

#### Scenario: No explicit phase actions were supplied

- **WHEN** the original input supplies no explicit requested phase actions for a new root
- **THEN** the root SHALL not insert the workflow's default six phases as explicit actions
- **AND** actual start/end boundaries, workflow, budget and required acceptance duties SHALL retain their existing meaning

### Requirement: Managed design and CU segments use one effective budget and original input source

Children and their legal successors SHALL inherit the original requirement/source, adapter, model/visual pins, fidelity, timeout policy and applicable endpoint restrictions from the original request fields, not CU-generated requirement text or fresh defaults. CU impact inputs SHALL derive from each CU's actual authorized facts. The existing effective-budget resolver SHALL locate the original request birth and authorized budget adjustments; the child birth snapshot SHALL NOT grant independent budget authority. An authorized root override SHALL affect current/future children without changing child birth identity or resetting consumed resources; direct child budget edits MUST NOT increase the request limit.

Existing lineage readers SHALL include origin-bound segments and their legal successor lineage, deduplicate by `(feature, run_id)` and actual invocation identity, and count author/questioning/repair/construction calls using the existing rules. Active wall-clock SHALL be parsed per real run then unioned as execution intervals, including actual handoff/reassessment work, without nested root/child double counting; original waiting and conservative recovery semantics SHALL remain. Admission, phase deadline, status/monitor, supervisor and final cost SHALL consume the same effective policy. Necessary new calls at the hard limit MUST be refused; legal machine-only finalization SHALL retain the existing rule. No duration/turns ledger or implicit extra allowance SHALL be added.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-progress.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-supervisor.ts`, `harness/scripts/goal-status.ts`, `harness/scripts/goal-monitor.ts`.

#### Scenario: Design and successive CUs cannot reset the request budget

- **WHEN** design, questioning and a completed CU consumed part of a request whose original limit differs from fresh defaults
- **THEN** the next CU SHALL inherit the original current effective policy and all prior consumption, with no default-limit replacement or nested wall-clock charge

#### Scenario: Only an authorized original budget adjustment changes the limit

- **WHEN** the original request accepts a legal budget override while a child exists
- **THEN** current and future child execution SHALL use that value and existing accumulated consumption
- **AND** changing only the child budget SHALL NOT increase the original request allowance
