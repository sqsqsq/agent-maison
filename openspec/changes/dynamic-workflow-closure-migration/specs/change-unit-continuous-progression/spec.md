## ADDED Requirements

### Requirement: CU completion and handoff share authoritative execution scope

CU expected execution and Goal handoff SHALL reuse the existing scope resolver and frozen run identity. CU completion MUST additionally verify canonical goal/provides/design mappings and blueprint admission. Different CU phase sets SHALL NOT remove Component assembly obligations. A request result or mutable Feature candidate MUST NOT directly credit CU completion.

Enforcement: `harness/scripts/utils/change-unit-completion.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/utils/verify-feature-completion.ts`.

#### Scenario: Different CU scopes within one blueprint
- **WHEN** required units complete different valid phase sets
- **THEN** each CU SHALL use its verified scope while Component closure still checks assembly evidence
