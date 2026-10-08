## MODIFIED Requirements

### Requirement: The repair window offers local device diagnosis and driver notes without changing identity

When the coding phase owns at least one candidate of the latest repair request, from any source phase (testing or review), and the run's effective phase chain contains a phase that requires a device (derived through `chainRequiresDevice` from the active profile, not from coding's own device requirement or the session's last testing target), the coding prompt SHALL add, after the candidate section, a local recheck paragraph: for a repair affecting device UI or interaction, when conditions allow, the agent MUST reproduce the relevant state with its current build and check the fix result before handing back; when conditions do not allow, it SHALL record the attempt, the obstacle and the remaining uncertainty in the existing coding handoff notes; one valid recheck of a screen MAY cover several related candidates. The paragraph SHALL name the ad-hoc CLI modes, the `_adhoc` default output location and the boundary (diagnosis only, no receipt, not acceptance evidence, not a replacement for review → UT → testing, a missing diagnosis file never blocks the phase); otherwise the prompt SHALL be unchanged. No check SHALL inspect `_adhoc` output. `--repair-notes <file>` SHALL be accepted only when the caller's original arguments carry `--resume` (a fresh call SHALL exit before creating a run; a detached child SHALL rely on the parent's check); it SHALL be read once and injected after the candidate section of the current repair window under a heading that marks it as a driver hypothesis, not a requirement. It MUST NOT enter the manifest, the frozen requirement or its hash, run identity or the continuation decision, and MUST NOT by itself cause a successor.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/repair-candidates.ts`

#### Scenario: Driver notes reach the repair prompt without a new run

- **WHEN** a run stopped before its repair coding is resumed with `--override-manifest --repair-notes notes.md`
- **THEN** the same run SHALL continue, the requirement hash and run count SHALL be unchanged, the repair coding prompt SHALL contain the recheck paragraph and the notes marked as non-requirement after the candidates, and the testing prompt SHALL NOT contain the notes

#### Scenario: Notes on a fresh call are refused

- **WHEN** `--repair-notes` is given without `--resume`
- **THEN** the entry SHALL exit with a usage error and SHALL NOT create a run or start a detached child

#### Scenario: A review-sourced repair gets the same recheck requirement

- **WHEN** coding owns only review-sourced candidates in a run whose chain contains testing on a device-capable profile
- **THEN** the prompt SHALL contain the same recheck paragraph as for testing-sourced candidates, without the word optional; for a run without device qualification the paragraph SHALL be absent

## ADDED Requirements

### Requirement: A capability-absence deferral parks testing and resumes the same run

When a phase verdict is deferred on an external block and the run stops at that phase — `defer_external_and_halt`, or `defer_external_and_continue_if_allowed` while the phase is the last of the chain — the outcome SHALL carry the same parked projection as a device park (`run_disposition: 'WAITING'`, `run_wait_kind: 'external'`, `halt_guidance`), and the runtime SHALL emit, after the defer `phase_verdict`, a `phase_halt` of the same shape without `halt_reason` or `probe`. The guidance SHALL be built only from the summary's `externalBlocked` blockers' own detail and suggestion, so it names the absent capability. The run terminal status SHALL still come from `deferred_reason=capability_missing` (`DEFERRED_CAPABILITY_MISSING`, projected `WAITING(external)`); the events-only rebuild SHALL treat that phase as unfinished, so re-issuing the same request after the capability is restored rejoins the same run through the existing continuation decision, re-queues the phase and lets the original checker re-verify, with budgets folded across sessions. No probe, provider-recovery chain or `external_condition_ready` claim SHALL be added, and a deferral in the middle of the chain (downstream continues) SHALL keep its existing behavior.

Enforcement: `harness/scripts/goal-phase-runtime.ts`

#### Scenario: provider absence defers, then the same run completes after recovery

- **WHEN** testing first fails on a product defect plus provider absence, coding repairs it, review and ut pass, and the second testing round has only provider absence
- **THEN** that round SHALL make no FAIL retry, the run SHALL end `DEFERRED_CAPABILITY_MISSING` with a parked `phase_halt` naming the provider, and after the provider is restored the same request SHALL rejoin the same run, start at testing, pass and end `CHAIN_SLICE_COMPLETED` with turns counted across both sessions and no `external_condition_ready`

### Requirement: Hold guidance quotes the latest stop window

When the continuation decision holds, the quoted original stop text SHALL come only from the latest stop window: the latest `phase_halt`'s `halt_guidance`, else its `reason`. A `run_end` that closes the same session SHALL NOT override it. Only a later session started after that `phase_halt` (a `run_start` between them, or the `run_end`'s own `session_started_at` later than the halt) that ended with `run_end.error` SHALL quote that error; with no `phase_halt` the latest `run_end.error` SHALL be quoted. An older halt's guidance SHALL NOT be quoted over a newer halt without guidance.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`

#### Scenario: a newer halt without guidance is not masked by an older one

- **WHEN** a run's earlier session halted on the canary with guidance and its later session halted on `framework_bug` with only a reason
- **THEN** the hold guidance SHALL quote the `framework_bug` reason and not the canary guidance

### Requirement: A failed canary invoke reports a stderr excerpt

When the vision canary invoke fails (`invoke_failed`) without a terminal error excerpt, the reported error SHALL append the last non-empty stderr line with control characters removed, at most 500 characters. `CanaryInvocationFacts` and other outcomes SHALL be unchanged.

Enforcement: `harness/scripts/utils/goal-preflight.ts`

#### Scenario: exit 1 without a terminal envelope keeps its reason

- **WHEN** the canary invoke exits 1 with no terminal envelope and stderr ends with a readable error line
- **THEN** the `invoke_failed_not_cached` error SHALL contain that line without control characters
