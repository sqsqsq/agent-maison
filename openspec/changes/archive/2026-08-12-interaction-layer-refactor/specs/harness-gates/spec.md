# Delta: Harness Gates — 交互层确认 UX lint

## ADDED Requirements

### Requirement: Shared layer must not contain platform tool names

The system MUST forbid `AskUserQuestion` and `AskQuestion` in publishable shared
layers (`skills/`, `profiles/`, `agents/shared/`, `templates/`). Platform tool
names SHALL only appear in adapter-specific directories (`agents/claude/**`,
`agents/cursor/**`, etc.).

#### Scenario: Skills directory lint passes
- **WHEN** `check-skills-confirmation-ux.ts` scans publishable shared layers
- **THEN** no file under `skills/`, `profiles/`, `agents/shared/`, or
  `templates/` MUST match `AskUserQuestion` or `AskQuestion`

> **Enforced by:** `harness/scripts/check-skills-confirmation-ux.ts`

### Requirement: Confirmation registry schema 2.0 completeness

The system SHALL require `confirmation-registry.yaml` to use `schema_version: "2.0"`
with complete `options` (or `matrix_options`) for all registered confirmation
entries, and MUST NOT contain deprecated `widget_hint` or `widget_options_ref`
fields.

#### Scenario: Registry lint rejects legacy fields
- **WHEN** confirmation UX lint runs against `confirmation-registry.yaml`
- **THEN** entries with class `enum|gate|freeform_approval|artifact_checkbox` MUST
  have non-empty `options` arrays and the file MUST NOT contain `widget_hint:` or
  `widget_options_ref:`

> **Enforced by:** `harness/scripts/check-skills-confirmation-ux.ts`,
> `skills/reference/confirmation-registry.yaml`

### Requirement: Interaction layer consumer smoke test

The system SHALL provide `harness/scripts/smoke-interaction-renderer.ts` that
validates both framework source templates and consumer-level artifact paths after
simulated init materialization.

#### Scenario: Smoke test passes in CI
- **WHEN** `npx ts-node harness/scripts/smoke-interaction-renderer.ts` runs from
  the framework repository
- **THEN** it MUST pass Phase A (claude source templates) and Phase B (tmpdir
  consumer smoke including deprecated artifact cleanup and generic bundle-root
  renderer relocation)

> **Enforced by:** `harness/scripts/smoke-interaction-renderer.ts`,
> `docs/operations/release-checklist.md`
