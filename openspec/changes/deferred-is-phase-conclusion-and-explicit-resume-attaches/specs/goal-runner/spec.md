## ADDED Requirements

### Requirement: Phase deferral is the phase's own conclusion

Assess SHALL treat a phase summary as deferred only when its producer concluded so: `verdict=INCOMPLETE` or `completion_status=deferred`. A `verdict=FAIL` summary that does not explicitly set `completion_status=deferred` SHALL be a `failed` gap even when its blockers include external or device classes (`externalBlocked`, `external_block`, `device_blocked`); the external condition SHALL be re-evaluated when that phase is run again. The existing precedence inside an INCOMPLETE summary (an explicit external/device blocker or `completion_status=deferred` keeps deferral over a locally blocked capability) SHALL be unchanged. No new halt reason, state, or field SHALL be introduced.

Enforcement: `harness/scripts/utils/assess.ts`

#### Scenario: a FAIL testing summary with a provider-unavailable blocker is not deferred

- **WHEN** coding, review and ut are currently PASS, the current phase is ut, and the earlier testing summary is `verdict=FAIL` with an `externalBlocked` / `capability_missing` visual blocker alongside product defects and coding repair candidates
- **THEN** assess SHALL observe testing with `deferred=false`, report a `failed` gap and recommend `rerun_phase` for testing

#### Scenario: an INCOMPLETE upstream deferral keeps its external defer action

- **WHEN** the current phase summary is `verdict=INCOMPLETE` with an external/device blocking class and a dependency policy
- **THEN** assess SHALL still recommend `resolve_deferred` with the `defer_external_*` runner action selected by the phase-transition policy

### Requirement: A deferred phase not yet reached is advanced into

When assess recommends `resolve_deferred` without a `defer_external_*` runner action, the driver SHALL return `advance` if the target phase lies after the current phase in the chain, so the runner enters that phase in chain order; for the same, an earlier, or an invalid target it SHALL keep `halt`. A `defer_external_*` runner action SHALL pass through unchanged.

Enforcement: `harness/scripts/utils/goal-assess-driver.ts`

#### Scenario: a downstream INCOMPLETE phase does not halt the chain

- **WHEN** coding is the current phase with a PASS outcome and the later review summary is `verdict=INCOMPLETE` (deferred)
- **THEN** assess SHALL recommend `resolve_deferred` for review and the driver SHALL return `advance`, not `halt` (no `framework_bug` fallback)

### Requirement: Explicit resume of a never-started run attaches through the same decision

When an explicit `--resume <run>` targets a run with no `run_start` and the same continuation decision computed without the explicit flags is `rejoin` of that run with `started=false`, the runtime SHALL drop `--resume`, attach to the same run as `--attach-created`, log the rewrite, and keep any user-supplied `--force-resume` so an expired session owner (`orphaned_session`) can still be taken over explicitly. The detached launcher SHALL pass its original arguments through; the child SHALL perform the rewrite and the parent SHALL complete its handshake on the child's `run_start`. The attended entry SHALL keep choosing `--attach-created` for never-started runs. When the condition does not hold, the existing refusal for events without an authoritative `run_start` SHALL remain, and its guidance SHALL distinguish a run that only has its birth event (re-issue the same request or attach with `--attach-created`) from an events file that was replaced or emptied (manual inspection). Missing, corrupt, and empty events refusals, cooldown, budget and the terminal resume guard SHALL be unchanged.

Enforcement: `harness/scripts/goal-phase-runtime.ts`

#### Scenario: resume of a canary-stopped run attaches in the foreground and detached

- **WHEN** a run holds only `run_created` plus a startup `phase_halt` / `run_end` (`canary_cli_hard_failure`) and is resumed with `--resume <run>` in the foreground or with `--detach`
- **THEN** the runtime SHALL log that the resume was turned into an attach, write `run_start` on the same run without creating another run, and the detached parent SHALL report a successful startup instead of `alive_timeout`

#### Scenario: an expired session owner still needs explicit takeover

- **WHEN** the same never-started run carries an expired session owner and is resumed without `--force-resume`
- **THEN** the run SHALL be refused with `run-control owner busy`, and the same resume with `--force-resume` SHALL attach, take over the owner and write `run_start`

## MODIFIED Requirements

### Requirement: Attempt reporting uses four orthogonal axes

Halt reporting for no-progress-family reasons SHALL be synthesized from per-attempt records on four orthogonal axes — agent termination (timeout/exit0/completed-with-cleanup/error) × harness verdict (PASS/FAIL/unavailable) × transition (advanced/advance_blocked/halted/retried) × artifact delta (changed/unchanged/restored) — rendered as a per-attempt timeline; summaries SHALL NOT present overlapping axes as mutually exclusive counts. An invocation with a non-zero exit code and `completion_observed=true` (the agent completed and was killed by the post-completion cleanup grace) SHALL show `completed（cleanup，exit=N）` and SHALL NOT raise the agent exit-code observability warning; timeouts, `silent_killed`, and non-zero exits without observed completion SHALL keep `timeout` / `error` and their warning. Event fields and the timeout / content-FAIL / PASS-blocked counts SHALL be unchanged.

Enforcement: `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: the incident's i2 is reported on both axes instead of miscounted

- **WHEN** an attempt both timed out and produced a harness PASS blocked from advancing
- **THEN** the timeline SHALL show `timeout × PASS × advance_blocked` for that attempt and totals SHALL reconcile with the number of attempts

#### Scenario: a completed invocation killed during cleanup is not reported as an error

- **WHEN** an invocation ends with exit code 1 and `completion_observed=true`, and another ends with exit code 1 without observed completion
- **THEN** the first SHALL show `completed（cleanup，exit=1）` with no agent warning, and the second SHALL show `error` with the `exit=1` warning
