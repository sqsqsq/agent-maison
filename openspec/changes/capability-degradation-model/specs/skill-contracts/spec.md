## MODIFIED Requirements

### Requirement: Feature skills publish versioned machine-readable contracts
The framework SHALL provide `skills/feature/<skill>/contract.yaml` for all seven
feature skills. Each phase contract SHALL declare produced artifacts, verifier/check
providers, and capability declarations. A capability SHALL declare its ID, quality
axis, input IDs, applicable tracks, optional named applicability provider, and
`on_missing` policy. Each input SHALL be an ID plus ordered structured artifact/derive
sources; input-level required/optional policy, alternatives, normalizers, and
`absent_effect` SHALL NOT remain authoritative.

Enforcement SHALL be implemented by `specs/skill-contract-schema.yaml` and the
contract loader under `harness/scripts/utils/`. A migrated capability ID SHALL bind to
its check ID and contract axis rather than relying on prefix mapping.

#### Scenario: All feature skills have valid capability contracts
- **WHEN** framework regression loads every feature skill
- **THEN** exactly seven contract files SHALL validate, all source and applicability providers SHALL resolve, and change/exit SHALL remain phase sections of the change-lite contract

### Requirement: Contract dependencies form a valid producer-consumer graph
The framework SHALL derive phase-to-artifact producer edges from contract outputs and
validate artifact source dependencies against producer phases reachable through
`effectiveRequires(track)`. It SHALL also validate capability input references,
applicable track subsets, provider identities, registered artifact sources, and
active-track capability-ID uniqueness. Workflow-only ordering edges SHALL be explicitly
classified as control dependencies.

Enforcement SHALL live in `harness/scripts/check-contract-consistency.ts` and reuse
`harness/scripts/utils/runtime-policy.ts`; runtime report-to-check consumption SHALL
be enforced later by the phase runner because static validation has no check results.

#### Scenario: Capability source has no reachable producer
- **WHEN** an active capability's artifact source has no producer reachable in its workflow closure
- **THEN** the consistency gate MUST fail and identify the capability, source, consumer, and missing producer

#### Scenario: Capability ID duplicates on an active track
- **WHEN** two capabilities active for the same track declare the same ID
- **THEN** the consistency gate MUST fail before phase execution

## REMOVED Requirements

### Requirement: Tier selection is deterministic
**Reason**: Ordered source resolution and mechanical capability aggregation replace
contract-authored tier predicates and their finite `when` DSL.

**Migration**: Remove `tiers` and `when` from every contract and remove
`enumerateTierCombinations`; declare capabilities, applicability providers, and
structured sources instead.

### Requirement: Tier satisfaction is contract-local
**Reason**: Global assurance is mechanically derived from capability states rather
than comparing per-contract tier labels and `satisfies` sets.

**Migration**: Replace `satisfies`, `summary.depth`, and per-phase required depth
comparisons with `assurance` and sparse `minimum_assurance`.