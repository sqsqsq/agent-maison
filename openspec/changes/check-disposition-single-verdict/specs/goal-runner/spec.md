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

### Requirement: Failures owned by the design owner are reconciled in the run or stop on first occurrence

A failed blocking check whose owner is outside the feature phase chain SHALL carry the existing field `repair_owner: 'external'` without a `blocking_class`, together with `structured: { kind: 'design_authority', reason, codes }` taken from the issue codes of the existing validators (never parsed from detail text): `authoritative_content_aligned` when the design-authority projection itself is invalid, and the Change Unit construction-projection checks routed `reconcile_blueprint` (for example `cu_scope_matches_blueprint`). The check's verdict logic SHALL NOT change; a handwritten artifact that merely drifts from a valid authority SHALL NOT carry the field and SHALL keep being repaired and retried by the current phase. External blockers that carry a `blocking_class` (device toolchain and the like) SHALL keep their existing routes.

When a round fails with such a blocker, the goal runtime SHALL first ask whether the run's Change Unit is a pointer-reconciliation candidate: its canonical validation has exactly one kind of blocker, the blueprint having moved to a higher admitted revision (`change_unit_blueprint_ref_stale`). If it is, and the phase still has content-retry budget, the runtime SHALL call the single in-place pointer writer under its two locks (lending the feature lock the run already holds), as specified in `change-unit-continuous-progression`. If the run's own Change Unit was bumped or already carries the current identity, the current phase SHALL be re-evaluated in the same run and the round SHALL count against the phase's content-retry budget. Whenever the runtime attempts this reconciliation it SHALL emit one record-only event `design_authority_repair` (`action: 'pointer_reconcile'`, `outcome: 'reconciled' | 'not_reconciled'`, `blueprint_id`, `bumped`, `skipped`, `reason`); the event SHALL NOT take part in any verdict.

In every other case — not a candidate, content-retry budget exhausted, the run's own Change Unit skipped by the writer, the writer exiting on lock contention, or the writer failing — the runtime SHALL stop the run on that first round, using the existing halt reason `execution_scope_unresolved` and its existing disposition, instead of retrying the current phase until the no-progress guard trips. The one exception is an unattended `B1` halt under pre-authorization, which first takes the single repair attempt specified in the next requirement and falls back to this halt when that attempt does not let the run continue. The halt SHALL:

- state that the design owner is responsible, carry an excerpt of each such blocker's details (the summary keeps at most 800 characters per blocker and the guidance line is further shortened), and, when a reconciliation was attempted, the writer's reason (a skip reason, or that another executor is writing and the same request can simply be re-issued once the contention clears, with no design change needed);
- carry `design_authority: { class, items[] }` on the halt event: each item names the check, its issue codes, its class, the design artifact to repair, the basis and what is missing, and — when the finding resolves to a blueprint target — its `locations` (target and field). The class SHALL come from one table keyed by issue code. `B1` means the repair is within existing authorization with an unambiguous basis; exactly two codes are `B1` (`authority_content_not_machine_structure`, `authority_cu_mapping_stale`). Every other code, an unregistered code, an empty code set, and any mix of `B1` and `B2` SHALL be `B2` (a new product choice, a wider scope, or a missing fact is needed). The halt as a whole is `B1` only when every item is `B1`;
- carry `probe: 'design_authority_projectable'` on the halt event, and `probe` / `probe_phase` on `run_end` as for other probed halts. The probe SHALL be read-only: it re-runs the halted phase's design-authority gate through the production input-resolution path without the run's frozen expected bindings, and is ready only when every design-owner blocker recorded on the halt no longer blocks; a gate that cannot be re-evaluated SHALL be not ready. Ready only means a retry is worthwhile;
- park at once without an in-process wait, so that the run's feature lock is released: the repair goes through design-handoff readiness, whose pointer writer needs that lock;
- say what to do next: repair the blueprint or Change Unit through `/component-design`, bump the Change Unit pointer through design-handoff readiness, then re-issue the same request, which continues without flags (the same run while its frozen bindings are still valid, a successor otherwise, as specified in `task-continuation-recovery-loop`).

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/change-unit-path.ts`, `harness/scripts/utils/condition-wait.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: An invalid design authority hands off to the design owner at once

