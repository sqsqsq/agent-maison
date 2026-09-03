## MODIFIED Requirements

### Requirement: contracts.files is the sole file authorization set

Within `contracts.yaml`, the top-level `files` collection SHALL be the only persistent authorization set for files that plan permits coding or later phases to materialize or modify. All other file-bearing contract fields are references and MUST be members of that set; they MUST NOT act as independent authorization channels. Reference closure SHALL be a deterministic in-memory projection of the current YAML and SHALL not create another feature artifact.

The `navigation` section SHALL carry exactly one file-bearing field in 3.0: `config_files: string[]`, the navigation registration/configuration file list. Its entries are references like any other and MUST be members of `contracts.files`; a consumer reading them MUST NOT treat the declaration itself as authorization.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `specs/artifact-schemas/contracts.schema.yaml`

#### Scenario: Resource key is a reference, not an allowlist

- **WHEN** `resource_keys[*].media` names a file absent from `contracts.files`
- **THEN** the media field MUST NOT authorize that file and plan closure MUST remain open

#### Scenario: Reclosed contracts replace the in-memory view

- **WHEN** the plan owner adds a missing path to `contracts.files` and reruns closure
- **THEN** the resolver SHALL derive a new view solely from the updated YAML without reading a previous graph or sidecar

#### Scenario: Navigation config file is a reference, not an allowlist

- **WHEN** `navigation.config_files` names a registration file absent from `contracts.files`
- **THEN** plan closure MUST remain open and the navigation declaration MUST NOT authorize that file
