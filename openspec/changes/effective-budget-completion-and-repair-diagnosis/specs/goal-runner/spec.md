## MODIFIED Requirements

### Requirement: Wall-clock budget accumulates active runtime across resume sessions

The run budget SHALL measure active execution time, not calendar span: prior activity is the sum of per-session durations partitioned by `run_start` events, where a session without `run_end` (crash/hard-kill) is conservatively credited up to one heartbeat cadence beyond its last event (capped by the next session start or the current process start — cumulative undercount SHALL be zero and per-session overcount SHALL not exceed one cadence), and dry sessions are excluded. The hard-deadline semantics (agent/harness/backoff pre-checks minus the finalize reserve) are unchanged; only the baseline becomes `sessionStart + max(0, wall − priorActive)`. Artifact-since consumers (partial-resume feed) SHALL keep the true first authoritative session start, never a synthetic time. Budget halts SHALL carry `halt_reason` and `halt_guidance` on the outcome, the `phase_halt` event and the console banner (and thus `run_end`), and the guidance SHALL name only real routes: after an authorized budget edit of this run, re-issuing the same request with `--override-manifest` or the filled-in explicit `--resume <run> --override-manifest`, both of which rejoin this run without `--force-resume` and without waiting for the cooldown — never a bare restart, never a user-assembled new run, and never a statement that the successor inherits its source's old budget.

Startup time SHALL also count: a `run_start` carrying `session_started_at` SHALL start its session at that time (never earlier than what is already counted), and a `run_end` carrying `session_started_at` that follows the session's first `run_end` (a startup that exited before `run_start`) SHALL add `[max(session_started_at, counted), ts]`. Each session SHALL expose its real active intervals, whose sum equals its active time, so interval consumers never treat non-contiguous startup time as one span. Event streams without the field SHALL compute exactly as before.

Enforcement: `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/await-confirm-guidance.ts`

#### Scenario: an overnight resume of a 74-minute run does not instantly halt

- **WHEN** a run consumed ~74 minutes of active time, halted, and is resumed 13 hours later with a 480-minute wall budget
- **THEN** the budget check SHALL pass and the run SHALL continue with the remaining active budget

#### Scenario: genuine exhaustion halts with visible reason and real routes

- **WHEN** accumulated active time reaches the wall budget at resume
- **THEN** the run SHALL halt with `budget_wall_clock` present on outcome/phase_halt/run_end and guidance offering, after the budget edit, both the re-issued request with `--override-manifest` and the filled-in explicit `--resume <run> --override-manifest`, stating that either rejoins this run without `--force-resume` or cooldown

#### Scenario: Startup probe time before run_start is counted

- **WHEN** a run spends time in the startup canary before `run_start`, or exits during startup before `run_start`
- **THEN** the prior active time read on the next resume or successor SHALL include that startup time, and a successor SHALL NOT regain the consumed probe budget

### Requirement: Re-issuing the same request continues the same task through one decision

A single read-only decision function SHALL run before entry selection and birth-scope resolution for the foreground, detached, and attended entries. Its inputs SHALL be the project, the feature, and the facts of this call (explicit requirement or requirement increment, explicit model, budget override, explicit `--resume` / `--attach-created` / `--supersede` / `--force`, attended). It SHALL return exactly one of:

