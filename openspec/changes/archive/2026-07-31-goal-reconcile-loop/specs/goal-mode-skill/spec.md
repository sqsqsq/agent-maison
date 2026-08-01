## ADDED Requirements

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
