## Context

The framework already shares run-control owner/epoch/CAS and an atomic handoff mailbox, but lifecycle execution remains duplicated. `goal-runner.ts` owns the detached phase loop, adapter spawning and many runtime facts; `goal-in-session-driver.ts` independently assesses and advances phases around a host `phase_execute_request`. The attended incident proved that a fact attached to one loop can be absent from the other even when both write the same run schema.

This refactor lands after the run birth contract so phase execution consumes an immutable manifest baseline. It must coexist with workflow-derived full/lite/custom chains, existing owner fencing, replay fixes, repair/backtrack rules and device-provider internals.

## Goals / Non-Goals

**Goals:**

- Put every canonical phase transition and runtime-owned precondition behind one `GoalPhaseRuntime`.
- Reduce attended and detached mode to two implementations of a thin agent invocation interface.
- Prove parity over complete canonical lifecycle projections, including bidirectional handoff.
- Physically remove both private advancement loops before the change is complete.

**Non-Goals:**

- No new run state, event ledger, owner/lease system, adjudication path, phase enum or persistent parity artifact.
- No changes to adapter provider internals, Hylyre source/vendor/install state or gate verdict semantics.
- No rewrite of run-control/mailbox ownership or supervisor process ownership.

## Decisions

### 1. GoalPhaseRuntime owns the lifecycle; GoalPhaseExecutor owns only invocation

`GoalPhaseExecutor.execute(context)` receives an immutable `PhaseExecutionContext` and returns a normalized invocation result. `AttendedGoalPhaseExecutor` bridges the existing stdio request/response; `DetachedGoalPhaseExecutor` wraps the existing adapter spawn, hard timeout, stdout/stderr/event and usage capture behavior.

`GoalPhaseRuntime` alone performs fenced owner checks, phase assessment, attempt allocation, `phase_start`, preparation of runtime facts/env, receipt scaffold, executor call, harness gates, verdict projection, retry/backtrack, closure finalization, run end and handoff. Passing gate callbacks into executors was rejected because it preserves the split ownership under a new interface.

### 2. One shared boundary with explicit, immutable context

The runtime constructs one frozen context per attempt containing run/manifest identity, resolved workflow/track/chain, phase/attempt, owner fence, paths, adapter identity, applicable runtime facts and a scrubbed child env. Executor-visible data is limited to what the agent invocation needs; device provider output and Hylyre internal metadata remain behind the existing testing harness API.

The runtime rechecks owner/epoch before each mutating boundary and after executor return. A stale executor result cannot write gate, verdict or closure state.

### 3. Preserve the events ledger and add a pure canonical projection

No new canonical event store is introduced. `projectCanonicalLifecycle(events)` is a production pure function over existing events. It includes `run_created`, `phase_start`, `phase_verdict`, `phase_halt`, `phase_backtrack_requested`, normalized `owner_handoff {from,to,outcome}`, and `run_end`. Timestamp, PID, owner/invoke identifiers and epoch numbers are normalized. Adapter/transport/lease telemetry is excluded.

The projection maps raw mailbox/owner events into the semantic handoff record rather than requiring tests to maintain a selected raw-event list. This gives status/replay code the same semantic surface used by parity tests.

### 4. Handoff stays a fenced owner transition inside the runtime

Session→process and process→session use the existing mailbox, release/acquire CAS and epoch fence. The shared runtime pauses only at a safe phase boundary, emits one semantic handoff outcome, and the new owner replays the same run before advancing. The supervisor remains process-owner-only and never becomes a phase adjudicator.

### 5. Migrate by parity ladder, then delete

The migration order is: extract detached executor without behavior changes; introduce shared boundary; route coding through the runtime; route all phases; compare retry/resume; exercise both handoff directions; verify canonical lifecycle parity; delete the detached private loop and attended advancement logic. During the ladder, an internal compatibility adapter may call the old block for comparison, but no release/archive is permitted while both loops remain.

Feature flags or a persistent mode selector were rejected because they would turn temporary migration state into a second runtime truth.

## Risks / Trade-offs

- [Large extraction changes incidental behavior] → Move existing blocks behind interfaces first, then switch one phase at a time with typecheck, target tests and canonical parity.
- [Executor result arrives after ownership changes] → Fence before and after invocation; stale results are discarded without gate or event mutation.
- [Projection hides a canonical event] → Define the production allowlist semantically, assert complete known canonical coverage and exclude only named executor telemetry families.
- [Testing provider state leaks into runtime] → Keep `harness-runner`/profile APIs as the boundary and add type/structure tests forbidding Hylyre/vendor fields in `PhaseExecutionContext`.

## Migration Plan

1. Extract context/result types, canonical projection and detached executor with existing behavior tests.
2. Introduce `GoalPhaseRuntime` and migrate coding, then all phases.
3. Migrate resume/retry and both handoff directions.
4. Remove private loops and add structural zero assertions.
5. Run the full lifecycle matrix and archive only with one remaining loop.

Rollback is permitted only before archive/release and restores the previous internal calls; persisted manifest/events schemas remain readable because the runtime continues using them.

## Open Questions

None. The provider boundary and migration order are frozen by the master plan.
