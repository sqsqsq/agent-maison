## ADDED Requirements

### Requirement: contracts.files is the sole file authorization set

Within `contracts.yaml`, the top-level `files` collection SHALL be the only persistent authorization set for files that plan permits coding or later phases to materialize or modify. All other file-bearing contract fields are references and MUST be members of that set; they MUST NOT act as independent authorization channels. Reference closure SHALL be a deterministic in-memory projection of the current YAML and SHALL not create another feature artifact.

Enforcement: `harness/scripts/utils/contracts-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `harness/schemas/contracts.schema.json`, `harness/templates/contracts.yaml`

#### Scenario: Resource key is a reference, not an allowlist

- **WHEN** `resource_keys[*].media` names a file absent from `contracts.files`
- **THEN** the media field MUST NOT authorize that file and plan closure MUST remain open

#### Scenario: Reclosed contracts replace the in-memory view

- **WHEN** the plan owner adds a missing path to `contracts.files` and reruns closure
- **THEN** the resolver SHALL derive a new view solely from the updated YAML without reading a previous graph or sidecar
