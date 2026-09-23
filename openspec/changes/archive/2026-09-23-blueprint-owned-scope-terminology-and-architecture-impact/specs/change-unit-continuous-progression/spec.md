## ADDED Requirements

### Requirement: CU modifiable module set derives from touches only

The modifiable module set of a CU-bound Feature SHALL be derived only from the CU `touches[].design_ref`, resolved through the existing addressing resolver to development nodes and their `module`; `design_refs` remain design dependencies and MUST NOT widen the set. The derivation SHALL use the same resolver and stale semantics as acceptance/contracts projection. Check `cu_scope_matches_blueprint` SHALL live in the shared `validateChangeUnitFeatureProjection`, so direct blueprint projection, typed plan, completion, ready-set and closure inputs apply one judgement: every `contracts.modules[].name` MUST belong to the modifiable set, and a violation points back to `/component-design` without any plan-side expansion outlet. `contracts.files` remains the only exact write authorization.

#### Scenario: Shared module referenced but not touched
- **WHEN** a CU's design_refs reference a shared development node that its touches do not include, and contracts.modules lists that shared module
- **THEN** the projection SHALL report `cu_scope_matches_blueprint`

#### Scenario: Direct projection without running plan
- **WHEN** blueprint-carried contracts are projected directly and their modules exceed the modifiable set
- **THEN** the projection SHALL be `invalid` through the same shared validation, without requiring plan to run

#### Scenario: Blueprint revision changes after binding
- **WHEN** the bound blueprint bytes change
- **THEN** the derived set SHALL be stale and the projection SHALL fail closed instead of reusing an earlier PASS

> **Enforced by:** `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/tests/unit/change-unit-progression.unit.test.ts`, `harness/tests/unit/blueprint-skill-projection.unit.test.ts`, `harness/tests/unit/real-chain.unit.test.ts`

### Requirement: Architecture impact decisions are effective before construction

For architecture_impact decisions relevant to a CU (referenced by its design_refs, or whose module or dependency endpoint touches the CU's modifiable modules or their layers), the shared `validateChangeUnitFeatureProjection` SHALL require `add_module`, `move_module` and `dependency_edge` decisions to be `decided_with_authority` and consistent with the current DSL; otherwise it reports `cu_architecture_impact_not_effective`. A `dependency_edge` SHALL be checked by operation using the existing `isOuterDepAllowed` / `isIntraLayerDepAllowed` helpers: `add` fails when the current DSL does not allow the edge, `remove` fails when the current DSL still allows it, and an endpoint that resolves to neither an admitted module nor a current outer layer id fails. `dsl_other` decisions SHALL never block; the phase checker surfaces them as the WARN `cu_architecture_dsl_other` for manual verification (direct projection, completion, ready-set and closure have no warning channel and only consume the blocking issues).

#### Scenario: Edge addition not yet applied to the DSL
- **WHEN** a decided dependency_edge with direction add names endpoints whose current DSL relation is not allowed
- **THEN** the projection SHALL fail and direct the user to change the DSL through the framework-init authorized paths

#### Scenario: Edge removal applied or not applied
- **WHEN** a decided dependency_edge with direction remove is already disallowed by the DSL
- **THEN** the projection SHALL pass
- **AND WHEN** the DSL still allows that edge, the projection SHALL fail as an unapplied removal

#### Scenario: Undecided architecture impact
- **WHEN** a relevant dependency_edge decision is still open_decision
- **THEN** the current CU SHALL NOT be constructable

#### Scenario: Manual config edit followed by UPDATE
- **WHEN** the maintainer edits `can_depend_on` or intra-layer policy in the config and the DSL now satisfies the decision
- **THEN** the projection SHALL pass without plan performing any DSL write
- **AND** the existing init UPDATE config write SHALL accept the edited DSL and keep it unchanged, without UPDATE itself rewriting it

> **Enforced by:** `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/component-assets.ts`, `harness/scripts/utils/config-builder.ts`, `specs/phase-rules/plan-rules.yaml`, `harness/tests/unit/change-unit-progression.unit.test.ts`, `harness/tests/unit/config-builder.unit.test.ts`
