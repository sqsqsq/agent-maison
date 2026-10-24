# goal-mode-skill Specification

## Purpose

Define the host-facing goal-mode thin entry (`/goal-mode` / skill id `goal-mode`) that directs agents to self-run `goal-runner` without duplicating harness verdict logic.
## Requirements
### Requirement: Goal mode skill is a thin entry point

The system SHALL provide `skills/project/goal-mode/SKILL.md` that documents how to invoke the canonical goal entries and interpret reports, without duplicating verdict classification logic. Host entry SHALL be `/goal-mode` (Claude slash) or skill id `goal-mode` (cursor/codex/generic bridge). Before starting a goal run, the agent SHALL run `check-personal-setup.ts --json --ensure` without `--select-adapter`: an existing valid local `activeAdapter` wins without another question, one materialized candidate MAY be auto-selected, and multiple unresolved candidates SHALL use the setup registry.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`, `skills/reference/personal-setup-gate.md`, `skills/skills.index.yaml`, `agents/*/adapter.yaml`

#### Scenario: Agent reads skill for goal run

- **WHEN** user requests goal mode via `/goal-mode`, natural language（目标模式 / 全自动）, or skill bridge
- **THEN** agent is directed to the canonical attended or unattended entry with manifest fields rather than implementing its own phase loop

#### Scenario: Goal mode NL takes priority over batch

- **WHEN** user message matches both goal-mode phrases and batch_authorized phrases
- **THEN** `resolveTransitionPolicy` MUST return `goal_mode` before `batch_authorized`

#### Scenario: Personal setup before goal-runner

- **WHEN** personal setup `--ensure` returns `needs_adapter_choice` because multiple materialized adapters remain and no valid local choice exists
- **THEN** the agent SHALL complete adapter selection via the setup registry before starting a goal run

#### Scenario: Existing local adapter is not asked again

- **WHEN** personal setup `--ensure` returns a valid local `activeAdapter`
- **THEN** the goal-mode flow SHALL use it directly and MUST NOT construct a competing requested adapter or ask `setup.adapter`

### Requirement: Goal mode runs the shared assessment loop
The goal-mode skill SHALL repeatedly consume `assess@1`, enforce driver authorization, execute one recommended feature skill, and reassess until reconciled or fused. It MUST NOT maintain an independent next-phase decision table. Enforcement SHALL be defined in `skills/goal/goal-mode/SKILL.md` and `harness/scripts/assess.ts`.

#### Scenario: Assessment recommends an authorized phase
- **WHEN** goal mode is active, the recommendation is qualified, and authorization covers the phase
- **THEN** the skill SHALL execute that phase once and return to assess

### Requirement: Goal mode exposes two user-facing run modes

The skill SHALL expose only “有人在场” and “无人值守”. Explicit intent SHALL be reflected without another prompt; ambiguous intent SHALL use `skills/reference/confirmation-registry.yaml > goal.run_mode`; CLI `--detach` SHALL select unattended behavior. Attended prepare and attach commands SHALL declare `--run-mode attended`, and the attach entry MUST reject a missing or non-attended value before acquiring owner CAS. This flag is caller routing input only and MUST NOT be persisted in the manifest, identity, or a parallel declaration event.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: User explicitly requests unattended execution

- **WHEN** the request says the user is leaving or asks the goal to run unattended
- **THEN** the driver SHALL reflect the unattended interpretation and use `goal-runner --detach` without asking the run-mode question

#### Scenario: Ambiguous run mode uses the registry

- **WHEN** a fresh goal request does not establish whether someone will remain available
- **THEN** the skill SHALL resolve `goal.run_mode` before selecting attended `goal-mode-entry` or unattended `goal-runner --detach`

#### Scenario: Attended attach fails before ownership on a wrong declaration

- **WHEN** `goal-mode-entry` attach is invoked without `--run-mode attended` or with `--run-mode unattended`
- **THEN** it MUST fail before owner CAS and MUST NOT write a run-mode event

### Requirement: In-session autonomous phases use isolated context
An autonomous in-session goal SHALL execute each phase in a fresh phase-scoped context and return only structured outcome/evidence to the thin driver. Adapters without declared context isolation SHALL fall back to manual harness+assess.

#### Scenario: Adapter lacks phase isolation
- **WHEN** someone-present mode is requested on an adapter without in-session phase isolation
- **THEN** the framework SHALL use manual harness+assess and explain the effective behavior without exposing internal tier terminology

### Requirement: In-session execution writes canonical goal evidence

The attended entry SHALL create every fresh run through the shared fresh-only `createGoalRun` operation and the in-session driver SHALL attach only to a manifest with exactly one valid `run_created` event. It SHALL use the same manifest, events, progress, phase outcome, receipt, and run ID schemas as `harness/scripts/goal-runner.ts`, fenced by `run-control@1`. Before owner CAS, attach SHALL reject `CREATION_INCOMPLETE`, reject a caller adapter that differs from `manifest.adapter`, and route only from the persisted manifest; it MUST NOT fill a missing birth event, reparse workflow/chain, or resolve HEAD. Every emitted `phase_execute_request` SHALL include the authoritative `{run_id, phase, attempt_id, owner_id, owner_epoch}` captured from the current fence. The host SHALL pass that context unchanged to the spec initializer, phase harness, and `harness-runner --sync-closure`; the session driver SHALL create the attempt-bound receipt skeleton before yielding the request. Normal non-orphan session/process conversion SHALL use mailbox handoff; an orphaned session MAY be taken over only through explicit user-authorized `--force-resume` epoch takeover. A same unconsumed issued request whose deadline expired while its original fence remains current MAY be closed through existing agent_timeout semantics without takeover; no physical kill/settled or validation-priority fact SHALL be fabricated.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-run-creation.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: In-session run hands off to detached runner

- **WHEN** the handoff completes
- **THEN** the detached runner SHALL resume the same run ID, `run_created` birth facts and authoritative event sequence without ledger conversion or baseline refresh

#### Scenario: Bridge request carries a fenced closure identity

- **WHEN** the attended driver requests execution of any phase
- **THEN** its `phase_execute_request` SHALL include the current run, attempt, owner ID, and owner epoch; the host MUST NOT discover a run by scanning the feature directory or inherit context from a sibling shell process

#### Scenario: Wrong attach adapter fails before ownership

- **WHEN** the caller adapter differs from the persisted manifest adapter
- **THEN** attach SHALL fail before owner CAS with no owner mutation or event, and the session driver SHALL never observe the caller copy

#### Scenario: Incomplete creation cannot be repaired by attach

- **WHEN** attended attach finds a manifest without its one valid `run_created`
- **THEN** it MUST fail `CREATION_INCOMPLETE` before owner CAS and MUST NOT append a replacement event

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

### Requirement: Attended goal mode is a thin executor over the shared runtime

All attended complete delivery SHALL use the one GoalPhaseRuntime through the common issued-request/report transport. Native goal persistence MAY preserve or wake the host session but SHALL NOT select phases or sign completion independently. A task SHALL have only one active progression owner; immutable fenced context, retries, closure and ownership SHALL remain runtime-owned.

Enforcement: `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-phase-executor.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: Entries do not co-drive

- **WHEN** a feature has an active `/goal-mode` run
- **THEN** the native goal path SHALL refuse to advance the same feature and point to the running run

### Requirement: Shared runtime enforces attended authorization boundaries

`GoalPhaseRuntime` SHALL enforce the attended entry's existing `authorization`, `through_phase`, `leaseMs` and `maxRounds` inputs at safe phase boundaries before invoking an executor. Manual authorization MUST perform no agent invocation; batch authorization MUST stop before a phase beyond the authorized through-phase; and a single-round call MUST start at most one phase. These decisions MUST remain runtime-owned and MUST NOT be delegated to `AttendedGoalPhaseExecutor`.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-phase-executor.ts`

#### Scenario: Manual attended entry does not invoke an agent

- **WHEN** an attended run is entered with `authorization=manual`
- **THEN** the runtime returns at its phase boundary with zero executor invocations

#### Scenario: Batch entry stops at its authorized phase

- **WHEN** an attended batch run is authorized through a phase in the frozen chain
- **THEN** the runtime may complete that phase but MUST NOT start the following phase

#### Scenario: Single-round entry starts at most one phase

- **WHEN** `runInSessionRound` invokes the runtime with `maxRounds=1`
- **THEN** the runtime starts at most the current phase and returns before starting the next phase

### Requirement: Command-capable sessions share non-resident runtime handoff

Every materialized command-capable adapter with valid configuration SHALL use the same GoalPhaseRuntime through `goal-mode-entry --next` and `--report-result @<run-relative-JSON-file> --request <issued-path>`. Phase isolation SHALL only determine executor context. Missing required independent verifier or design-questioning capability SHALL retain its actual gap policy. New complete delivery SHALL NOT select runless or manual_fallback execution.

#### Scenario: Adapter lacks phase-context isolation
- **WHEN** attended mode is requested with valid configuration but false or absent isolation/reconcile flags
- **THEN** the same runtime SHALL issue the same handoff shape for main-context execution and disclose the context arrangement without waiving required independent verification

### Requirement: Equivalent fresh entries preserve the same birth defaults

The attended prepare entry and detached fresh entry SHALL use the same default unattended invocation-turn limit. For otherwise equivalent inputs, the mode used to create the run MUST NOT change `run_created.manifest_identity_hash`.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Bidirectional handoff sources are born through different entries
- **WHEN** equivalent session-source and process-source runs are created without an explicit invocation-turn limit
- **THEN** their unattended identity field and complete birth identity hash are equal before the handoff direction differs

### Requirement: Non-resident handoff has one production endpoint

`goal-mode-entry` SHALL expose mutually exclusive `--next` and `--report-result`, retain the programmatic callback API, and retire the public resident stdin loop. `--report-result @<run-relative JSON file>` SHALL read only the current request's designated result input within the same run, including UTF-8 BOM; inline JSON SHALL remain compatible. The generated command SHALL execute unchanged in Windows PowerShell 5.1, including paths containing spaces. Only that result input is executor-writable; immutable requests, archived reports and other run state SHALL remain runtime-owned. The runtime SHALL prepare full author instruction and original pre-write snapshot before committing a session phase_start request reference. CLI stdout SHALL contain only immutable request path/hash, phase/attempt, actual status, next command, gate timeout and cleanup reserve. Report identity SHALL derive from the issued request and current owner/epoch, not caller-invented tuples. A current HALTED or INTERRUPTED result SHALL expose its actual reason and nonzero exit code rather than an earlier phase halt or unconditional next command; normal dispatch and waiting SHALL retain zero CLI exit status.

#### Scenario: Request is re-acquired before report
- **WHEN** the issuing CLI exits and the session calls next again for an unconsumed request
- **THEN** it SHALL receive the same request without new attempt/count/snapshot; executor work SHALL continue from actual artifacts

#### Scenario: An accepted report is retried after gate interruption
- **WHEN** report has been archived but the formal gate or finalizer has not completed
- **THEN** runtime SHALL verify old gate process termination/containment and resume only missing validation, never call the author again or fabricate agent_process_settled

#### Scenario: The host needs a long gate command
- **WHEN** formal verification exceeds a short shell default
- **THEN** the host SHALL set timeout from current gate timeout plus cleanup reserve or await the same native task handle through terminal state, without repeated report submissions or custom polling

### Requirement: Host goal persistence preserves the single runtime

Native goal persistence MAY preserve or wake a host session but SHALL NOT establish another phase-selection or completion loop. Executors SHALL read the original issued instruction, use its exact self-check/closure commands and return actual outcomes. Hosts SHALL use available phase isolation truthfully; required independent verification SHALL remain genuinely independent. Native long-task handle waiting SHALL be permitted; custom sleep, event polling and background waiters SHALL remain forbidden. Verifier inputs SHALL NOT change while verification is running.

#### Scenario: Main-context execution retains independent verification
- **WHEN** phase isolation is unavailable but a required verifier can run independently
- **THEN** author work SHALL run in the main context and required verification SHALL run through the real independent context/provider

### Requirement: Fresh delivery uses the existing design handoff

The main Agent SHALL honor the fresh design handoff in `complex-capability-meta-model` before starting Goal. A preparation result SHALL be consumed in the same authorized session: component-design, public CU acceptance/readiness, existing P2 selection and scope preparation, then the chosen attended or detached entry. Initial design SHALL remain in the main Agent/Skill; host bridge attachment SHALL NOT acquire a run-birth design callback. User departure SHALL select detached execution only after ready CU handoff, retaining existing confirmations and budget accounting.

#### Scenario: Fresh delivery respects the existing handoff boundary

- **WHEN** a design-lens new complete delivery returns a design preparation result
- **THEN** the authorized main Agent SHALL complete the design handoff in the same session before starting the selected ready CU in attended or detached mode

### Requirement: Automation authority is independent of execution transport

主 Agent SHALL 从可信原用户请求及更正判断完整交付全权授权；attended prepare 和每次控制调用 SHALL 显式重传非持久 `--authorize-autonomy`，不新增持久授权位。缺省 never/goal_mode、日志、打印命令和 Agent 自写决定 SHALL NOT 授权。新会话 SHALL 先恢复仍有效原授权，只有不可恢复或冲突才澄清，不重复询问已授权用户。detached SHALL 保留用户选择无人值守完整交付的既有原目标内设计修订授权。原目标内设计/CU/必要架构修订 SHALL 仍由设计 owner 草稿、独立质询、检查、发布及重绑。

完整交付且明确不要询问时，主 Agent MAY 经现有 manifest/`--override-manifest` 显式提高默认额度；prepare 与控制入口 SHALL 透传覆盖，先核全部 manifest 差异。预算单独批准 SHALL NOT 授设计全权；用户总时间/轮次/费用上限 SHALL 不突破，累计 SHALL 不清零，无进展守卫 SHALL 不解除，runner SHALL NOT 自动循环提额。最终 SHALL 披露来源、前后额度及累计消耗。

#### Scenario: Re-entry preserves prior human authority without inferring it from records
- **WHEN** a new attended control invocation lacks autonomy input but the main Agent can recover the still-valid original grant
- **THEN** the main Agent SHALL retransmit the input from that grant instead of asking again or treating printed output as a credential

#### Scenario: Budget-only approval
- **WHEN** the user approves only a budget change
- **THEN** existing override semantics MAY apply but design authority SHALL remain unchanged
