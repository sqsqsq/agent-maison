## ADDED Requirements

### Requirement: Unsupported attended autonomy returns the documented manual route

The attended host entry SHALL evaluate the existing adapter capability route before autonomous runtime progression. When the route is manual, it MUST return `manual_fallback` with a user-facing reason and perform zero autonomous agent, gate or lifecycle invokes; it MUST NOT throw an unprojected preflight exception.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-adapter-capability.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: Adapter lacks phase-context isolation
- **WHEN** attended mode is requested for an adapter without `in_session_reconcile` and `phase_context_isolation`
- **THEN** the host returns manual harness+assess fallback and does not enter `GoalPhaseRuntime`

### Requirement: Equivalent fresh entries preserve the same birth defaults

The attended prepare entry and detached fresh entry SHALL use the same default unattended invocation-turn limit. For otherwise equivalent inputs, the mode used to create the run MUST NOT change `run_created.manifest_identity_hash`.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Bidirectional handoff sources are born through different entries
- **WHEN** equivalent session-source and process-source runs are created without an explicit invocation-turn limit
- **THEN** their unattended identity field and complete birth identity hash are equal before the handoff direction differs

### Requirement: Attended stdio has one protocol endpoint

`goal-mode-entry` SHALL be the sole production stdio endpoint that constructs `phase_execute_request`, reads its response and validates response identity. `GoalPhaseRuntime` MUST receive an injected attended executor and MUST NOT construct a second implicit request payload.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-phase-executor.ts`

#### Scenario: Attended runtime is invoked without a host executor
- **WHEN** code requests attended execution directly from `GoalPhaseRuntime` without an injected executor
- **THEN** startup fails before owner progression instead of exposing another stdio protocol shape
