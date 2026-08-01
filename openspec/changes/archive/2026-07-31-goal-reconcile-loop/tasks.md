## 1. Dependency and Capability Foundation

- [x] 1.1 Verify `skill-contracts-assess` has frozen compatible `assess@1`, contract schema, and summary 1.2 artifacts before implementation
- [x] 1.2 Extend adapter schema and capability loader for in-session reconciliation, phase isolation, resume, and handoff declarations
- [x] 1.3 Add conservative compatibility routing and tests for legacy, unsupported, attended, unattended, and handoff adapter paths

## 2. Runner Observation Boundary

- [x] 2.1 Define the versioned `ReconcileObservation@1` schema and TypeScript types
- [x] 2.2 Extract phase outcome, blocker actionability, deterministic defects, budgets, repeated fingerprints, invalidation sets, and execution signals from goal-runner state/events
- [x] 2.3 Route current runner action selection through the extracted boundary without changing behavior
- [x] 2.4 Add and register fixtures that lock existing events, verdicts, backtracks, retries, halts, and terminal sequences
- [x] 2.5 Extract the remaining cross-phase decision ladder and authoritative event emission behind a dedicated runner boundary

## 3. Persistent Run Control and Fencing

- [x] 3.1 Add persistent `run-control@1` storage with atomic read/write and expected-epoch CAS under each authoritative run directory
- [x] 3.2 Integrate common epochs with process owners while preserving PID/hostname liveness and existing lock behavior
- [x] 3.3 Add session-owner leases, renewal, orphaned-session transition, and explicit takeover/force-resume behavior
- [x] 3.4 Add fenced boundary guards for assess, phase invoke, harness/finalizer, events, progress, and terminal writes
- [x] 3.5 Add tests for epoch persistence after release, racing takeovers, expired sessions, stale-owner writes, and process-lock compatibility

## 4. Handoff Mailbox

- [x] 4.1 Add atomic run-bound handoff request storage with request/run/epoch/target identity and idempotent consumption
- [x] 4.2 Add detached-runner phase-boundary polling, quiescing, owner-authored events, and projection release
- [x] 4.3 Add new-owner CAS acquisition and require `handoff_accepted` before phase execution
- [x] 4.4 Add bidirectional and failure fixtures for duplicate/stale requests, crash between release/acceptance, and split-brain rejection

## 5. In-Session Goal Driver

- [x] 5.1 Rewrite goal-mode skill around the assess/authorize/execute/reassess loop and remove independent next-phase tables
- [x] 5.2 Add user-facing attended/unattended intent routing, confirmation-registry entry, per-round status, and waiting-item output
- [x] 5.3 Add phase-isolated context execution with structured outcomes and manual fallback when adapter capability is absent
- [x] 5.4 Add in-session writers for the existing goal manifest/events/progress schemas under fencing
- [x] 5.5 Add in-session happy-path, human-wait, capability-fallback, and handoff-to-detached fixtures
- [x] 5.6 Wire `runInSessionRound` into the production goal-mode entry path so the skill trigger reaches the in-session driver

## 6. Headless Runner Rewire

- [x] 6.1 Replace cross-phase runner action selection with the assess-driven loop while retaining driver authorization
- [x] 6.2 Preserve timeout, budget, backoff, cleanup, trust, pass-snapshot, device, write-guard, monitor, usage, and detach behavior
- [x] 6.3 Remove or guard legacy inline next-phase decisions and add consistency checks against decision-table regrowth
- [x] 6.4 Run full runner fixtures and compare event/verdict/terminal behavior with the boundary baseline

## 7. Documentation and Verification

- [x] 7.1 Update goal-mode runbook, reconcile-loop and phase-transition concepts, adapter documentation, and operations terminology
- [x] 7.2 Update `MIGRATION.md` for goal-mode semantics, capability declarations, run-control state, and handoff behavior
- [x] 7.3 Run `cd harness && npm test` and fix all runtime-SSOT regressions
- [ ] 7.4 Run `npm run openspec:validate`, `node scripts/check-plan-version.mjs`, and `npm run release:verify`
