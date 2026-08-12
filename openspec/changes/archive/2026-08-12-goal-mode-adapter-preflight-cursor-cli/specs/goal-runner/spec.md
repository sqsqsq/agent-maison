## MODIFIED Requirements

### Requirement: Goal runner preflight blocks invalid adapter capability

The system SHALL BLOCKER-fail preflight when `goal_capability` is missing, `unattended` contract is incomplete, `manifest.adapter` is not materialized, adapter entry artifacts are missing, headless CLI is not resolvable, or adapter provenance is `fallback` (no personal setup and no explicit/manifest adapter source).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`, `agents/adapter-schema.yaml`

#### Scenario: Missing goal_capability at runner start

- **WHEN** goal-runner starts with an adapter lacking `goal_capability`
- **THEN** preflight exits non-zero before any agent invocation

#### Scenario: Explicit adapter bypasses fallback personal-setup guard

- **WHEN** user invokes goal-runner with `--adapter cursor`, cursor is in `materialized_adapters`, and entry artifacts exist, without `framework.local.json`
- **THEN** preflight passes and runner may start (headless CLI resolvability still enforced)

#### Scenario: Fallback provenance blocks without personal setup

- **WHEN** goal-runner starts without `--adapter`/`--manifest`/`--resume`, no `framework.local.json`, and provenance resolves to `fallback`
- **THEN** preflight exits non-zero with guidance to run `check-personal-setup --ensure`

#### Scenario: Manifest resume provenance not blocked by missing local

- **WHEN** user invokes goal-runner with `--resume <run-id> --feature <f>` and manifest.adapter is materialized
- **THEN** preflight does not fail solely because `framework.local.json` is absent

## ADDED Requirements

### Requirement: Cursor headless invoke uses cursor-agent or agent with positional prompt

The system SHALL invoke Cursor goal phases via `cursor-agent` (fallback `agent`) with `-p`, passing the phase prompt as a positional argv element; it SHALL NOT use `cursor agent --print`. On Windows `.cmd` shims it SHALL use `cross-spawn` for spawn.

Enforcement: `harness/scripts/utils/agent-invoke.ts`, `agents/cursor/adapter.yaml`, `harness/package.json`

#### Scenario: Cursor plan uses positional prompt in argv

- **WHEN** goal-runner resolves headless plan for adapter `cursor`
- **THEN** invoke plan passes prompt as the final argv element (not via shell string concatenation)

#### Scenario: Headless CLI PATH check for structured adapters

- **WHEN** goal-runner preflight runs for adapter `claude`, `codex`, or `cursor`
- **THEN** preflight BLOCKER-fails if the headless binary is not resolvable on PATH
