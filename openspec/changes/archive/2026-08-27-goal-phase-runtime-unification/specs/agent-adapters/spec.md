## ADDED Requirements

### Requirement: Goal executors encapsulate agent invocation only

A `GoalPhaseExecutor` SHALL accept an immutable `PhaseExecutionContext` and return a normalized agent invocation result. The detached executor MAY implement adapter spawn, containment, timeout, stdout/stderr, structured events and usage capture; the attended executor MAY implement the existing host callback transport. Neither executor MUST own assessment, runtime fact preparation, harness gate calls, verdict, backtrack, close, handoff policy or event-ledger advancement.

Enforcement: `harness/scripts/utils/goal-phase-executor.ts`, `harness/scripts/utils/goal-adapter-spawn.ts`, `harness/scripts/goal-in-session-driver.ts`, `agents/*/adapter.yaml`

#### Scenario: Adapter output is returned to the runtime

- **WHEN** the detached adapter process exits or times out
- **THEN** its executor SHALL return the normalized invocation result to `GoalPhaseRuntime` and MUST NOT directly emit a canonical phase verdict or call the harness gate

### Requirement: Device provider internals stay outside phase execution context

`PhaseExecutionContext` SHALL preserve the existing testing provider boundary and MUST NOT expose Hylyre vendor/source build layout, `.hylyre/build-src`, `vendor_artifact_kind`, provider installation state or other provider-private telemetry as canonical lifecycle or runtime ownership facts.

Enforcement: `harness/scripts/utils/goal-phase-executor.ts`, `harness/scripts/utils/goal-phase-runtime.ts`, `profiles/hmos-app/harness/*`

#### Scenario: Testing executor sees no vendor lifecycle state

- **WHEN** a testing phase uses the Hylyre device provider
- **THEN** the runtime SHALL invoke the existing harness/provider boundary and the executor context MUST NOT contain provider-private installation or vendor fields
