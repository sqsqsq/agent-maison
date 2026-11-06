## ADDED Requirements

### Requirement: Approved model alternatives are personal settings per adapter

`framework.local.json` SHALL preserve legacy adapters entries for lossless round-trip. approved_models SHALL be ignored for every value shape, with one startup warning, and SHALL NOT authorize any substitute model. No retired value-shape validation SHALL block startup.

Enforcement: `harness/scripts/utils/framework-local-config.ts`, `harness/scripts/utils/config-field-ownership.ts`, `specs/framework.local.schema.json`

#### Scenario: No list keeps the previous behavior

- **WHEN** `framework.local.json` has no `adapters.<adapter>.approved_models`
- **THEN** a model-unsupported failure SHALL halt exactly as before, with guidance naming the missing configuration key

#### Scenario: An invalid list is ignored with a hint

- **WHEN** `approved_models` contains an empty string, a non-string, a value longer than 128 characters, or a control character
- **THEN** the list SHALL be treated as not configured, a hint SHALL name the field, and the rest of the local config SHALL load and round-trip unchanged

### Requirement: Legacy design repair settings remain readable

The optional design_repair.unattended_b1 value SHALL round-trip without loss for compatibility. It SHALL NOT gate the current unattended original-scope design owner chain or authorize budgets, secrets or requirement changes. Task authorization and attended confirmation retain their existing boundaries.

#### Scenario: Legacy opt-in is absent
- **WHEN** an authorized unattended task has no legacy opt-in value
- **THEN** the design owner repair SHALL remain eligible under the original request and bounded recovery

#### Scenario: A partial personal write occurs
- **WHEN** another personal setting is updated
- **THEN** a legacy design_repair object SHALL remain unchanged