- **fresh** — no unfinished run after the last trusted completion and the feature scope is not held by a completed run; or the latest unfinished run never formally started, this call gives a requirement increment, no run holds the scope transfer, and there is no last completion (a never-started run has no execution evidence to inherit, so it SHALL NOT serve as a contract source); birth as before, re-resolving the birth scope from the current inputs;
- **rejoin** — the latest unfinished run is not structurally terminal; resume it when it formally started, attach when it never formally started (a startup check stopped it before any `run_start`); or the latest unfinished run is structurally terminal on `budget_turns` / `budget_wall_clock`, the only change is `budget_changed` and its identity difference from the baseline is exactly `budget` (budget-only rejoin of that run); the original checks (device, credential, product selection, canary, budget) SHALL decide whether the condition cleared, and an uncleared condition SHALL stop again with the original reason without creating a run;
- **successor** — the latest unfinished run is structurally terminal and a change exists (other than the budget-only rejoin above), or this call gives an explicit different model or a requirement increment that the frozen run cannot absorb, or the latest unfinished run is not structurally terminal, its halt's probe is ready (`external_condition_ready`) and its frozen input bindings are stale, or there is no unfinished run, the scope is held by a completed run, and a change exists relative to that run (contract source and only target: the completed holder);
- **hold** — structurally terminal with no change, or, on an unattended call, a formally started HALTED/DEFERRED run still inside the 5-minute cooldown with no change (attended calls — including an explicit `--resume` of the run the decision would rejoin — and runs that never formally started SHALL NOT be subject to the cooldown; an attended call on a non-structurally-terminal run SHALL rejoin directly unless one of the successor conditions above holds, and the original responsible checks still run), or no unfinished run with the scope held by a completed run and no change, or whose only change is the budget (guidance: the feature is complete; state the new or changed requirement and re-issue); no run SHALL be created and no event written, and the original stop reason plus what to supply SHALL be returned.

A change SHALL be only one of seven verifiable facts: the bound requirement source changed; a related repair changed; this call gives a requirement increment; this call gives a model different from the pin; this call carries `--override-manifest` while the run manifest's budget identity has moved from its baseline; this call carries an explicit continuation flag; the latest unfinished run, not structurally terminal, is in an external wait whose halt carries a probe and that probe is ready now (`external_condition_ready`). The seventh fact is general — it applies to every probed halt, not only to design authority — SHALL use the same probe extraction and probe implementation as the supervisor and the in-process wait, and SHALL NOT hold when the probe is not ready or fails. When it holds, and this call gives neither a different model nor a requirement increment, the decision SHALL consult the single recovery judgement on the run's frozen input bindings: with no stale binding it SHALL rejoin the same run regardless of the cooldown; with a stale binding it SHALL be successor. A requirement increment SHALL be judged by full-text comparison: this call's requirement is a repeat only when it equals the run's merged requirement in full, the original request in full, or the whole block of historical increments in full; anything else, including a substring, SHALL count as an increment. When the history holds several increments, re-sending a single one of them therefore counts as an increment (one extra successor, no requirement lost). When this call's requirement is already in merged format (it carries the framework's increment marker), the marker SHALL NOT be a reason to discard content: only parts confirmed to exist SHALL be stripped — an original-request segment equal in full to the source's original request, and a leading run of whole lines equal to the source's entire history block — and everything else SHALL be appended to the source requirement as new content with a single marker; it is a repeat only when nothing remains after stripping. The foreground, detached, and attended entries and the decision SHALL derive the successor requirement through the same function. A framework release update alone SHALL NOT count, and repairing only a receipt or closure transaction (no product or contract file change) SHALL NOT count as a related repair. Explicit flags SHALL keep their existing behavior. The detached orphan guard, both birth-scope resolutions, the fresh-run continuation guard, the check inside `createGoalRun`, the terminal resume guard, and the model-pin adjudication SHALL consume the decision instead of rejecting independently; rejoin SHALL NOT require `--force-resume`. A successor SHALL take its contract source from the run holding the current scope transfer, else the last completed run, else the latest unfinished run (except when all four fresh conditions above hold: that run never formally started, this call gives a requirement increment, no run holds the scope transfer, and there is no last completion — then the decision is fresh), and SHALL take its budget from the delivery cycle's latest authorized budget (not from the contract source's snapshot), and SHALL supersede every unfinished, not-yet-superseded run in the delivery cycle, including startup failures, with the existing audit and identity checks. When a successor is decided and this request gives start or end phases, they SHALL be accepted only when they equal the source run's original range; otherwise the entry SHALL refuse with an explanation and SHALL NOT create a run — the successor's chain is re-resolved from its birth scope and SHALL NOT be narrowed to the requested range; re-issuing without the phase arguments proceeds. The foreground, detached, and attended entries SHALL apply the same check. An explicit `--resume` SHALL only select its target; its eligibility SHALL come from this decision computed without the explicit flags: a rejoin of the target skips the terminal resume guard, a ready-probe successor with stale bindings (`external_condition_ready`) converts the resume into that successor, any other successor targeting it runs the guard with zero cooldown while still requiring `--force-resume`, and a hold keeps the guard's cooldown, which on unattended calls SHALL NOT be bypassed by `--force-resume`. The attended entry SHALL return the existing run on rejoin, and on successor SHALL birth the successor and return its run id; attaching to it SHALL write the supersede audit, identity checks, budget lineage, and scope transfer, and the successor SHALL run under the original attended executor. Because the attended entry takes no model or budget-authorization input, its successors SHALL arise only from a requirement increment, a requirement-source change, a related-repair change, or a ready probe on a halt whose frozen input bindings are stale (`external_condition_ready`, which needs no requirement or file change). Real locks, identity checks, and authorization checks SHALL remain; re-issuing a request SHALL NOT be treated as authorization.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: A repeated request with nothing changed does not create a run

