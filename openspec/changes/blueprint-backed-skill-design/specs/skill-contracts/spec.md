## ADDED Requirements

### Requirement: Design skills consume typed blueprint projections

spec and plan SHALL consume the same typed acceptance and construction content from artifacts or registered blueprint providers. Narrative formatting checks SHALL apply only to requested narrative outputs in composable calls. Semantic, source, write-set, visual and mapping checks MUST remain active when applicable. A design-only request MUST NOT start implementation.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `skills/feature/spec/contract.yaml`, `skills/feature/plan/contract.yaml`.

#### Scenario: Typed design exists without narrative documents
- **WHEN** the current invocation has valid typed acceptance and construction inputs and does not request spec.md or plan.md
- **THEN** missing narrative files SHALL NOT block machine-content validation or cause placeholder reports

#### Scenario: Required content is unknown
- **WHEN** a blueprint reference lacks exact expected results, verification layers or construction fields
- **THEN** resolution SHALL report the missing responsibility rather than inventing content or declaring it not applicable
