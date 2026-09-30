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