- **WHEN** an unattended script re-issues the same request against a structurally terminal run without any of the seven changes
- **THEN** the decision SHALL be hold, no run SHALL be created, no event SHALL be written, and the number of runs SHALL stay the same

#### Scenario: A fixed environment is rejoined without flags

- **WHEN** a run halted on a capability gap, the environment is repaired, and the same request is re-issued after the cooldown with no flags
- **THEN** the same run SHALL be resumed without `--force-resume`, the original capability check SHALL pass, and the phase SHALL execute

#### Scenario: An attended call is not held by the cooldown

- **WHEN** a formally started run halted on a capability gap less than five minutes ago and the attended entry re-issues the same request after the environment is repaired
- **THEN** the decision SHALL be rejoin, the original capability check SHALL run, and the phase SHALL execute without waiting for the cooldown; an unattended call at the same moment SHALL hold unless the halt carries a probe that is ready now

#### Scenario: A ready probe lets an unattended re-issue through the cooldown

- **WHEN** an unattended run halted on a design-owner blocker less than five minutes ago, the design is repaired through readiness so that the halt's probe is ready and the frozen bindings still read back, and the same request is re-issued with no flags
- **THEN** the decision SHALL be rejoin of the same run with `external_condition_ready` among the changes; an unattended re-issue before the repair, inside the cooldown and with none of the other six changes, SHALL hold, create no run and write no event; when another change holds (for example a related repair written by the in-run pointer reconciliation), on an attended call, or after the cooldown, it SHALL rejoin and the original check SHALL stop the run again for the same reason

#### Scenario: A ready probe with stale bindings births a successor

- **WHEN** the same repair changed blueprint content that the run's derived bindings depend on, and the same request is re-issued with no flags
- **THEN** the decision SHALL be successor, the successor SHALL supersede the halted run with the existing audit, and no `--supersede` SHALL be needed

#### Scenario: Part of the original requirement counts as an increment

- **WHEN** the request is re-issued with only one paragraph of the run's frozen requirement
- **THEN** the full-text comparison SHALL treat it as a requirement increment rather than as a repeat of the original

#### Scenario: Re-sending the original request or the whole increment history is a repeat

- **WHEN** the run's requirement is an original request merged with two historical increments, and the request is re-issued with the original request in full, or with both increments together in full
- **THEN** it SHALL NOT count as an increment; re-issuing only one of the two increments SHALL count as an increment

#### Scenario: A merged-format request keeps its new content on both entries

- **WHEN** a completed run holds the scope and the request is re-issued, on the attended or the unattended entry, as the old requirement plus the framework's increment section plus a new requirement
- **THEN** a successor SHALL be born whose requirement contains the new requirement with a single marker and whose birth scope is not empty; re-issuing the same content again with different line breaks SHALL count as a repeat and SHALL NOT birth another successor

#### Scenario: A successor refuses a different phase range

- **WHEN** a successor is decided for a request that names start or end phases different from the source run's original range
- **THEN** the entry SHALL refuse with an explanation and create no run; re-issuing without `--start` / `--end`, or with the original range, SHALL birth the successor

#### Scenario: The attended entry births a successor and the host attaches to it

- **WHEN** the attended `--prepare-run` is re-issued with a requirement increment against a structurally terminal run
- **THEN** it SHALL birth the successor and return its run id; attaching SHALL write the supersede audit and scope transfer and run it under the attended executor, without asking the user to switch to the unattended entry

