## ADDED Requirements

### Requirement: Unified AGENTS.md.template rendering

The system SHALL render `framework/templates/AGENTS.md.template` through a single
shared module (`harness/scripts/utils/template-renderer.ts`) for both the
`render-agents-md` CLI and init adapter entry materialization (`check-init` /
`init-task-executor`). After rendering, the system MUST assert that no
`{{UPPER_SNAKE_CASE}}` placeholders remain.

The architecture summary placeholder `ARCHITECTURE_SUMMARY` MUST use DSL reference
wording (referencing `cross_module_exports_file`) and MUST NOT inline the config
file value (e.g. `Index.ets`) as the summary text.

#### Scenario: No unreplaced placeholders after init materialize
- **WHEN** init S3 materializes `CLAUDE.md` or `AGENTS.md` from the shared template
- **THEN** the rendered file MUST NOT contain `{{EXTENSION_SKILL_SECTION}}` or any
  other template placeholder tokens

#### Scenario: render-agents-md CLI without --summary
- **WHEN** `render-agents-md.ts` runs with `--entry-file` and `--out` but omits `--summary`
- **THEN** it MUST compute `ARCHITECTURE_SUMMARY` from `config.architecture` using the
  same DSL-reference style as the init path
- **AND** MUST exit zero when rendering succeeds

### Requirement: Two-phase init execution context derivation

For `--execute`, the orchestrator SHALL derive execution context in two phases:

1. **Planning phase** (`deriveBaseContextForPlanning`): strip staging reserved
   fields; run `validateMaterializedAdaptersCrossCheck` on pre-sync context;
   then `syncDecisionAdaptersIntoContext` from `decision.materialized_adapters`
   (decision is SSOT); then `withInitContextDefaults`.
2. **Execution phase** (`deriveContextForExecution`): after `InitTaskPlan` is known,
   if `plan.mode` is `update` and `configWritePayload` is absent, derive minimal
   payload from disk (`project_name`, `project_profile`, `architecture` only);
   `materialized_adapters` MUST come from `decision.materialized_adapters` via sync.

Preflight and `executeInitPlan` MUST receive the same `finalContext` object from
phase 2.

#### Scenario: UPDATE execute without S2 configWritePayload uses disk minimal payload
- **WHEN** `--execute` runs in UPDATE mode with legal decision and empty
  `context.configWritePayload`
- **THEN** preflight MUST pass when disk `framework.config.json` contains required
  architecture fields
- **AND** executor MUST write config using the same derived payload as preflight

#### Scenario: CREATE missing configWritePayload still blocked
- **WHEN** `--execute` runs in CREATE mode without `configWritePayload` and
  `ensure-config` resolves to a write action
- **THEN** preflight MUST fail atomically without project business writes

#### Scenario: Adapter cross-check before sync
- **WHEN** staging `context` lists `materializedAdapters` that disagree with
  `decision.materialized_adapters` before sync
- **THEN** execute MUST fail with blocked run-log before `executeInitPlan`
- **AND** MUST NOT overwrite context adapters silently

### Requirement: UPDATE emit staging prefill

The system SHALL pre-fill emitted `context.configWritePayload` with minimal semantic
fields from disk (`project_name`, `project_profile`, `architecture` only) when
`--emit-staging-template` runs for `plan.mode === update`. The emitted payload MUST
NOT include `materialized_adapters` from disk. `decision.materialized_adapters` MUST
remain `[]` until S2 user selection; execute phase `syncDecisionAdaptersIntoContext`
MUST apply `decision.materialized_adapters` as SSOT.

#### Scenario: Emit includes minimal payload without framework defaults
- **WHEN** emit runs against an UPDATE project with existing `framework.config.json`
- **THEN** stdout `context.configWritePayload` MUST include `project_name`,
  `architecture`, and `project_profile` when present on disk
- **AND** MUST NOT include `state_machine` or `toolchain` keys from disk-only defaults
  unless explicitly present in minimal extraction (they are excluded by derive)
- **AND** MUST NOT include `materialized_adapters` from disk in emit prefill