- **WHEN** a successor's spec round fails on `authoritative_content_aligned` because the blueprint's acceptance projection is invalid
- **THEN** the spec agent SHALL have been invoked once, the run SHALL halt with `execution_scope_unresolved`, the halt guidance SHALL name the design owner, the invalid-authority detail, the class and the next step, the halt event SHALL carry `probe: 'design_authority_projectable'` and the repair brief, and the feature lock SHALL be free once the run has ended

#### Scenario: A stale blueprint pointer is reconciled inside the run

- **WHEN** the blueprint moves to a higher admitted revision after the run was born, and the plan round fails only because the run's Change Unit still points at the old revision
- **THEN** the runtime SHALL bump the pointer in place, emit `design_authority_repair` with `outcome: 'reconciled'`, re-evaluate plan in the same run with one more round, and SHALL NOT halt or create another run

#### Scenario: A reconciliation that does not fix the run's own unit falls back to the halt

- **WHEN** the writer skips the run's own Change Unit, or exits because another executor holds a lock
- **THEN** the run SHALL halt with `execution_scope_unresolved`, the guidance SHALL carry the writer's reason, and `design_authority_repair` SHALL record `outcome: 'not_reconciled'`; a sibling Change Unit being skipped SHALL NOT halt the run

#### Scenario: Text written where machine content is required is class B1

- **WHEN** the blueprint carries a non-empty text where machine-structured content is required
- **THEN** the halt SHALL be class `B1`; the same place holding `null`, a number or an empty string SHALL be class `B2`

#### Scenario: The probe stays not ready while any recorded blocker remains

- **WHEN** the halt recorded two design-owner blockers and only one of them has been repaired, or the gate cannot be re-evaluated from the current inputs
- **THEN** the probe SHALL report not ready and SHALL leave the blueprint, the Change Unit and the run's events unchanged

#### Scenario: A drifting handwritten acceptance is still repaired in place

- **WHEN** the spec round fails on `authoritative_content_aligned` because the handwritten acceptance differs from a valid authority
- **THEN** the spec phase SHALL be retried and, with no change between rounds, the run SHALL halt with `no_progress_guard`

### Requirement: An unattended B1 halt is repaired once by the framework under pre-authorization

The dispatch point SHALL sit after the in-run pointer reconciliation and before the design-owner halt, and SHALL be considered only when the round failed with a fresh summary, outside dry-run, with design-owner blockers present and content-retry budget left for the phase. The runtime SHALL dispatch only when all four prerequisites hold: the run is unattended (its owner kind is `process`); the halt's repair brief is class `B1` as a whole; the personal setting `design_repair.unattended_b1` is boolean `true` (specified in `framework-local-config`); and the halt signature has no `attempted` record. Otherwise it SHALL NOT dispatch and SHALL halt as in the previous requirement.

The halt signature SHALL be a hash of the feature, the halted phase, and the sorted check ids with their sorted issue codes of the design-owner blockers; it SHALL NOT include the run id, a time, or draft content, so a resume or a successor cannot reset it. The runtime SHALL look for `design_authority_repair` events with `action: 'content_repair'`, `stage: 'attempted'` and the same signature in the run's own events and in the ancestor events a successor replays; one found means the attempt is spent. No separate ledger SHALL be kept.

The attempt SHALL take the two locks of `change-unit-continuous-progression` — the blueprint lock and the feature lock of every canonical Change Unit under the blueprint, lending the feature lock the run holds — before reading the repair baseline, and SHALL hold them until the post-publish reconciliation is done. When a lock cannot be taken it SHALL NOT dispatch, SHALL NOT write `attempted`, SHALL NOT consume the signature's chance, and SHALL halt with the contention stated in the guidance; two runs contending at once may both park and need one re-issue. Under the locks the runtime SHALL write `attempted` before any adapter call (a failed write aborts the attempt), then run the revision procedure of `app-component-blueprint`: a draft copy of the blueprint file under the run directory, an authoring call, a check for writes outside the draft, a check that the draft changed only the locations the halt's `B1` findings point to (each brief item carries `locations`; content outside them other than the runtime-overwritten `revision`, the five registered root `provenance` keys and `derived_results` fails the attempt at step `author_scope` with the paths listed — the draft is discarded, nothing is published, and the run takes the design-owner halt, not the violation exit, because nothing outside the draft was written), runtime invalidation of the old questioning and registration of the revision, an isolated questioning call, machine-derived admission, real validation, publication, reconciliation in the same locks, release, and the same probe as the design-owner halt with this round's blockers passed explicitly.

