## MODIFIED Requirements

### Requirement: Attended phase entry validates explicit goal context

An attended `phase_execute_request` SHALL carry its authoritative `{run_id, phase, attempt_id, owner_id, owner_epoch}`. The spec Skill SHALL pass that exact context explicitly to `fidelity-intent-init`, the phase `harness-runner`, and `harness-runner --sync-closure`. All entries MUST use one shared validator before side effects to resolve the exact manifest/run-control, assert the captured owner fence, and verify matching feature, phase, current `session/active` owner, and unexpired lease. Validation failure MUST exit as a BLOCKER before SSOT write, closure write, or goal environment injection. After validation, the harness SHALL inject the existing run/attempt/phase orchestration environment plus `MAISON_GOAL_GATE_HARNESS=1`, so it is a formal gate rather than agent-side; attended closure SHALL finish through the explicit sync-closure entry without a detached runner replay.

Enforcement: `skills/feature/spec/SKILL.md`, `harness/scripts/fidelity-intent-init.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/goal-run-control.ts`

#### Scenario: Wrong feature cannot borrow a live run

- **WHEN** either CLI receives a `--goal-run-id` whose manifest feature differs from `--feature`
- **THEN** it MUST fail before writing fidelity SSOT or setting goal orchestration environment

#### Scenario: Expired attended owner cannot authorize phase work

- **WHEN** the exact run has a missing, non-session, non-active, or expired owner lease
- **THEN** both CLI entries MUST fail closed with the same validation contract

#### Scenario: Valid attended context activates existing consumers

- **WHEN** an attended harness command validates the captured session fence
- **THEN** existing goal consumers SHALL observe run/attempt/phase and formal gate authority, `isAgentSideGoalHarness()` SHALL be false, `.current-phase.json` writes SHALL remain suppressed, and visual/device writers SHALL select their formal path

#### Scenario: Delayed old-epoch request is rejected

- **WHEN** a phase request captured under owner epoch N reaches initializer, harness, or sync closure after epoch N+1 has attached
- **THEN** that entry SHALL fail before writing or borrowing the new owner, even though the run ID still matches

#### Scenario: Attended receipt closes without a detached runner

- **WHEN** the phase fills its attempt-bound receipt and invokes the context-bound `harness-runner --sync-closure`
- **THEN** receipt validation and closure finalization SHALL use the same attempt identity and produce a formally closed phase without journal replay by `goal-runner`
