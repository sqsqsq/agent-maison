# goal-runner Specification

## Purpose
TBD - created by archiving change tool-agnostic-goal-runner. Update Purpose after archive.
## Requirements
### Requirement: Goal runner orchestrates feature phases deterministically

The system SHALL provide `harness/scripts/goal-runner.ts` that executes an ordered list of feature phases between `start_phase` and `end_phase`, invoking the configured agent headlessly per phase with fresh context, then running `harness-runner.ts` for each phase.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-transition-policy.ts`

#### Scenario: Happy path advances through chain

- **WHEN** each phase harness returns verdict PASS
- **THEN** runner advances to the next phase until `end_phase` completes and writes goal-report with status COMPLETED

#### Scenario: External block defers and continues when allowed

- **WHEN** a phase returns verdict INCOMPLETE with deferrable `blocking_class` or `failure_kind` per `dependency_policy`
- **THEN** runner records phase as DEFERRED, continues if policy allows, and final goal status is DEFERRED or PARTIAL (never COMPLETED)

### Requirement: Goal run evidence layer

The system SHALL persist each run under `goal-runs/<run-id>/` with `manifest.json`, `events.jsonl`, per-phase artifacts, and final `goal-report.{md,json}`.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-report-generator.ts`

#### Scenario: Resume uses run evidence

- **WHEN** user invokes goal-runner with `--resume <run-id>`
- **THEN** runner loads manifest from `goal-runs/<run-id>/manifest.json` and continues from last incomplete phase

### Requirement: Goal runner preflight blocks invalid adapter capability

The system SHALL BLOCKER-fail preflight when `goal_capability` is missing or `unattended` contract is incomplete for the active adapter.

Enforcement: `harness/scripts/goal-runner.ts`, `agents/adapter-schema.yaml`

#### Scenario: Missing goal_capability at runner start

- **WHEN** goal-runner starts with an adapter lacking `goal_capability`
- **THEN** preflight exits non-zero before any agent invocation

