## MODIFIED Requirements

### Requirement: Goal entry records adapter provenance from the resolved source

The attended goal preparation entry SHALL accept adapter provenance returned by personal setup and SHALL write only a valid real source such as `local_config`. Its API type and CLI validation MUST consume the manifest-owned `RunAdapterProvenance` / `RUN_ADAPTER_PROVENANCES` SSOT rather than copying the enum. It MUST NOT hard-code `entry_declared` when the adapter came from local configuration and MUST NOT invent an `unknown` enum; when provenance cannot be established, the optional field SHALL be omitted or preparation SHALL fail closed.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/personal-setup-gate.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: Existing local adapter keeps local provenance

- **WHEN** personal setup resolves `activeAdapter=codex` from `framework.local.json` and attended preparation receives that source
- **THEN** the manifest SHALL record `adapter=codex` with `adapter_provenance=local_config`

#### Scenario: Unavailable provenance is not fabricated

- **WHEN** attended preparation cannot prove the adapter source
- **THEN** it SHALL omit the optional provenance or BLOCKER-fail, and MUST NOT write `unknown`

#### Scenario: Provenance enum evolves once

- **WHEN** the manifest-owned provenance list changes
- **THEN** the attended preparation API and CLI SHALL accept exactly that same list without a copied union or validator set