#### Scenario: An unauthorized repeat still stops

- **WHEN** a run waits on a human authorization and the same request is re-issued without that authorization
- **THEN** the run SHALL stop again for the same reason and no new run SHALL be created

#### Scenario: A new requirement after completion starts a successor from the completed run

- **WHEN** no run is unfinished, the feature scope is held by a completed run, and the same entry is re-issued with a requirement increment and no flags
- **THEN** the decision SHALL be successor with that completed run as contract source and target, and re-issuing the original requirement unchanged SHALL hold without creating a run or writing an event

#### Scenario: A changed requirement after a never-started run starts fresh

- **WHEN** the only unfinished run never formally started, no run holds the scope transfer, there is no completion, and the same entry is re-issued with a different requirement
- **THEN** the decision SHALL be fresh, the birth scope SHALL be re-resolved from the current inputs, and the new run SHALL NOT inherit or merge the never-started run's requirement; re-issuing that run's requirement unchanged SHALL rejoin it by attaching

#### Scenario: An explicit new model after a model-incompatible halt starts a successor

- **WHEN** the latest run halted on an unsupported model and the same request is re-issued with a different `--adapter-model`
- **THEN** the decision SHALL be successor, the successor SHALL supersede the startup-failed run, and the user SHALL NOT name any run

#### Scenario: Raising only the budget of an exhausted run rejoins it

- **WHEN** the latest run halted on `budget_turns`, only its budget was raised, and the same request is re-issued with `--override-manifest`, or the run is explicitly resumed with `--override-manifest`
- **THEN** the decision SHALL be rejoin of that run on both entries, without `--force-resume` and without waiting for the cooldown; a budget change together with a requirement increment SHALL still birth a successor carrying the authorized budget

### Requirement: Human-facing halt guidance states the four recovery facts

Guidance for a halt that needs a person SHALL let the reader find which result is affected, who can fix it, what to do to recover, and how to confirm recovery. It SHALL NOT require the user to enumerate runs or assemble continuation flags; the primary recovery SHALL be "supply the missing input and re-issue the same request", and a filled-in explicit command MAY follow as an alternative — except where a re-issued request would not continue (a closure wall repaired only in its receipt or closure transaction), where the filled-in explicit command SHALL be the primary route. Budget-exhaustion guidance SHALL offer, after the budget edit, both re-issuing the same request with `--override-manifest` and the filled-in explicit `--resume <run> --override-manifest`, both rejoining the halted run without `--force-resume` or cooldown. Where re-issuing is the primary route, the guidance SHALL state that attended calls may re-issue as soon as the input is supplied, while unattended calls with no verifiable change wait out the 5-minute cooldown after a formally started run stops (an explicit resume included); a halt whose probe is ready, or a call carrying another verifiable change such as an authorized budget-only change, SHALL NOT wait. A route that edits a manifest identity field (budget, `unattended` timeouts) SHALL pair the edit with `--override-manifest` and SHALL state that this authorizes the whole manifest, so only the intended field should change. Run ids MAY appear in diagnostics. This is a content requirement, not a fixed four-section format.

