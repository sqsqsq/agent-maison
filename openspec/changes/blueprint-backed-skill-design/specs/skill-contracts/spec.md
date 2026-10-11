## ADDED Requirements

### Requirement: Design skills consume typed blueprint projections

spec and plan SHALL directly consume existing typed acceptance, construction and use-case content from artifacts or registered blueprint providers, preserving its canonical authority and binding. They SHALL only fill content missing within their responsibility and SHALL NOT manually recreate existing authoritative design. Changes to already declared authority SHALL return to the original design owner. Narrative formatting checks SHALL apply only to narrative outputs requested in required_outputs for composable calls; they SHALL NOT cause empty spec.md or plan.md placeholders. Semantic, source, write-set, visual, runtime and mapping checks MUST remain active when applicable. A design-only request MUST NOT start implementation.

Normal design handoff SHALL NOT materialize Feature files. Spec SHALL write its acceptance output from derived design and real UI supplementation; plan SHALL generate the entire Feature contracts.change_unit with canonical identity and complete ID-only implementation/test mappings. When the current legal CU projection contains use-cases@1, or use-cases.yaml already exists, plan required_outputs SHALL require the real use-cases.yaml file for business UT consumption. The file SHALL start from normalized design use cases and MAY only receive non-conflicting supplementation. Projection absence and file absence alone SHALL not introduce an empty file obligation. Existing source-stamped files SHALL use the same authoritative alignment; identity refresh SHALL preserve supplementary bytes only when design/CU contract content is unchanged, otherwise return to the responsible stage without merging.

Without a real ui-spec basis, design-authored P0 device acceptance SHALL retain its ID, priority, steps, expected results, verification layer and focus, without inventing linked_flow, checkpoints, screen flows or element IDs. Once spec has that real basis it MAY add undeclared UI fields through the existing non-conflicting supplementation path, preserving all declared authoritative fields and passing existing alignment and P0 checks. Supplementation SHALL NOT delete acceptance or weaken those checks.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `skills/feature/spec/contract.yaml`, `skills/feature/plan/contract.yaml`, `docs/concepts/blueprint-design-inputs.md`.

#### Scenario: Typed design exists without narrative documents
- **WHEN** the current invocation has valid typed acceptance and construction inputs and does not request spec.md or plan.md
- **THEN** missing narrative files SHALL NOT block machine-content validation or cause placeholder reports; the stages SHALL consume the existing design

#### Scenario: Plan writes projected use cases for real UT consumption
- **WHEN** normal handoff created no Feature files and the current CU has valid projected use cases
- **THEN** plan required_outputs SHALL include use-cases.yaml before it exists; missing output SHALL fail plan delivery
- **AND** plan-written normalized content SHALL resolve as use_cases for the real business UT input without pruning the use-case capability

#### Scenario: Required content is unknown
- **WHEN** a blueprint reference lacks exact expected results, verification layers or construction fields
- **THEN** resolution SHALL report the missing responsibility rather than inventing content or declaring it not applicable

#### Scenario: Spec supplements P0 UI detail without changing design acceptance
- **WHEN** real ui-spec content becomes available after typed acceptance was projected with no UI association
- **THEN** spec MAY add only missing UI flow and checkpoint fields and SHALL pass the existing authoritative alignment and P0 checks
- **AND** changing a declared expected result SHALL fail alignment; declaring an incomplete flow association in the blueprint SHALL remain invalid
