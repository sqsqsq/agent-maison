## ADDED Requirements

### Requirement: CU-bound narrative spec and plan gates verify blueprint projections

When a CU-bound Feature (identity derived with the `cu-` prefix) runs the narrative spec or plan path, the existing gate ids SHALL verify the blueprint projection instead of re-adjudicating, and their details SHALL state the blueprint as the source. For spec, `terminology_mapping_table` SHALL require the mapping table rows to equal the blueprint terminology facts (exactly one row per term, with the same canonical module and confidence and every `easily_confused_with` item shown, every row `[x]` written by the projection without asking the user), `scope_declaration` SHALL require `in_scope_modules` to equal the modifiable module set with no `expansions_with_user_approval`, `scope_matches_catalog` SHALL accept admitted modules (catalog plus blueprint add_module/move_module/retire_module declarations), and `terminology_modules_within_scope` keeps its check with the blueprint source noted. For plan, `scope_declaration` SHALL apply the same set equality and forbid expansions (`plan.scope_expansion` does not apply), `architecture_impact_declared` SHALL require the section's `decisions` list to equal the blueprint architecture_impact decision ids (`impact: none` only when there are none, `plan.arch_impact` does not apply), and `plan_to_architecture` SHALL verify the relevant decisions are decided and satisfied by the current DSL. Plan is not a DSL writer: DSL changes go through the existing framework-init authorized paths (preset, or manual config edit followed by UPDATE) and must pass `validateArchitectureDsl`. Non-CU-bound flat Features SHALL keep their existing terminology, scope and architecture impact gates unchanged.

#### Scenario: CU-bound spec terminology table differs from the facts
- **WHEN** a CU-bound spec.md lists a canonical module different from the blueprint terminology fact
- **THEN** `terminology_mapping_table` SHALL FAIL as a BLOCKER with details naming the blueprint as source

#### Scenario: CU-bound spec terminology table repeats or rewrites a term
- **WHEN** a CU-bound spec.md lists the same term twice (even if one row matches the fact), or changes a projected confidence or drops an `easily_confused_with` item
- **THEN** `terminology_mapping_table` SHALL FAIL as a BLOCKER

#### Scenario: CU-bound narrative plan widens its scope
- **WHEN** a CU-bound plan.md in_scope_modules differ from the modifiable set or declare expansions
- **THEN** `scope_declaration` SHALL FAIL and point back to a blueprint revision

#### Scenario: Flat Feature keeps existing gates
- **WHEN** the Feature identity is not CU-derived
- **THEN** the original terminology, scope and architecture impact checks SHALL run unchanged

> **Enforced by:** `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `skills/reference/confirmation-registry.yaml`, `skills/reference/plan-workflow-detail.md`, `harness/tests/unit/change-unit-progression.unit.test.ts`, `harness/tests/unit/real-chain.unit.test.ts`
