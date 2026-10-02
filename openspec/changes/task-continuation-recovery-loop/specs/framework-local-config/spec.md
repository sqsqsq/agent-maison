## ADDED Requirements

### Requirement: Approved model alternatives are personal settings per adapter

`framework.local.json` SHALL accept an optional top-level `adapters` object whose entries are keyed by adapter name and MAY carry `approved_models: string[]`, the ordered list of models the user approves as substitutes when the pinned or default model is unsupported. The field SHALL be registered in top-level key ownership and in `specs/framework.local.schema.json`. Loading SHALL preserve the `adapters` object losslessly so round-trip writes never drop it; a non-object `adapters` SHALL be dropped with one warning per process instead of failing the whole local config. At the point of use, a missing list SHALL mean no alternatives; a list that is not an array of non-empty strings of at most 128 characters without control characters SHALL be treated as not configured with a hint. Values SHALL be trimmed, de-duplicated by first occurrence, and tried in the given order. The list SHALL NOT override a model the user pinned and SHALL NOT raise any budget.

Enforcement: `harness/scripts/utils/framework-local-config.ts`, `harness/scripts/utils/config-field-ownership.ts`, `specs/framework.local.schema.json`

#### Scenario: No list keeps the previous behavior

- **WHEN** `framework.local.json` has no `adapters.<adapter>.approved_models`
- **THEN** a model-unsupported failure SHALL halt exactly as before, with guidance naming the missing configuration key

#### Scenario: An invalid list is ignored with a hint

- **WHEN** `approved_models` contains an empty string, a non-string, a value longer than 128 characters, or a control character
- **THEN** the list SHALL be treated as not configured, a hint SHALL name the field, and the rest of the local config SHALL load and round-trip unchanged

### Requirement: Unattended B1 design repair is pre-authorized in personal settings

`framework.local.json` SHALL accept an optional top-level `design_repair` object whose `unattended_b1` is the user's pre-authorization for the framework to dispatch one unattended repair of a `B1` design-authority halt (dispatch rules in `goal-runner`, revision rules in `app-component-blueprint`). It is a personal setting written by a person, of the same kind as approved model alternatives; an agent SHALL NOT grant it to itself. The field SHALL be registered in top-level key ownership and in `specs/framework.local.schema.json` (boolean, default `false`). Loading SHALL preserve the `design_repair` object losslessly so round-trip and partial writes never drop it; a `design_repair` that is not an object SHALL be dropped without failing the rest of the local config. At the point of use only boolean `true` SHALL authorize; a missing key, any other value (including the string `"true"`), a dropped object, or an unreadable local config SHALL mean not authorized. The setting SHALL NOT authorize `B2` repairs, attended runs, or any budget increase.

Enforcement: `harness/scripts/utils/framework-local-config.ts`, `harness/scripts/utils/config-field-ownership.ts`, `specs/framework.local.schema.json`

#### Scenario: Only boolean true authorizes

- **WHEN** `design_repair.unattended_b1` is absent, `false`, or the string `"true"`
- **THEN** the setting SHALL read as not authorized and no unattended design repair SHALL be dispatched

#### Scenario: The setting survives a partial write

- **WHEN** another personal field is written back to a local config that carries `design_repair.unattended_b1: true`
- **THEN** the `design_repair` object SHALL still be present and unchanged after the write
