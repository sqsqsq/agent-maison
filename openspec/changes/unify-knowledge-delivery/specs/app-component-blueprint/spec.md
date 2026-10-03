## ADDED Requirements

### Requirement: Knowledge producers preserve authority and write scope
Discovery MUST consume current knowledge before P1 design, retaining the existing facts/provenance and specialized provider responsibilities. Asset writers SHALL refresh derived data only within authorization, by default after affected runs close and before closure; run-local graph writes MUST be explicitly in contracts.files. Stable curated conclusions MUST follow existing confirmation rules without reconfirming identical approved decisions. The P1 owner SHALL register actual knowledge assets and conclusion references; subsequent revision changes SHALL pass existing design preparation before closure. Closure MUST only validate and route missing placement to writer then P1, not edit upstream authority. Enforcement: `skills/reference/app-component-blueprint-workflow.md`, `skills/project/component-closure/SKILL.md`, `harness/scripts/utils/component-closure-knowledge.ts`, `harness/scripts/check-coding.ts`.

#### Scenario: Graph was not in the run write set
- **WHEN** coding changes an authorized source file and graph output is not authorized
- **THEN** phase instructions do not request an unbound bootstrap write; the existing scope gate still rejects such a write

#### Scenario: Stable conclusion is placed after implementation
- **WHEN** an authorized writer places the verified conclusion in its original asset
- **THEN** the design owner updates existing knowledge_refs through reconciliation, design preparation updates CU pointers, and closure validates the real conclusion