Enforcement: `harness/scripts/utils/await-confirm-guidance.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: One sample per fault category reads the four facts

- **WHEN** guidance is rendered for one registered halt reason of each fault category
- **THEN** each text SHALL name the impact, who can fix it, how to recover, and how to confirm recovery, and SHALL NOT contain a `<run-id>` placeholder, `--supersede`, or a "new run_id" instruction

#### Scenario: A timeout-raising route carries the manifest authorization

- **WHEN** the repeated-timeout guidance tells the reader to raise `unattended.phase_timeout_seconds.<phase>`
- **THEN** its command SHALL resume the run with `--override-manifest` and the text SHALL say that this authorizes the whole manifest, so only the timeout field should change

## ADDED Requirements

### Requirement: A successor's budget is the delivery cycle's latest authorized budget

At both successor birth points (the runtime after `inheritSuccessorManifest`, and the attended prepare-run), the successor's `manifest.budget` SHALL be overwritten with the delivery cycle's effective budget; every other field SHALL still come from the contract source. Events SHALL only prove authorization: the latest authorized budget digest of the cycle is the last budget-digest change among the cycle runs' `run_created.manifest_identity_fields.budget` (for a legacy run, the first `run_start` carrying identity fields) and budget-changing `manifest_identity_rebase.to_fields.budget`, ordered by timestamp (ties: larger run id across runs, later event within a run). The value SHALL be whichever existing candidate — a cycle run's current `manifest.budget`, the contract source's budget, or this birth's input budget — has a digest equal to that latest authorized digest. When this call carries `--override-manifest`, a superseded target whose current budget digest has moved from its baseline SHALL be this call's authorization and the effective value. The cycle SHALL be the existing budget fold's `ancestorRuns` cut at `cycleBoundary` (one shared boundary function for budget and birth, algorithm unchanged); only when that set is empty SHALL the birth input budget (`--manifest` or `DEFAULT_BUDGET`) apply. When no candidate matches, a cycle run has no verifiable birth digest, or its events are missing or contain a corrupt line, the birth SHALL fail through the existing successor-manifest construction failure before any lock, manifest or event is written, with guidance to re-issue with `--override-manifest` or restore `manifest.budget`; it MUST NOT fall back to the default or to an older authorization. Runtime limits and progress SHALL keep reading the run's own manifest. No halt reason, state, event field or ledger SHALL be added.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: An authorized raise survives successor births

- **WHEN** a cycle run used its 30 turns, was raised to 42 with `--override-manifest`, and a successor is born for a real requirement increment, then born again
- **THEN** both successors SHALL carry 42 and the first invocation SHALL NOT halt on the source's 30

#### Scenario: An unauthorized edit is never adopted or used to fall back higher

- **WHEN** the only cycle run is authorized at 10 and exhausted, its manifest is hand-edited to 99, and a requirement increment is submitted without `--override-manifest`; or an older run is authorized at 42, the latest at 20, and the latest manifest is hand-edited to 50
- **THEN** no successor SHALL be born and no run created, and the default 30 or the older 42 SHALL NOT be selected; when another candidate still stores the authorized value it SHALL be used; re-issuing with `--override-manifest` SHALL birth a successor carrying the authorized edited value

#### Scenario: A new delivery cycle does not inherit the previous cycle's raise

- **WHEN** a run raised to 42 completes trustworthily and a later requirement increment births a successor
- **THEN** the successor SHALL take this birth's input budget, not 42

### Requirement: A budget-only change rejoins a budget-exhausted run

In the structurally terminal branch of the continuation decision, when the changes are exactly `budget_changed`, the latest run's halt reason is `budget_turns` or `budget_wall_clock`, and its identity-field difference from the baseline is exactly `budget`, the decision SHALL rejoin that run instead of birthing a successor. Other structurally terminal reasons (for example `no_progress_fuse`, `testing_write_violation`) SHALL keep their existing routes, and a budget change combined with a requirement increment, model change or scope invalidation SHALL still birth a successor whose budget follows the effective-budget rule. A completed holder whose only change is the budget SHALL hold, with guidance to state the new requirement. On such a rejoin with `--manifest`, a file that only repeats the run (every written field digest-equal) SHALL resume from the run's own manifest; a file carrying other changes SHALL be adopted with its budget replaced by the run's current budget, and both SHALL go through the existing identity-drift authorization and rebase record; explicit `--resume --manifest` semantics SHALL NOT change.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Raising the budget of an exhausted run continues it

- **WHEN** a run halted on `budget_turns`, its budget is raised to 42 and the same request is re-issued with `--override-manifest` (foreground or detached) without `--force-resume`
- **THEN** the same run SHALL resume with limit 42, record one budget rebase and run to completion, with no successor

#### Scenario: A non-budget terminal halt is not rejoined by a budget change

- **WHEN** a run halted on `no_progress_fuse` and only its budget changed
- **THEN** the decision SHALL NOT rejoin it

### Requirement: Explicit resume eligibility follows the plain continuation decision

An explicit `--resume <run>` (foreground, detached parent, attended) SHALL only select the target run; its eligibility SHALL come from the same continuation decision computed without the explicit flags. When that decision rejoins the target, the terminal resume guard SHALL be skipped. When it is a successor because the halt's probe is ready and the frozen bindings are stale (`change=external_condition_ready`, targets include the target, no `--force` / `--supersede`), the existing conversion SHALL apply unchanged: the explicit resume SHALL be turned into that successor birth (dropping `--resume` / `--force-resume`) instead of reaching the guard. For any other successor whose targets include the target, the guard SHALL run with zero cooldown and SHALL still require `--force-resume`. When it holds, the guard SHALL apply its cooldown and `--force-resume` requirement unchanged. Cooldown length, the attended no-cooldown rule and `--force-resume` lock takeover SHALL NOT change.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: The same state gives the same answer on both entries

- **WHEN** a non-structurally-terminal run halted under 5 minutes ago with no change
- **THEN** an unattended re-issue SHALL hold and an explicit resume SHALL be refused by the cooldown with or without `--force-resume`; after an authorized budget raise on an exhausted run both entries SHALL rejoin immediately

#### Scenario: A successor decision does not impose a cooldown on explicit resume

- **WHEN** the plain decision for the target is successor for a change other than `external_condition_ready`
- **THEN** an explicit resume without `--force-resume` SHALL be refused for a reason other than the cooldown, and with `--force-resume` it SHALL resume inside the cooldown window

#### Scenario: A ready probe with stale bindings still converts an explicit resume into a successor

- **WHEN** the plain decision for the target is successor with `change=external_condition_ready` (ready probe, stale frozen bindings)
- **THEN** the explicit resume SHALL become that successor birth with the existing supersede audit, as before this change, and SHALL NOT be routed to the terminal resume guard

### Requirement: The repair window offers local device diagnosis and driver notes without changing identity

When the coding phase owns candidates of the latest repair request that were reported by device testing (`source_phase === 'testing'`), the coding prompt SHALL add, after the candidate section, a local-diagnosis paragraph naming the ad-hoc CLI modes, the `_adhoc` default output location and the boundary (diagnosis only, no receipt, not acceptance evidence, not a replacement for review → UT → testing); otherwise the prompt SHALL be unchanged. `--repair-notes <file>` SHALL be accepted only when the caller's original arguments carry `--resume` (a fresh call SHALL exit before creating a run; a detached child SHALL rely on the parent's check); it SHALL be read once and injected after the candidate section of the current repair window under a heading that marks it as a driver hypothesis, not a requirement. It MUST NOT enter the manifest, the frozen requirement or its hash, run identity or the continuation decision, and MUST NOT by itself cause a successor.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/repair-candidates.ts`

