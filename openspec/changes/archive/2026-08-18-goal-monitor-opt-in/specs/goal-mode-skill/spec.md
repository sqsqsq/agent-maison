## MODIFIED Requirements

### Requirement: Goal mode documents monitor timeout coupling

The system SHALL document that when calling `goal-monitor` (opt-in watching of an unattended detached run during the current turn), the host shell or tool timeout used to invoke it MUST be set greater than the monitor's `--max-seconds`, or `--max-seconds` MUST be reduced below the host timeout.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Agent configures host timeout

- **WHEN** goal-mode instructions show `goal-monitor --max-seconds 240`
- **THEN** they MUST also state that the host shell/tool timeout should be set to at least 300 seconds

## REMOVED Requirements

### Requirement: Goal mode monitors active runs during the current turn

**Reason**: 默认反转——无人值守 run 启动后执行有界启动握手、汇报并交还轮次，monitor 仅在用户明确要求盯守时进入（见 ADDED「Goal mode returns the turn after launching unattended runs」）；bounded monitor 从默认降为显式 opt-in，原「启动后必进 monitor」「fire-and-forget 须显式」两个 Scenario 一并移除，fire-and-forget 即新默认、不再需要点名。

## ADDED Requirements

### Requirement: Goal mode returns the turn after launching unattended runs

The system SHALL document in `skills/project/goal-mode/SKILL.md` that after the main agent starts an unattended goal run it SHALL perform a bounded startup handshake (hard cap 30 seconds; checking only manifest on-disk, detach.log growth, and liveness), then report `run_id`, progress files, and the status entry point, and end the current conversation turn. The handshake SHALL classify the result: credible terminal or waiting-state evidence SHALL be reported as the actual run state; a non-terminal run with healthy liveness SHALL be reported as started; an expired window with the process still alive SHALL be reported as "not yet ready, process still alive"; "not alive" SHALL be reported only when the process is actually dead and no credible terminal evidence exists. detach.log growth is startup evidence but MUST NOT be a persistent terminal gate. Status queries SHALL use `goal-status` as the sole entry point; `goal-monitor` MUST NOT be used as a status query. Bounded monitoring SHALL be entered only when the user explicitly asks the main agent to keep watching the run during the current turn. The agent MUST NOT use hand-rolled sleep/poll loops (including `for`/`grep` over `events.jsonl`) to wait for phase / verdict / run_end events; the bounded startup handshake is the only legal wait outside explicit opt-in monitoring.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Default is startup handshake then turn return

- **WHEN** the main agent starts an unattended (`--detach`) goal run and obtains `run_id` from the launcher JSON
- **THEN** the goal-mode instructions SHALL direct the agent to perform the bounded startup handshake (≤30s; manifest on-disk, detach.log growth, and liveness only), report `run_id`, the progress file path, and the `goal-status` status query command, and end the current turn without calling `goal-monitor`

#### Scenario: Startup handshake reports terminal-state truth

- **WHEN** a run reaches a credible terminal or waiting state within the handshake window (e.g. `COMPLETED`, `HALTED`, or a trusted wait) and the process exits or the log stops growing as a result
- **THEN** the agent SHALL report the actual run state; process exit / frozen log growth caused by the terminal state MUST NOT be misreported as "startup not alive"

#### Scenario: Window expires with process still alive

- **WHEN** after the bounded startup handshake window the manifest/log evidence is incomplete but the process is still alive
- **THEN** the agent SHALL report "not yet ready, process still alive" with the detach.log path, and MUST NOT report the run as dead

#### Scenario: Process dead without terminal evidence

- **WHEN** after the bounded startup handshake window the process is actually dead and no credible terminal or waiting-state evidence exists
- **THEN** the agent MUST report "startup not alive" with the detach.log path, and MUST NOT report the run as started

#### Scenario: Bounded monitor is entered only on explicit request

- **WHEN** the user explicitly asks the main agent to keep watching the run during the current turn
- **THEN** the goal-mode instructions MAY direct the agent to enter the bounded monitor loop with the opt-in monitoring rules (since-event carry-over, timeout coupling, P1-8 circuit breakers)

#### Scenario: Hand-rolled event polling is forbidden

- **WHEN** an unattended goal run is in progress and the user has not asked the agent to watch it
- **THEN** the agent MUST NOT use `sleep` / `for` / `grep events.jsonl` loops to wait for phase / verdict / run_end events; waiting for phase events is only legal through the opt-in bounded monitor, otherwise the agent returns the turn