Both calls SHALL be direct adapter calls outside the phase chain, under the run's adapter and pinned model. They SHALL be counted through the existing `agent_invoke_start` / `agent_invoke_end` events, whose `phase` is a purpose label outside the chain (`design-repair-author`, `design-repair-questioning`) together with `chain_phase` and `purpose`; one is counted for each call actually started, the live counter and replay stay in step, and stall detection SHALL ignore invoke-end events that carry a purpose. Before each call the remaining call count and wall clock SHALL be checked; when either is short the call SHALL NOT start and the attempt fails. The whole attempt SHALL count as one content-retry round of the phase and SHALL NOT reset any budget.

Writes outside the draft SHALL be checked by the existing pre- and post-call write-attribution snapshots over the project's top-level entries (dependency, cache and build directories excluded by the snapshot's existing rules). The blueprint's workspace — the canonical blueprint, every Change Unit, and the manifest, run-control and other records of every run under it (this run, its ancestors and the runs of sibling Change Units) — SHALL be checked in full, without the generic exclusion of runtime directories; the only exclusions SHALL be the paths the runtime itself writes during the call: the draft, the two calls' log directories, the run's `progress.json` / `progress.md` and liveness beacon, the run's feature lock, and the event files checked below. Every file a `source_ref` of the blueprint resolves to inside the project (the same collection the design-authority projection reads) SHALL be checked individually even when it lies in a directory the generic rule skips (such as `context/` or `reports/`): the authoring call against the baseline blueprint's references, the questioning call against the union of the baseline's and the draft's. Outside the workspace, other runs' runtime output SHALL stay excluded by the generic rule.

Every run's `events.jsonl` under the workspace that exists when the call starts SHALL be checked against an expected value instead of the snapshot: the bytes recorded before the call followed by the lines the runtime itself wrote to that file through its single event emitter during the call, in their original order; a file the runtime did not write to SHALL equal its bytes before the call. Any difference is a change, and the runtime SHALL write the whole file back to its expected value, so that session segmentation, attempt detection and budget replay read as if it had not been touched. This repair of the runtime's own records is the only restoration; project files SHALL NOT be restored by the framework.

A snapshot that cannot be verified before the call SHALL fail the attempt. Any detected change outside the draft SHALL be a violation, and so SHALL two cases where changes cannot be ruled out: a post-call snapshot that cannot be verified, and an authoring call that made the blueprint reference a file that was not checked before the call (a legitimate new reference of that kind is rejected too). In every violation the runtime SHALL NOT publish and SHALL stop with the existing halt reason `backtrack_target_absent`, `owner_phase: null` and no probe, because an out-of-chain call has no responsible phase to backtrack to. Only when concrete changes were detected SHALL it emit `phase_write_violation` (purpose label as `phase`, `violation: 'outside_design_repair_draft'`, paths with pre/post hashes); for a case that cannot be verified, the failure reason and the halt event are the record, and no path or hash list is promised.

When a call's child process cannot be bound to containment and is not proven gone, the call SHALL be handled as a phase call is: no `agent_invoke_end` or settled record is written (left to recovery reconciliation), neither the snapshot nor the event files are checked, nothing is published, the second call SHALL NOT start, and the run SHALL stop with the existing halt reason `agent_containment_unresolved` through its existing disposition, without the design probe. A process proven gone SHALL end the attempt as an ordinary failure before publication.

Lock acquisition SHALL release the locks it took itself, but not lent locks, when it throws midway.

Outcomes SHALL be stated as they are, and a publication SHALL NOT be rolled back:

- published, the run's own Change Unit reconciled, the probe ready, and the frozen bindings still valid → the current phase SHALL be re-evaluated in the same run;
- the same, but the frozen bindings stale → the design-owner halt with its probe (already ready), the guidance stating that the repair was published and reconciled and that the recovery entry starts a successor on re-issue or supervisor wake;
- any other failure before publication → the draft is discarded, nothing is published, and the design-owner halt states the failed step and that the signature's only chance is spent;
- published but reconciliation incomplete or the probe not ready → recorded as unrecovered; the halt brief SHALL be re-derived from the post-publish state and the guidance SHALL disclose the published revision and where it stopped.

