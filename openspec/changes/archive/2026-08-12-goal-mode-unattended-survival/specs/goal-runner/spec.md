## ADDED Requirements

### Requirement: Dead runs never project as RUNNING

The liveness projection SHALL detect a terminated-but-incomplete run from the event stream alone, independent of lock presence, so a run whose orchestrator died can never project as `RUNNING`. A `harness_start` with no following `harness_end`/`phase_verdict` past the phase timeout SHALL be a hard stall, and silence beyond `DEAD_MAN_FACTOR × phase_timeout` (a live runner heartbeats ~every 60s) SHALL be a hard stall.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: Dangling harness_start with cleaned locks does not project RUNNING

- **WHEN** `events.jsonl` ends with `agent_invoke_end` then a `harness_start` with no later `harness_end`/`phase_verdict`, no lock is present, and the last event is hours old
- **THEN** projection SHALL report a non-`RUNNING` status (`STALLED`) and liveness `STALLED`, not `RUNNING`/`soft_quiet_window`

#### Scenario: Absolute dead-man catches lock-independent silence

- **WHEN** the run has no terminal `run_end` and the last activity is older than `DEAD_MAN_FACTOR × phase_timeout`
- **THEN** projection SHALL report a hard stall regardless of whether any lock file exists

#### Scenario: Live harness window is not a false stall

- **WHEN** a `harness_start` is within the phase timeout and heartbeat events are fresh
- **THEN** projection SHALL keep the run `RUNNING` and MUST NOT report a stall

### Requirement: Abnormal exit writes a terminal event

On any abnormal termination (catchable signal, uncaught exception, or process exit), the runner SHALL write `run_end{status:"INTERRUPTED"}` to `events.jsonl` synchronously and idempotently before releasing locks, so an interrupted run is never silent. A normal terminal `run_end` SHALL suppress the interrupted event. The projection SHALL treat `INTERRUPTED` as a terminal status and SHALL NOT apply freshness degradation to it.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Signal writes INTERRUPTED before async cleanup

- **WHEN** the runner receives a catchable signal (`SIGINT`/`SIGBREAK`) or crashes mid-run
- **THEN** `run_end{status:"INTERRUPTED"}` SHALL be appended (via `appendFileSync`) before any asynchronous tree-kill, and only once even if multiple exit hooks fire

#### Scenario: INTERRUPTED projects as terminal

- **WHEN** `events.jsonl` contains a `run_end{status:"INTERRUPTED"}`
- **THEN** projection SHALL report status `INTERRUPTED` and liveness `DONE`, and freshness degradation SHALL be a no-op

#### Scenario: Windows SIGBREAK is registered

- **WHEN** running on Windows where `SIGTERM` is not catchable
- **THEN** the runner SHALL register `SIGBREAK` (Ctrl-Break / console close) so a graceful host signal still writes the terminal event
