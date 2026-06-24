## ADDED Requirements

### Requirement: Goal mode monitors active runs during the current turn

The system SHALL document in `skills/project/goal-mode/SKILL.md` that after the main agent starts goal-runner, it MUST enter bounded monitoring during the current active conversation turn unless the user explicitly requests fire-and-forget.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Agent starts monitor after runner

- **WHEN** the main agent starts a goal run and obtains `run_id`
- **THEN** the goal-mode instructions SHALL direct the agent to report `run_id` and `progress.json`, then invoke `goal-monitor --since-event <last_seen> --max-seconds <n>`

#### Scenario: Fire-and-forget remains explicit

- **WHEN** the user explicitly asks to run goal mode in the background without progress updates
- **THEN** the goal-mode instructions MAY allow the agent to report the run id and status command without entering the monitor loop

### Requirement: Goal mode documents monitor timeout coupling

The system SHALL document that the host shell or tool timeout used to invoke `goal-monitor` MUST be set greater than the monitor's `--max-seconds`, or `--max-seconds` MUST be reduced below the host timeout.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Agent configures host timeout

- **WHEN** goal-mode instructions show `goal-monitor --max-seconds 240`
- **THEN** they MUST also state that the host shell/tool timeout should be set to at least 300 seconds

### Requirement: Goal mode distinguishes monitoring from wakeup

The system SHALL document that bounded monitoring is not a cross-turn chat wakeup mechanism. True push or wakeup after the main conversation turn ends SHALL be treated as an adapter or host enhancement, while `GOAL_PHASE` stdout remains only an optional acceleration signal.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Conversation turn ends before goal finishes

- **WHEN** a goal run continues after the main agent turn ends
- **THEN** the goal-mode instructions MUST NOT claim framework scripts can wake the chat by themselves, and MUST direct future agents to recover from the run directory using `goal-status` or `goal-monitor`

#### Scenario: Adapter has output notifications

- **WHEN** a host supports stdout notifications such as `GOAL_PHASE`
- **THEN** the goal-mode instructions SHALL describe them as optional accelerators, not as the notification source of truth