Each stage SHALL emit the record-only event `design_authority_repair` with `action: 'content_repair'`, `stage: 'attempted' | 'published' | 'failed'`, the signature and checks, and as applicable the failed step, files, new revision, `outcome: 'recovered' | 'unrecovered'` and `review_projection_stale`. The event SHALL NOT take part in any verdict; only its signature and stage take part in attempt counting.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/framework-local-config.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: A pre-authorized unattended B1 halt is repaired and the same run completes

- **WHEN** an unattended run with `design_repair.unattended_b1: true` fails a spec round on a `B1` design-authority blocker, and the repair leaves the frozen bindings valid
- **THEN** `attempted` SHALL be on record before the authoring call, the two calls SHALL run in the two locks, the blueprint SHALL be published at the next revision, and the spec phase SHALL be re-evaluated and the run completed without a halt or a new run

#### Scenario: No dispatch without every prerequisite

- **WHEN** the setting is absent or not boolean `true`, the run's owner is a session, or the halt is class `B2`
- **THEN** no repair call SHALL start and no `attempted` SHALL be written; the run SHALL halt as a design-owner halt

#### Scenario: One attempt per signature across resume and successor

- **WHEN** a signature already has `attempted` and the same halt recurs after `--resume` or in a successor
- **THEN** the runtime SHALL NOT dispatch again

#### Scenario: A repair that also widens another location is not published

- **WHEN** the authoring call correctly restores the machine structure of the located acceptance field but also adds a path to `contracts.files` elsewhere in the blueprint
- **THEN** the attempt SHALL fail at `author_scope` with that path listed, the draft SHALL be discarded, the canonical blueprint SHALL stay byte-identical, and the run SHALL halt at the design-owner exit without `phase_write_violation`

#### Scenario: Lock contention does not consume the chance

- **WHEN** another run holds the feature lock of a sibling Change Unit under the same blueprint
- **THEN** the runtime SHALL NOT dispatch, SHALL write no `attempted`, and SHALL park with the contention stated; a later re-issue finding the probe ready continues the run

#### Scenario: A write outside the draft is a violation, not a design wait

- **WHEN** the authoring call changes a requirement, a contract, the personal config, the run's `manifest.json`, an ancestor run's `events.jsonl`, a file under `context/` that a blueprint `source_ref` points to, or appends a forged phase verdict to the run's events
- **THEN** nothing SHALL be published, `phase_write_violation` SHALL list the paths and hashes, the run SHALL stop with `backtrack_target_absent` without a probe, and the changed project files SHALL stay as they are

#### Scenario: A change that cannot be ruled out is a violation without a promised path list

- **WHEN** the post-call snapshot cannot be verified, or the authoring call makes the blueprint reference a file under `context/` that was not checked before the call
- **THEN** nothing SHALL be published and the run SHALL stop with `backtrack_target_absent` without a probe; `phase_write_violation` SHALL be emitted only if concrete changes were also detected, otherwise the failure reason and the halt event are the record

#### Scenario: Tampered run events are detected and the whole file is written back

- **WHEN** a call deletes the run's `run_start`, this attempt's `attempted` record and its own start event, and deletes a line from an ancestor run's `events.jsonl`
- **THEN** both files SHALL be reported as changes, each SHALL be written back to its bytes before the call followed by the lines the runtime wrote during the call (the ancestor's byte for byte as before), resume and successor replay SHALL both find `attempted` and count the calls actually started, and a successor started with `--supersede` SHALL NOT dispatch again

#### Scenario: Normal runtime writes are not violations

- **WHEN** during a call the run writes its heartbeat, beacon, progress and lock, and another feature's run outside the blueprint workspace refreshes its lock, events, beacon and progress
- **THEN** the repair SHALL be published and the run SHALL continue

#### Scenario: An unproven-gone child process stops the run

- **WHEN** the authoring call's child process cannot be bound to containment and is not proven gone
- **THEN** the run SHALL stop with `agent_containment_unresolved` without the design probe, no write check SHALL run, nothing SHALL be published, the questioning call SHALL NOT start, and the authoring call SHALL have no `agent_invoke_end`; when the process is proven gone, the attempt SHALL end as an ordinary failure with the design-owner halt and its probe

#### Scenario: A publication that does not recover is not rolled back

- **WHEN** the published revision still leaves the gate failing, or reconciliation skips the run's own Change Unit
- **THEN** the blueprint SHALL stay at the published revision, the event SHALL record `outcome: 'unrecovered'` with the step, and the halt SHALL be classified from the post-publish state

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
