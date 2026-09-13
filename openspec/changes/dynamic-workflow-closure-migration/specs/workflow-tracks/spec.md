## ADDED Requirements

### Requirement: Modern default and legacy restoration remain distinct

New requests SHALL use modern source contracts and obligation scope without track selection. Existing runs MUST restore their frozen chain and original version semantics; corrupt modern scope MUST NOT downgrade. Public change-lite/exit entry retirement SHALL use existing UPDATE backup cleanup while internal legacy execution remains available. Consumer history MUST NOT be rewritten.

Enforcement: `workflows/spec-driven.workflow.yaml`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/goal-run-creation.ts`, `skills/skills.index.yaml`.

#### Scenario: Continue old run after entry cleanup
- **WHEN** an old run is resumed after deprecated public bridge cleanup
- **THEN** its historical execution and budget SHALL remain available through internal compatibility

#### Scenario: New request after upgrade
- **WHEN** a new request starts under the new default
- **THEN** it SHALL derive scope from current facts without a lite/full menu or forced physical upstream documents
