# Delta: Harness Gates — Personal setup pre-phase

## ADDED Requirements

### Requirement: Personal setup gate covers catalog and glossary

`harness-runner` MUST evaluate personal setup before feature phases including
`catalog` and `glossary`. Exempt phases MUST be limited to `init` and `docs`.

#### Scenario: catalog phase requires personal setup
- **WHEN** harness-runner runs with `--phase catalog` and personal setup is incomplete
- **THEN** the runner exits non-zero before script harness unless internal init exempt applies

> **Enforced by:** `harness/harness-runner.ts`

### Requirement: Init internal global phases may bypass personal gate

When `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1` is set, `harness-runner` MUST skip
personal setup gate **only** for `catalog` and `glossary` phases spawned from
`run-global-phases`. Other phases (e.g. `prd`, `coding`) MUST still run the gate
even if the env is set. This env MUST NOT be documented for ordinary phase entry.

#### Scenario: run-global-phases after init succeeds without local json
- **WHEN** `init-task-executor` runs `run-global-phases` with `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`
- **THEN** catalog/glossary/docs harness invocations proceed without personal gate failure

> **Enforced by:** `harness/scripts/utils/init-task-executor.ts`, `harness/harness-runner.ts`

### Requirement: check-personal-setup ensure mode

`check-personal-setup.ts --ensure` MUST deterministically ensure personal setup:
auto-write local when exactly one materialized adapter with entry exists;
return `needs_adapter_choice` when multiple; `no_materialized_adapter` when none.

#### Scenario: single materialized adapter auto ensured
- **WHEN** `--json --ensure` runs with fallback status and one materialized adapter with entry file
- **THEN** JSON has `ok: true`, `ensured: "auto_single_adapter"`, and `framework.local.json` is written

#### Scenario: zero materialized adapters
- **WHEN** `--json --ensure` runs with fallback and empty `materialized_adapters`
- **THEN** JSON has `ok: false`, `code: "no_materialized_adapter"`, no local file written

> **Enforced by:** `harness/scripts/check-personal-setup.ts`, `harness/scripts/utils/personal-setup-gate.ts`
