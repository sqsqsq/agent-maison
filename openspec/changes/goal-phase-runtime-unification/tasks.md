## 1. Runtime contracts and detached extraction

- [ ] 1.1 Define immutable `PhaseExecutionContext`, normalized executor result and thin `GoalPhaseExecutor` interface without provider-private fields.
- [ ] 1.2 Extract `DetachedGoalPhaseExecutor` around existing adapter spawn, containment, timeout and output capture with behavior-equivalent tests.
- [ ] 1.3 Implement production `projectCanonicalLifecycle` with complete canonical event mapping, normalization and executor-telemetry exclusions.

## 2. Shared phase boundary

- [ ] 2.1 Introduce `GoalPhaseRuntime` owner/epoch checks, assess, attempt/phase_start and runtime-owned fact preparation around a supplied executor.
- [ ] 2.2 Move receipt scaffold, harness gate, verdict, retry/backtrack and closure/run-end transitions behind the shared runtime boundary.
- [ ] 2.3 Route detached coding through the runtime and prove single-phase canonical/gate/precondition parity before expanding migration.

## 3. Full phase and replay migration

- [ ] 3.1 Route every workflow-derived full/lite/custom phase through `GoalPhaseRuntime` without hard-coded phase ownership.
- [ ] 3.2 Migrate retry and resume replay to the shared runtime and compare canonical projection, baseline, facts, backtrack and close behavior.
- [ ] 3.3 Implement `AttendedGoalPhaseExecutor` over the existing stdio callback and remove attended assess/gate/advance ownership.

## 4. Handoff and deletion

- [ ] 4.1 Route session→process handoff through the shared safe boundary and project normalized owner handoff semantics.
- [ ] 4.2 Route process→session handoff through the same boundary and cover stale/failed transfer fencing.
- [ ] 4.3 Prove supervisor stays process-owner-only and executor/supervisor argv never includes management rebaseline.
- [ ] 4.4 After all parity tests pass, physically delete the goal-runner private phase loop and any remaining attended independent progression/direct-gate path.

## 5. Matrix, docs and verification

- [ ] 5.1 Add structural zero assertions for one loop, zero executor gate calls, zero private driver advancement and no Hylyre/vendor fields in runtime context.
- [ ] 5.2 Add attended/detached fresh/retry/resume/bidirectional-handoff/successor lifecycle parity tests consuming only production birth/runtime/projection APIs.
- [ ] 5.3 Update goal-mode operations/skill documentation; confirm no additional consumer migration beyond the M1 `MIGRATION.md` entry.
- [ ] 5.4 At each migration rung run typecheck, targeted runtime tests and parity tests; after deletion run `cd harness && npm test`, strict OpenSpec validation and `npm run release:verify -- --skip-typecheck`.