#### Scenario: Driver notes reach the repair prompt without a new run

- **WHEN** a run stopped before its repair coding is resumed with `--override-manifest --repair-notes notes.md`
- **THEN** the same run SHALL continue, the requirement hash and run count SHALL be unchanged, the repair coding prompt SHALL contain the diagnosis entry and the notes marked as non-requirement after the candidates, and the testing prompt SHALL NOT contain the notes

#### Scenario: Notes on a fresh call are refused

- **WHEN** `--repair-notes` is given without `--resume`
- **THEN** the entry SHALL exit with a usage error and SHALL NOT create a run or start a detached child

### Requirement: Interrupted repair invocations are regression-tested on a real child process

The repair-continuity regression SHALL include cases where the phase invocation is a scripted executor running as a real child process through the production `invokeAgentHeadless` (including Windows guardian containment): killed externally before completion, exiting without a terminal event, and completing then lingering until the framework's completion cleanup kill. These cases SHALL be described as proving spawn, termination and event parsing only, not real Codex CLI interruption behavior.

Enforcement: `harness/tests/unit/repair-interruption-real-process.unit.test.ts`

#### Scenario: An interrupted repair keeps its window

- **WHEN** the repair coding invocation is killed before completion and the following ordinary gate passes
- **THEN** the repair window SHALL stay open, no other phase SHALL be invoked, and the next coding invocation SHALL carry the original candidate and complete the window

#### Scenario: A completed invocation with a nonzero cleanup exit is not repeated

- **WHEN** the repair coding invocation emits its terminal completion and is then killed by the completion cleanup
- **THEN** coding SHALL NOT be invoked again, the window SHALL complete and the run SHALL finish; after a gate crash an explicit resume SHALL only revalidate
