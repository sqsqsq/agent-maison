## ADDED Requirements

### Requirement: Integrity blockers classify as framework_integrity_block and halt on first touch

When a fresh harness summary contains any blocker with `blocking_class === 'integrity'`, the goal-runner SHALL classify the failure as `framework_integrity_block`, collect `integrity_subtypes[]` from ALL such blockers' `classification` values (deduplicated; top-level `summary.failure_kind` fallback only when the list is empty AND `summary.blocking_class === 'integrity'`), and halt on first touch. Guidance SHALL be assembled per subtype (drift → human-named `drift_allowlist` / restore / upstream; foreign_file → cleanup or human allowlist; manifest_corrupt/empty → reinstall or restore from release; manifest_tampered → restore from release, manual recompute forbidden; manifest_sidecar_missing → framework-init UPDATE, agent hand-writing forbidden). The retry prompt SHALL NOT contain repair instructions for this kind: goal agents are forbidden from any automated write (including reverts) to framework release files.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Host hotfix drift is not auto-reverted

- **WHEN** a plan-phase harness run reports 7 drifted framework files (host-applied fixes) with a fresh summary
- **THEN** the run SHALL halt with `framework_integrity_block` and per-subtype guidance instead of feeding a "revert first" retry prompt to the goal agent

#### Scenario: Coexisting subtypes are all surfaced

- **WHEN** a summary contains `framework_manifest_sidecar_missing`, `framework_drift`, and `framework_foreign_file` blockers simultaneously
- **THEN** `integrity_subtypes` SHALL contain all three values and the halt guidance SHALL list each remediation in repair order (manifest anchor first)

### Requirement: Timeout attribution follows the freshness decision table

For a timed-out attempt the classifier SHALL apply, in order: stale summary → `agent_timeout`; fresh summary containing any integrity blocker → `framework_integrity_block`; fresh summary with a non-empty blocker set consisting entirely of `framework_bug` → `framework_bug`; otherwise (mixed or content-only) → `agent_timeout`. The all-framework_bug branch SHALL require `blockers.length > 0`.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Fresh integrity evidence is not masked by timeout

- **WHEN** an attempt is tree-killed at its timeout budget and the post-kill harness summary (stale_summary=false) contains a framework_drift blocker
- **THEN** classification SHALL be `framework_integrity_block` (halt) rather than `agent_timeout` (free retry)

### Requirement: Retry prompts carry continuation context decoupled from the content-retry budget

The runner SHALL derive `continuation: {cause, process_resumed} | null` from the current phase's most recent attempt window (no invoke_start → null; start without end → unknown; end with timed_out=true and no verdict → agent_timeout; end without verdict → unknown; verdict present → its classified cause), independent of the `retries` counter. Whenever `continuation !== null`, the prompt SHALL include prior-failure evidence and/or the timeout/API-drop resume block (partial artifacts, checkpoint skip-list, effective budget), with block wording matched to the cause. A PASS+timeout prior attempt SHALL still produce the resume block. `harness_start`/`harness_end`/`phase_verdict` events SHALL carry `invoke_id`; legacy logs without it SHALL be windowed by event order.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: Timeout retry is no longer a cold start

- **WHEN** an attempt times out and the runner retries in-process (retries counter unchanged per the free-retry policy)
- **THEN** the new prompt SHALL contain the timeout resume block with partial artifacts and skip-lines

#### Scenario: Resume into a fresh phase injects nothing

- **WHEN** the runner restarts with --resume and the current phase has no historical agent_invoke_start
- **THEN** continuation SHALL be null and the prompt SHALL contain no continuation blocks

### Requirement: Wall-clock budget is a hard deadline across all paths

The runner SHALL enforce `wallDeadlineMs = wallClockStartMs + wallClockBudgetMs` across agent invokes, harness runs, and transient backoff sleeps. Both agent and harness SHALL NOT be started when `deadline - now - FINALIZE_RESERVE_MS <= 0` (a computed timeout of 0 must never reach a timer, since 0 disables it); a backoff sleep SHALL NOT be started when the remaining budget cannot fit the configured backoff (terminate with `budget_wall_clock` instead of sleeping a truncated remainder). Windows process-tree kill SHALL be asynchronous and bounded (execFile taskkill.exe without shell, bounded wait, helper killed and stdio destroyed on timeout, `kill_process_tree_timeout` reported), and any kill on the agent/harness paths SHALL be paired with `armForceSettleAfterKill` so a failed kill still settles within the force-settle window. The kill grace used in the acceptance bound SHALL be derived from the actual termination contract constants (all four: child settle grace, force settle after kill, kill tree wait, inflight drain) via a single `resolveKillGraceMs()`. On the agent/harness/backoff paths, total runtime SHALL NOT exceed the wall limit plus `resolveKillGraceMs()`.

Post-run_end finalization (completion receipt etc.) is **pre-check-gated best-effort**, not part of the hard bound: it consists of synchronous filesystem work for which no in-process executable bound exists (a sync hang also blocks any in-process watchdog; hard-killing mid-write corrupts receipts; moving it to a killable worker process is the only true bound and is deliberately out of scope — recorded as plan d9b4f7e2 open item 5 / rev8 deviation ①). It SHALL be skipped entirely (`finalize_skipped`) when the deadline has already passed before it starts, and any overrun of an already-started finalization SHALL be recorded honestly via a `finalize_overrun` event carrying the finalization duration (feeding FINALIZE_RESERVE_MS calibration).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: Zero effective budget prevents agent start

- **WHEN** raw wall remaining is positive but `deadline - now - FINALIZE_RESERVE_MS <= 0`
- **THEN** the runner SHALL NOT build a prompt, write agent_invoke_start, or invoke the adapter, and SHALL end the run with `budget_wall_clock`

#### Scenario: Hung taskkill cannot unbound the wall

- **WHEN** the taskkill helper never exits during a tree-kill
- **THEN** the bounded kill SHALL terminate the helper, release its handles, report `kill_process_tree_timeout`, and the runner SHALL still exit within the derived grace

### Requirement: Consecutive timeouts escalate once then halt

The runner SHALL count consecutive `agent_timeout` outcomes per phase from the events log (signature-independent, including PASS+unclosed). After the second consecutive timeout the next attempt's base timeout SHALL be escalated ×1.5 (default-table-derived values only; explicit overrides untouched). A third consecutive timeout SHALL halt with `agent_timeout_repeated` and guidance including per-attempt durations. The effective timeout of every attempt SHALL be computed before prompt construction and recorded as `effective_timeout_ms` on `agent_invoke_start`; progress/status/dead-man consumers SHALL prefer the event value over manifest re-resolution (manifest as legacy fallback).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Escalated attempt is not reported stalled

- **WHEN** the runner escalates an attempt's timeout to 1.5× the default
- **THEN** progress liveness SHALL judge staleness against the event-recorded effective timeout, not the manifest-derived base value
