# Delta: Agent Adapters — 交互层重构

## ADDED Requirements

### Requirement: Adapters declare interaction renderer rules

The system SHALL require every adapter with a non-null `user_confirmation` block to
declare `interaction_renderer_rule` (path relative to the adapter directory) that
injects platform-specific rendering protocol into the consumer instance.

#### Scenario: Claude adapter renderer template exists
- **WHEN** `agents/claude/adapter.yaml` is loaded
- **THEN** `user_confirmation.interaction_renderer_rule` MUST resolve to
  `templates/rules/interaction-renderer.md` and the template MUST exist on disk

#### Scenario: Generic custom bundle root relocates renderer
- **WHEN** framework-init runs with `agent_adapter=generic` and
  `paths.agent_bundle_root` is a custom relative path (e.g. `.codex`)
- **THEN** the interaction renderer MUST be materialized under
  `<agent_bundle_root>/rules/interaction-renderer.md`, not the default
  `.agents/rules/` path from adapter.yaml

> **Enforced by:** `agents/adapter-schema.yaml`, `agents/*/adapter.yaml`,
> `harness/scripts/check-init.ts`, `harness/scripts/smoke-interaction-renderer.ts`

### Requirement: Claude adapter declares deprecated artifact cleanup

The system SHALL declare `deprecated_artifacts` on the Claude adapter for legacy
interaction-layer files superseded by registry schema 2.0 and interaction-renderer.

#### Scenario: UPDATE mode backup-deletes legacy rules
- **WHEN** check-init runs in UPDATE mode and legacy paths exist under
  `.claude/rules/` (e.g. `confirmation-ux.md`, `widget-options/`)
- **THEN** check-init MUST backup-delete them to `.framework-backup/<timestamp>/`
  and record entries in `check-init.json` → `deprecated_artifacts_cleaned`

> **Enforced by:** `agents/claude/adapter.yaml`, `harness/scripts/check-init.ts`,
> `harness/scripts/smoke-interaction-renderer.ts`

## MODIFIED Requirements

### Requirement: Adapters do not contain skill logic

The system MUST NOT allow adapters to embed phase rules or skill workflow logic;
adapters SHALL only expose skill entry points (slash commands, bridge files, rules)
to the instance project root. Adapter templates MUST NOT duplicate confirmation
option text that belongs in `skills/reference/confirmation-registry.yaml`; slash
commands MAY retain a one-line platform strong constraint but MUST link to
interaction-renderer and registry SSOT instead of per-skill widget-options files.

#### Scenario: Claude slash commands link registry and renderer
- **WHEN** a Claude slash command template under `agents/claude/templates/commands/`
  is inspected
- **THEN** it MUST reference `confirmation-registry.yaml` options and
  `interaction-renderer.md`, and MUST NOT reference `widget-options/` or
  `confirmation-ux.md`

> **Enforced by:** `agents/claude/templates/commands/*.md`,
> `harness/scripts/check-skills-confirmation-ux.ts`,
> `harness/scripts/smoke-interaction-renderer.ts`
