## ADDED Requirements

### Requirement: The personal visual provider lives in the local vision block

`framework.local.json` SHALL accept an optional `vision.visual_provider` object with exactly the keys
`{adapter, model}`, both non-empty strings. `model` is mandatory — an endpoint without a frozen model
is not a provider identity. The key SHALL be registered in the local vision key ownership set, and
parsing/validation SHALL live with the other `vision` fields, rejecting unknown keys as the block
already does.

Writes SHALL go exclusively through the lossless local-config update entry point. The framework SHALL
NOT hand-merge a partial local config for this field: two prior incidents erased whole sections that
way, and the provider block sits beside device credentials in the same file.

The agent SHALL NOT hand-write this JSON. The value SHALL be recorded by a deterministic personal
scope task, following the existing personal-setup discipline (machine-written config plus a
confirmation-registry entry for the selection).

The run-scoped blind authorization flag `--allow-blind-visual` and manifest field
`allow_blind_visual` SHALL NOT be accepted or persisted in `framework.local.json`. Personal state may
remember a provider identity, but SHALL NOT silently authorize future blind runs.

Enforcement: `harness/scripts/utils/config-field-ownership.ts`,
`harness/scripts/utils/framework-local-config.ts`, `harness/scripts/init-orchestrate.ts`,
`skills/reference/confirmation-registry.yaml`

#### Scenario: an incomplete provider entry is rejected at load

- **WHEN** `vision.visual_provider` carries an adapter but no model, or carries an unknown key
- **THEN** local config validation SHALL reject it with an explicit message naming the field

#### Scenario: recording a provider preserves neighbouring personal state

- **WHEN** the provider selection is recorded on a local config that already holds device unlock and
  toolchain sections
- **THEN** those sections SHALL be present and unchanged after the write

#### Scenario: blind authorization is never personal state

- **WHEN** a run is started with `--allow-blind-visual`
- **THEN** no `allow_blind_visual` or equivalent authorization key SHALL be written to
  `framework.local.json`
