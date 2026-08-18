# goal-mode-skill Specification

## Purpose

Define the host-facing goal-mode thin entry (`/goal-mode` / skill id `goal-mode`) that directs agents to self-run `goal-runner` without duplicating harness verdict logic.
## Requirements
### Requirement: Goal mode skill is a thin entry point

The system SHALL provide `skills/project/goal-mode/SKILL.md` that documents how to invoke `goal-runner` and interpret reports, without duplicating verdict classification logic. Host entry SHALL be `/goal-mode` (Claude slash) or skill id `goal-mode` (cursor/codex/generic bridge). Before starting goal-runner, the agent SHALL run `check-personal-setup.ts --json --ensure` per `personal-setup-gate.md`.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/skills.index.yaml`, `agents/*/adapter.yaml`

#### Scenario: Agent reads skill for goal run

- **WHEN** user requests goal mode via `/goal-mode`, natural language（目标模式 / 全自动）, or skill bridge
- **THEN** agent is directed to self-run goal-runner with manifest fields rather than implementing its own phase loop

#### Scenario: Goal mode NL takes priority over batch

- **WHEN** user message matches both goal-mode phrases and batch_authorized phrases
- **THEN** `resolveTransitionPolicy` MUST return `goal_mode` before `batch_authorized`

#### Scenario: Personal setup before goal-runner

- **WHEN** personal setup `--ensure` returns `needs_adapter_choice`
- **THEN** agent completes adapter selection via `init-orchestrate --scope personal` `record-adapter` before starting goal-runner

### Requirement: Goal mode runs the shared assessment loop
The goal-mode skill SHALL repeatedly consume `assess@1`, enforce driver authorization, execute one recommended feature skill, and reassess until reconciled or fused. It MUST NOT maintain an independent next-phase decision table. Enforcement SHALL be defined in `skills/goal/goal-mode/SKILL.md` and `harness/scripts/assess.ts`.

#### Scenario: Assessment recommends an authorized phase
- **WHEN** goal mode is active, the recommendation is qualified, and authorization covers the phase
- **THEN** the skill SHALL execute that phase once and return to assess

### Requirement: Goal mode exposes two user-facing run modes
The skill SHALL expose only “有人在场” and “无人值守”. Explicit intent SHALL be reflected without another prompt; ambiguous intent SHALL use `skills/reference/confirmation-registry.yaml > goal.run_mode`; CLI `--detach` SHALL select unattended behavior.

#### Scenario: User explicitly requests unattended execution
- **WHEN** the request says the user is leaving or asks the goal to run unattended
- **THEN** the driver SHALL reflect the unattended interpretation and run the required preflight without asking the run-mode question

### Requirement: In-session autonomous phases use isolated context
An autonomous in-session goal SHALL execute each phase in a fresh phase-scoped context and return only structured outcome/evidence to the thin driver. Adapters without declared context isolation SHALL fall back to manual harness+assess.

#### Scenario: Adapter lacks phase isolation
- **WHEN** someone-present mode is requested on an adapter without in-session phase isolation
- **THEN** the framework SHALL use manual harness+assess and explain the effective behavior without exposing internal tier terminology

### Requirement: In-session execution writes canonical goal evidence
The in-session driver SHALL use the same manifest, events, progress, phase outcome, and run ID schemas as `harness/scripts/goal-runner.ts`, fenced by `run-control@1`.

#### Scenario: In-session run hands off to detached runner
- **WHEN** the handoff completes
- **THEN** the detached runner SHALL resume the same run ID and authoritative event sequence without ledger conversion

### Requirement: Goal status remains visible
Each reconciliation round SHALL present feature, phase, round, user-facing run mode, and waiting items. Internal `in-session`, `headless`, `tier`, and batch implementation labels MUST NOT appear in user menus.

#### Scenario: Goal waits for a human-only item
- **WHEN** execution cannot proceed automatically
- **THEN** the status line SHALL identify the waiting item and whether the run remains attended or unattended

### Requirement: Unattended launch survives the host session via real detach

The goal-mode launch contract SHALL require unattended runs to use real `--detach` (OS-level `detached` + `unref` + file-redirected stdio) for session survival, rather than relying on a host background mode (`is_background` / `run_in_background`). The contract SHALL state explicitly that "control returned to the agent" is not "the process survives my session": a host background child is session-bound and is reaped when the agent turn or session ends.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Unattended run uses detach for survival

- **WHEN** the main agent starts a goal run for unattended completion
- **THEN** the launch SHALL use `--detach`; a host background mode MAY additionally wrap the launcher for non-blocking control, but survival SHALL be attributed to `--detach`, not the host background mode

#### Scenario: Post-launch survival self-verify

- **WHEN** the launcher returns `{run_id, report_dir, log, pid}`
- **THEN** the agent SHALL confirm the run actually started (detach.log growing and `goal-status` liveness healthy) before reporting it as running, and SHALL report "startup did not survive" otherwise rather than claiming a background run is in progress

#### Scenario: Survival is an environment property

- **WHEN** the host reaps process trees/groups on teardown (e.g., `taskkill /T` or a kill-on-close Job Object, since Node `detached:true` does not set `CREATE_BREAKAWAY_FROM_JOB`)
- **THEN** the contract SHALL document that `--detach` alone is insufficient there and the run must be hosted by an OS scheduled task (cron / Windows Task Scheduler)

#### Scenario: Foreground unattended start is blocked at the code level

- **WHEN** a real (non-dry-run) unattended run (`approval_mode=never`) is started in the foreground without `--detach` and is not the OS-detached child
- **THEN** `goal-runner` SHALL exit with a BLOCKER directing the operator to `--detach`, unless `--foreground-ok` is passed (which downgrades it to a warning); dry-runs and the OS-detached child are never blocked

### Requirement: Goal mode documents monitor timeout coupling

The system SHALL document that when calling `goal-monitor` (opt-in watching of an unattended detached run during the current turn), the host shell or tool timeout used to invoke it MUST be set greater than the monitor's `--max-seconds`, or `--max-seconds` MUST be reduced below the host timeout.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Agent configures host timeout

- **WHEN** goal-mode instructions show `goal-monitor --max-seconds 240`
- **THEN** they MUST also state that the host shell/tool timeout should be set to at least 300 seconds

### Requirement: Goal mode distinguishes monitoring from wakeup

The system SHALL document that bounded monitoring is not a cross-turn chat wakeup mechanism. True push or wakeup after the main conversation turn ends SHALL be treated as an adapter or host enhancement, while `GOAL_PHASE` stdout remains only an optional acceleration signal.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Conversation turn ends before goal finishes

- **WHEN** a goal run continues after the main agent turn ends
- **THEN** the goal-mode instructions MUST NOT claim framework scripts can wake the chat by themselves, and MUST direct future agents to recover from the run directory using `goal-status`

#### Scenario: Adapter has output notifications

- **WHEN** a host supports stdout notifications such as `GOAL_PHASE`
- **THEN** the goal-mode instructions SHALL describe them as optional accelerators, not as the notification source of truth

### Requirement: Goal mode accepts optional user adapter

The goal-mode skill SHALL document optional user-specified `adapter`, mapping to `--adapter` when the adapter is materialized with entry artifacts present.

Enforcement: `skills/project/goal-mode/SKILL.md`

#### Scenario: User specifies cursor adapter

- **WHEN** user requests goal mode with explicit cursor adapter and cursor is materialized
- **THEN** agent passes `--adapter cursor` to goal-runner

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

