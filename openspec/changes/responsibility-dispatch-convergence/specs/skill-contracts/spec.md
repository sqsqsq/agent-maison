## MODIFIED Requirements

### Requirement: Feature skills publish versioned machine-readable contracts
The framework SHALL provide versioned `skills/feature/<skill>/contract.yaml` contracts for all active feature skills. Each phase contract SHALL declare produced artifacts, verifier/check
providers, and capability declarations. A capability SHALL declare its ID, quality
axis, input IDs, obligation applicability, optional named applicability provider, and
`on_missing` policy. Each input SHALL be an ID plus ordered structured artifact/derive
sources; input-level required/optional policy, alternatives, normalizers, and
`absent_effect` SHALL NOT remain authoritative. Applicable tracks SHALL remain a legacy-contract constraint only; new contracts SHALL bind obligations without duplicating their triggering rules.

Enforcement SHALL be implemented by `specs/skill-contract-schema.yaml` and the
contract loader under `harness/scripts/utils/`. A migrated capability ID SHALL bind to
its check ID and contract axis rather than relying on prefix mapping.

#### Scenario: All feature skills have valid capability contracts
- **WHEN** framework regression loads every feature skill
- **THEN** all active contract files SHALL validate and source/applicability providers SHALL resolve; retired lite contracts and change/exit sections SHALL be absent

