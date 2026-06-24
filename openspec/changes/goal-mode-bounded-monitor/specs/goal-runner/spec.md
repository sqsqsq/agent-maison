## ADDED Requirements

### Requirement: Goal monitor provides bounded notification reads

The system SHALL provide `harness/scripts/goal-monitor.ts` as a read-only bounded monitor over goal run evidence. The monitor MUST read existing run evidence and live progress projection without starting, resuming, killing, or mutating a goal run.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Phase verdict produces notification

- **WHEN** `events.jsonl` contains a `phase_verdict` event after the supplied `--since-event` cursor
- **THEN** `goal-monitor --markdown` SHALL emit one agent-facing notification containing the phase, verdict/action, current run status, next phase when available, and evidence paths

#### Scenario: Bounded timeout is no-op

- **WHEN** no notification-worthy event appears before `--max-seconds`
- **THEN** `goal-monitor` SHALL exit successfully with a no-op result and MUST NOT alter any goal run files

#### Scenario: Monitor timeout is harmless

- **WHEN** a host shell or tool kills `goal-monitor` before it returns
- **THEN** the goal run SHALL remain unaffected because the monitor is read-only

### Requirement: Goal monitor uses stable event cursors

The system SHALL define `event_index` as the zero-based line index in `events.jsonl`. `goal-monitor --since-event <n>` SHALL only edge-notify on events with index greater than `<n>`, while still using the complete event stream to compute current status.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Since-event filters old verdicts

- **WHEN** a run contains prior `phase_verdict` events at or before `--since-event`
- **THEN** `goal-monitor` MUST NOT emit those old verdicts as new edge notifications

#### Scenario: Cross-turn recovery summarizes current state

- **WHEN** an agent resumes monitoring without reliable in-memory `last_seen`
- **THEN** the monitor SHALL allow the agent to rebuild current state and recent verdicts from `events.jsonl` and live projection without requiring a persisted notified marker

### Requirement: Heartbeat notifications are throttled by event time

The system SHALL treat ACTIVE heartbeat summaries as notification-worthy only when the run has had no phase-changing event for at least `SOFT_STALL_MS = 10min` according to event/live snapshot timestamps, not according to the duration of the current monitor invocation.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Short monitor does not trigger heartbeat by itself

- **WHEN** `goal-monitor --max-seconds 240` waits for a running phase with no phase verdict
- **THEN** the 240 second local wait alone MUST NOT produce a heartbeat notification unless the event-time threshold is already crossed

#### Scenario: Same-phase heartbeat deduplicates

- **WHEN** multiple monitor calls observe the same phase after a low-frequency heartbeat summary was already emitted for the same status window
- **THEN** subsequent calls MUST NOT emit duplicate heartbeat summaries unless the threshold boundary or material status summary changes

### Requirement: Hard liveness anomalies edge-notify once

The system SHALL surface hard liveness anomalies (`STALLED`, `ORPHAN_SUSPECTED`) as `goal-monitor` notifications, but MUST edge-trigger them: a given anomaly SHALL be emitted only when new evidence (a higher `event_index`) has appeared past `--since-event`. An orphaned or hard-stalled run whose event stream is frozen MUST NOT re-emit an identical liveness notification on every monitor call; subsequent calls SHALL fall through to the bounded no-op.

Enforcement: `harness/scripts/goal-monitor.ts`

#### Scenario: Stalled run notifies once then deduplicates

- **WHEN** a run is `STALLED`/`ORPHAN_SUSPECTED` with no newer events and the agent passes the previously returned `event_index` back as `--since-event`
- **THEN** the first call SHALL emit a `liveness` notification and a subsequent call with no newer events SHALL return a bounded no-op instead of repeating it

### Requirement: Completed phase durations stop at completion

The system SHALL project completed phase durations using an `ended_at` timestamp rather than current time. Normal `ended_at` SHALL come from the phase `phase_verdict.ts`; legacy or recovery gaps MAY fall back to the next phase `phase_start.ts` or `run_end.ts`.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: Passed phase duration remains stable

- **WHEN** a phase has a `phase_start` and subsequent `phase_verdict`
- **THEN** `goal-status` and `goal-monitor` projections SHALL report that phase duration as `phase_verdict.ts - phase_start.ts`, regardless of the current time

#### Scenario: Running phase duration still grows

- **WHEN** the current phase has started but has not ended
- **THEN** progress projection SHALL continue reporting duration as current time minus the phase start time
