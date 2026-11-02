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

Each initial-design responsibility SHALL receive its actual preceding role output, existing materials and current machine diagnostics before transport dispatch. Notes SHALL NOT substitute for the required blueprint, questioning, decomposition or scope artifact. Initial design and design revision SHALL continue while current issues or actual work artifacts progress within original authority and any explicit user deadline. They MUST NOT use framework phase/round/wall quotas as task exits. Repeated identical current issues with comparable unchanged work SHALL pause through no_progress_guard; unknown baselines SHALL NOT prove no progress. Metadata-only changes SHALL NOT count as business progress. Time alone SHALL NOT wake the paused run; explicit continuation or a real condition change SHALL retain real activity and history. An explicit `--supersede` of the current original run SHALL reach the existing audited initial-design successor path through prepare and runtime entries, retaining original input and cumulative turns/active time; a superseded target SHALL rejoin its current successor rather than fork. Existing live-owner, unreported-request, adapter, authorization and explicit user-deadline/cancellation boundaries SHALL remain.

Child reports, including direct reports through the child entry, SHALL automatically return to the original P2 caller after formal completion. Re-entry SHALL locate real origin-bound runs and reread current completion/P2 facts, including birth-before-stdout and accepted-report-before-root-reassessment interruption windows; it MUST NOT repeat acceptance, create another active child or abandon the original request while applicable CUs remain unfinished. The original request endpoint SHALL use the shared current design/CU/component disposition. Required formal component closure SHALL be produced by the existing machine writer and reread/validated; all completed CUs or an eligible evaluation MUST NOT sign component completion. Identical completed re-entry SHALL return its current valid result without creating another initial-design run.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/utils/change-unit-completion.ts`, `harness/scripts/check-component-closure.ts`.

#### Scenario: Original stopped design recovers under current policy

- **WHEN** an old initial-design run stopped at its former local quota and current machine metadata can be repaired without a new author or questioning call
- **THEN** public next/resume SHALL reread and repair it, retain all prior turns and active time, and issue the next real responsibility within the remaining explicit user deadline, if supplied
- **AND** genuine design defects SHALL remain blocked and no new call SHALL start after the original hard limit

#### Scenario: Child birth survives a lost launcher response

- **WHEN** a normal CU child was born with the original delivery origin but the command exited before returning stdout
- **THEN** re-entry SHALL find and resume that child from its actual birth instead of starting another child or accepting the CU again

#### Scenario: All CU completions reach the request endpoint

- **WHEN** the current child formally completes and all applicable CU completion facts are valid
- **THEN** the original runtime SHALL reread P2, reach the original request endpoint and consume the required formal component closure through the existing writer and shared reader
- **AND** a component gap SHALL be disclosed with its unchanged result, without automatic P3 repair or claiming component closure PASS

### Requirement: Birth inputs retain explicit actions and stale candidates return to their original owner

A new initial-design root SHALL preserve only phase actions explicitly supplied by the original input. When no action list is supplied it MUST NOT inject coding or a default six-phase request. Existing start/end boundaries, actual workflow and explicit user constraints SHALL remain; boundaries MUST NOT manufacture explicit requested actions or remove real acceptance/device/visual duties.

After a design revision, a stale scope candidate for a selected CU without any born child or frozen scope SHALL return to the existing scope author with the real diagnosis and the existing `--prepare-scope --overwrite` command. The author SHALL regenerate the whole candidate using current authoritative input, and birth SHALL still use the same strict parser. A hash-only refresh or reusing stale impact/satisfaction claims MUST NOT replace regeneration. A born child or frozen scope SHALL retain existing rules; unstarted-child input correction and historical-root phase-field override migration are outside this change.

#### Scenario: Revised design invalidates an unfrozen candidate

- **WHEN** a design revision changes inputs bound by a CU's birth candidate and no child or frozen scope exists
- **THEN** the runtime SHALL return the complete current issue to the original scope author for full regeneration with the existing command and revalidate strictly before birth
- **AND** it SHALL NOT restart already-qualified design work or silently update only hashes

#### Scenario: No explicit phase actions were supplied

- **WHEN** the original input supplies no explicit requested phase actions for a new root
- **THEN** the root SHALL not insert the workflow's default six phases as explicit actions
- **AND** actual start/end boundaries, workflow, explicit user constraints and required acceptance duties SHALL retain their existing meaning

### Requirement: Managed design and CU segments preserve original inputs and real activity

Children and legal successors SHALL inherit original requirement/source, adapter/model/visual pins, fidelity, trusted authorization, actual tool grants and any explicit UTC user_deadline_at from the original request. CU synthetic text or fresh defaults MUST NOT replace these inputs. Historical budget is read-only; new/effective unattended MUST NOT impose framework turns, phase retries, default author timeouts or total-wall quotas. Unfinished continuation MUST NOT reset the user's actual deadline.

Existing lineage and delivery-origin readers SHALL preserve original identity and actual activity, deduplicate real calls and union active intervals without nested double counting. Activity SHALL remain statistics, not allowance or dispatch authority. Actual cancellation, native completion/idle protection, tool deadlines, owner/fencing and write boundaries remain in force.

#### Scenario: Design and successive CUs preserve an explicit deadline
- **WHEN** the original request explicitly supplied a UTC deadline and continues into another CU or successor
- **THEN** the unfinished request retains that exact deadline and original activity without manufacturing a new allowance or double counting intervals

#### Scenario: Old budget fields do not control new work
- **WHEN** an old manifest or user configuration contains framework quota fields
- **THEN** the new builder/effective invocation omits them while preserving historical readability and real user constraints

#### Scenario: Candidate progress outlives a former local quota
- **WHEN** real design acceptance continues improving without cancellation or an elapsed explicit deadline
- **THEN** current work continues with all machine issues and independent denials
- **AND** completed comparable acceptance without improvement pauses through the shared evaluation, while unknown baselines remain unknown
