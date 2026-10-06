## MODIFIED Requirements

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Actionable defects SHALL retain signal-level `item_fingerprint` and existing event-sourced cumulative attempted accounting. A requested candidate becomes attempted only after the target phase completes its owner repair attempt. A timed-out, transport/CLI/tool-interrupted or unknown-incomplete settlement MUST NOT count as that complete attempt merely because an exit code, agent_process_settled, phase_verdict or ordinary compile/static PASS exists. The same event-window predicate SHALL govern runtime completion, attempted replay, invalidation replay and continuation. Eligible current identities backtrack once through the existing route. If all still-open identities were attempted, the runner SHALL retain `repair_not_converging` as a bounded convergence terminal/fuse and list machine evidence; same-run manual resume MUST NOT clear attempted identities, reset the fingerprint, change the quality conclusion, or create eligibility. New machine evidence producing a new identity or a legitimate successor SHALL retain the existing convergence semantics; successor identity MUST NOT renew delivery-cycle turn or active-time budget. One-shot after a genuinely completed owner attempt and existing decline/rebuttal exemptions SHALL remain unchanged. A no-op owner repair SHALL not reuse downstream closures.

Enforcement: `harness/scripts/goal-phase-runtime.ts` (existing `agent_invoke_end` producer and repair replay), `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: manual resume cannot retry an attempted identity

- **WHEN** identity A remains open after its owner executed and the same run is manually resumed
- **THEN** A SHALL remain attempted and the convergence terminal SHALL remain unless new machine evidence changes the candidate set

#### Scenario: An interrupted settlement does not consume one-shot eligibility

- **WHEN** a signal repair request has no completed owner call or validated all-current decline and is followed by a timed-out settlement and fresh ordinary static PASS
- **THEN** the identity SHALL remain unattempted, the original repair window SHALL stay incomplete, and same-process or resume continuation SHALL deliver the original candidate without another product backtrack


### Requirement: Candidate round repetition requires unchanged comparable repair inputs

The repair-candidate `backtrack_to_phase` branch SHALL retain the existing item/round fingerprints and hard turn/active-time budgets. A repeated candidate round SHALL halt as `backtrack_fingerprint_repeat` only when the relevant repair/verification inputs have a complete comparable content snapshot and remain unchanged. Each candidate SHALL contribute its explicit repair targets or its existing contracts/owner source scope; a mixed group SHALL NOT discard an empty-files native candidate's owner scope because another candidate has explicit files. Evidence references and actual process outputs (trace/screenshots, phase notes/logs/reports at their configured or resolved runtime locations), mtime, HEAD and summary prose SHALL NOT count as repair progress, including actual process outputs nested inside a relevant directory. The same location predicate SHALL govern explicit targets and directory digests; product files that merely share these directory/file names SHALL count by content. The general artifact/directory snapshot consumers SHALL retain their existing defaults.

Before target construction and before emitting `phase_backtrack_requested`, the runtime SHALL collect the relevant inputs through the existing artifact/directory snapshot and retain them in the optional `related_input_snapshot` on that event. The original event SHALL be the shared baseline for same-process, resume and successor comparison; it SHALL NOT be recomputed from current content. The field SHALL NOT alter candidate identity, budgets or create another ledger. Current input keys SHALL match the original complete required set; additions/deletions, empty snapshots or entries without valid content hashes SHALL be unknown. Missing/bad entries or legacy records MAY use attestation/write observations only when the original input set and original window are established; current hashes or overwritten later attestations SHALL NOT replace the baseline.

Unknown inputs SHALL prove neither zero change nor a completed repair. After retirement of the fixed backtrack ceiling, unknown snapshots, legacy/provider candidates and scope replan without another applicable existing fuse SHALL be bounded only by remaining total turns and active time and MAY exhaust those resources; the system MUST NOT invent an extra convergence guarantee or retain a hidden fixed ceiling. Changed inputs SHALL permit another attempt within remaining original hard resources, while only fresh verification establishes success. Decline/rebuttal exemptions and all other fuse families SHALL retain their existing semantics.

#### Scenario: Same defect after a real source edit gets fresh verification

- **WHEN** testing produces the same candidate fingerprint after the relevant source content changed
- **THEN** the existing remaining hard turn/active-time budget SHALL allow the responsible phase and new verification
- **AND** a still-failing verification SHALL remain failure without added budget

#### Scenario: Notes and unrelated edits do not disguise a comparable repeated round

- **WHEN** only notes/logs/process outputs or unrelated source change and all required repair inputs remain unchanged
- **THEN** the candidate round SHALL halt as `backtrack_fingerprint_repeat`

#### Scenario: Recovery reads the original snapshot and preserves limits

- **WHEN** resume or a successor replays an earlier backtrack event
- **THEN** it SHALL compare with that event's original related input snapshot and inherit the original used budgets
- **AND** an exhausted turn/active-time budget SHALL still stop despite a new fingerprint or source edit

### Requirement: The runner has no dedicated P0-skip halt; P0 repair facts route through the candidate ladder

The goal runner SHALL NOT halt on P0 skips with a dedicated `await_human_p0_skip` branch, guidance, or failure kind, and the classifier SHALL NOT classify P0-skip blockers into a human-only family or the cumulative-halt family. The decision ladder SHALL be: safety/terminal conditions first (framework integrity, external prerequisites, operator interrupt, hard budgets); then trusted `repair_candidates` routed by assess to the responsible phase via the single `backtrack_to_phase` branch (reusing the existing hard turn/active-time budgets, round fingerprint fuse, invalidation transaction, and `backtrack_target_absent`); then capability-missing defer where supported by real external evidence; otherwise ordinary content/evidence retry and fuse semantics. Quality blockers SHALL NOT fall through to `await_human_gate_deferral`. Historical events carrying `halt_reason=await_human_p0_skip` remain interpretable for diagnostics only and SHALL never influence driver decisions. No new resume/supersede/supervisor behavior and no second driver; the c6 process-control contracts remain untouched.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: an unexecuted P0 explicit skip remains testing-owned

- **WHEN** testing fails with `p0_coverage_integrity` for an explicit skip that has no `StepResult`, no machine-proven capability absence, and no integrity/budget condition
- **THEN** the runner SHALL keep the finding testing-owned with zero automatic coding candidates; it SHALL NOT emit `phase_backtrack_requested(target=coding)`, `phase_halt(halt_reason=await_human_p0_skip)`, or a guessed WAITING/human quality disposition

#### Scenario: an executed assertion mismatch may backtrack to coding

- **WHEN** an executed testing case has an authoritative `StepResult` with `failure_kind=assertion` and `failure_code=assertion_mismatch` (and possibly visual candidates) in the summary, with no integrity/budget condition
- **THEN** the runner SHALL emit `phase_backtrack_requested(reason=repair_candidates, target=coding)` and SHALL NOT attribute that route to an explicit-only skip

#### Scenario: capability blockers defer without a quality signature

- **WHEN** a round has zero repair candidates and the remaining blocker is a machine-proven unavailable external capability
- **THEN** the runner SHALL use the existing capability/external defer path rather than a human quality gate

## ADDED Requirements

### Requirement: Interrupted repair work continues in its original event window

The canonical phase runtime SHALL derive pending repair work from the existing `phase_backtrack_requested` window, its original candidates/evidence_refs/related_input_snapshot, actual invocation completion and validated all-current decline facts. This SHALL cover native, delegated-provider, legacy-text and signal@1 candidates. Current invocation completion, window completion and independently verified defect resolution MUST remain distinct. When no owner call in the current window has completed and no all-current decline has been validated, a timeout, transport/tool/CLI termination or unknown interruption SHALL preserve incomplete owner work despite ordinary compile/static PASS. Same-process continuation and public resume SHALL retain the original window/candidates/baseline without another product-backtrack ordinal; actual invocations and active time SHALL still be charged.

The runtime's existing `agent_invoke_end` producer SHALL persist optional `completion_observed` alongside `terminal_failure_observed` before running the gate. The shared predicate SHALL read the end belonging to the exact current invoke_id, never another invocation of the same phase. Historical ends lacking the optional completion field SHALL first use `phase_verdict.completion_observed`/`agent_failed` from the identical invoke_id as completion/failure fallback. Only when that verdict is also absent and exit is non-zero without timeout or terminal failure SHALL the result be unknown; unknown SHALL rerun the owner only within the repair window and its existing recovery limits. A completion-observed end with non-zero cleanup followed by a gate crash SHALL retain validation-only eligibility and attempted accounting; timeout or turn.failed SHALL return to the owner without another product-backtrack request.

Window replay SHALL preserve an earlier complete owner invocation even when a later retry is interrupted; it MUST NOT loosen the exact current-invoke predicate or borrow completion across a new request/relevant invalidation. A historical interrupted settlement followed by false completed/static PASS SHALL be re-evaluated only in its latest unsealed active window. Trustworthy sealed completion and the delivery-cycle boundary algorithm MUST remain unchanged. Actual invocation completion settles the owner attempt; source-validated all-current declines retain the existing declined outlet. There SHALL be no independent target-proof exemption from execution. Existing no-op/one-shot rules and downstream independent verification SHALL remain; arbitrary source edits or generic PASS MUST NOT prove defect resolution. Unknown snapshots and actual interruption continuation SHALL retain their existing hard-resource and recovery bounds.

Enforcement: `harness/scripts/goal-phase-runtime.ts` (existing `agent_invoke_end` producer and canonical repair consumer), `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/repair-candidates.ts`

#### Scenario: Native repair interrupted before edits cannot advance on static PASS

- **WHEN** a native coding repair carries original case/step/trace evidence, no owner call in its window completed or all-current decline was validated, its invocation times out, and compile/static gates freshly PASS
- **THEN** no completed event or advance SHALL close the repair; original owner/candidates/evidence/snapshot SHALL remain available for bounded continuation, with one original product-backtrack request

#### Scenario: Resume does not skip an interrupted owner

- **WHEN** the latest repair window has no complete owner call or validated all-current decline and contains an interrupted settlement, including historical false completed/static PASS, in an unsealed run
- **THEN** resume SHALL return to the original owner and SHALL NOT select validation-only merely from that settlement or generic PASS

#### Scenario: A completion-observed non-zero cleanup before a gate crash retains validation-only recovery

- **WHEN** the owner completes with completion_observed persisted on its end, cleanup exits 1, and the process crashes before its gate verdict
- **THEN** the existing validation-only path SHALL revalidate the settled attempt without another owner invocation, and that complete attempt SHALL count normally as attempted

#### Scenario: A timeout or failed terminal before the gate returns to the owner

- **WHEN** the owner's end records timeout or turn.failed and the process crashes before gate verdict
- **THEN** resume SHALL return to the owner with original candidates/snapshot and SHALL NOT emit another product-backtrack request

#### Scenario: Historical completion and failure fallback belongs to the exact invoke

- **WHEN** an old end lacks completion_observed but the same invoke_id has a verdict with completion_observed or agent_failed
- **THEN** the shared predicate SHALL use that invocation's completion/failure facts and SHALL NOT borrow another invoke's success

#### Scenario: Historical unknown is bounded only inside its current repair window

- **WHEN** an old non-zero end has neither completion field nor matching verdict nor timeout/terminal-failure fact
- **THEN** the current repair window SHALL retain bounded owner continuation; outside a repair window this compatibility SHALL NOT create a new owner retry path

#### Scenario: Outside-window legacy settlement keeps validation-only compatibility

- **WHEN** an old non-timeout settled invoke outside the latest request target has exit 1 but no completion field or matching verdict
- **THEN** the existing gate-only resume path SHALL remain eligible without inventing successful invocation facts, and current machine gates SHALL still run

#### Scenario: A completed window survives a later retry interruption

- **WHEN** one owner call in the current window completes but its gate fails, a retry times out with a later valid advancing PASS, and downstream recovery resumes the run
- **THEN** window replay SHALL retain the earlier completion and SHALL NOT redundantly invoke that owner; a new request or related invalidation SHALL prevent borrowing the older fact

#### Scenario: A newer request replaces an older interrupted window

- **WHEN** a newer phase_backtrack_requested follows an earlier incomplete window
- **THEN** only the latest active window SHALL govern pending repair and the older window SHALL NOT permanently deny advance

#### Scenario: Cleanup failure after completion does not reopen finished work

- **WHEN** completion_observed or a valid normal terminal proves completion and process-tree cleanup returns non-zero
- **THEN** existing successful completion SHALL remain available and SHALL NOT be relabeled as unfinished repair

#### Scenario: Owner completion and current declines retain their existing outlets

- **WHEN** an actual owner call completes or all current candidates have source-validated current-round declines
- **THEN** the existing attempt-completion/declined outlet SHALL apply, with unchanged no-op/one-shot and independent verification rules
- **AND** a source edit followed by still-failing native/visual verification SHALL remain a real defect rather than a proven fix

### Requirement: Delivery-cycle resources bound repair without a fixed backtrack ceiling

The canonical runtime SHALL enforce max_total_turns and total active-time budgets across resume and audited successor lineage through foldBudgetLineage and partitionExecutionSessions. DEFAULT_MAX_BACKTRACKS=2 and legacy max_backtracks/backtrack_budget_remaining MUST NOT confer hard-stop authority. Legacy fidelity recovery, scope replan, owner write recovery, ordinary candidate repair and adjudication SHALL use the same resource policy. Backtrack request counts SHALL remain observable and usable for existing transaction ordinals; historical backtracks_limit SHALL be readable as provenance only. Existing related-input/defect no-progress checks, genuinely completed signal one-shot, decline/rebuttal limits, repeated write violations and bounded interruption recovery SHALL remain unchanged.

Same-task repair that the current run can own SHALL continue in that run. Correction/requirement prose, new run identity or model selection MUST NOT renew used resources or enlarge real authorization. Legitimate requirement and model changes SHALL retain the existing owner/birth route, and explicit budget changes SHALL retain the existing authorization boundary. The trustworthy completed delivery-cycle boundary algorithm SHALL remain unchanged.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/scope-replan.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: A third productive backtrack is not denied by an old constant

- **WHEN** a third repair/replan/legacy-fidelity/write-owner backtrack is otherwise authorized and has remaining hard resources without an existing convergence terminal
- **THEN** the responsible phase SHALL execute in the current run and observed backtrack count SHALL increase without a backtrack_limit halt

#### Scenario: Resource exhaustion still stops useful work

- **WHEN** turn or total active-time budget is exhausted despite source progress or new correction text
- **THEN** the existing hard-budget halt SHALL remain effective and a successor SHALL inherit used resources

#### Scenario: Comparable unchanged defects retain convergence protection

- **WHEN** an existing complete comparable repair-input snapshot is unchanged and the same defect round reappears
- **THEN** the existing no-progress/round fuse SHALL remain effective; unrelated edits or notes SHALL NOT buy progress

### Requirement: Public continuation re-evaluates legacy backtrack-limit-only stops

Current adjudication and public continuation SHALL narrowly re-evaluate a backtrack_limit-only run in the existing current-delivery-cycle unfinished, unclaimed set with original hard-resource headroom. Identity/scope/owner and all other entry preconditions SHALL still be checked at their existing entries; this change MUST NOT add a latest-item restriction. Ordinary repeated requests, explicit resume including foreground/detach, attended prepare-run and supervisor continuation SHALL consume that shared eligibility. Historical events/candidate/decline ledgers/input baselines/resource use SHALL remain preserved; reducers MUST NOT add a competing halt classification table.

Progress/report SHALL display observed backtrack counts rather than a hard Budget x/2; current progress/supervisor consumption and historical report diagnostics SHALL retain their existing roles without a new display protocol or laundering resource use. This compatibility SHALL NOT introduce a special validation-only optimization for legacy backtrack-limit stops.

This compatibility SHALL NOT override trustworthy sealed/superseded runs, current owner/liveness fencing, testing write violation, real authorization, turn/active-time exhaustion or a distinct current no-progress/one-shot/terminal reason. Mixed stops or a later different terminal SHALL retain that actual boundary. Acceptance re-enters the canonical runtime to revalidate current conditions rather than declaring product PASS.

Enforcement: `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-supervisor.ts`

#### Scenario: All public entry paths reach current-policy revalidation

- **WHEN** an unsealed backtrack_limit-only run belongs to the current unfinished/unclaimed set, has original resource headroom, and satisfies the other entry preconditions
- **THEN** ordinary re-request, explicit resume, attended prepare-run and supervisor continuation SHALL reach the same original-run revalidation without requirement-increment prose or rewriting events

#### Scenario: A different terminal is not waived

- **WHEN** that history also has current hard-budget exhaustion, testing write violation, sealed completion, owner conflict or distinct no-progress/one-shot terminal
- **THEN** compatibility SHALL retain the actual boundary and SHALL NOT reset any resource or repair ledger
