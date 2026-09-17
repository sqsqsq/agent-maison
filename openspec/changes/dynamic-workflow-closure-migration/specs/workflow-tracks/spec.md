## ADDED Requirements

### Requirement: Modern default and legacy restoration remain distinct

New requests SHALL use modern source contracts and obligation scope without track selection. Existing runs MUST restore their frozen chain and original version semantics; corrupt modern scope MUST NOT downgrade. Public change-lite/exit entry retirement SHALL use existing UPDATE backup cleanup while internal legacy execution remains available. Consumer history MUST NOT be rewritten.

An interactive full delivery MAY use a feature-level frozen scope record as its authority instead of creating a run. Authority SHALL be decided in one place, in this order: the run this invocation is associated with (an explicit run identity); otherwise the feature frozen record; when neither can be established yet phase reports exist, or the record names a run that is missing or corrupt, the tool MUST report and MUST NOT pick a side; when neither exists the first feature phase invocation SHALL freeze the record. The record MUST be machine-written by a single writer and MUST NOT live inside the candidate file. Once a run is born for that feature, the run SHALL be born from the **effective** scope at the moment of transfer (birth segment plus applied revisions, never recomputed from the candidate) and the record SHALL register the transfer and that scope's fingerprint; afterwards the record is source history and MUST NOT be kept in continuous equality with the run — only a mismatch between the run's birth fingerprint and the registered transfer fingerprint is corruption.

Enforcement: `workflows/spec-driven.workflow.yaml`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/goal-run-creation.ts`, `skills/skills.index.yaml`.

#### Scenario: A run is born from the transferred feature scope
- **WHEN** a feature whose frozen record already carries a legal revision later starts a Goal run
- **THEN** the run SHALL be born from that revised effective scope, the record SHALL register the transfer with its fingerprint, and the record's own birth segment and revision history SHALL be preserved

#### Scenario: Continue old run after entry cleanup
- **WHEN** an old run is resumed after deprecated public bridge cleanup
- **THEN** its historical execution and budget SHALL remain available through internal compatibility

#### Scenario: New request after upgrade
- **WHEN** a new request starts under the new default
- **THEN** it SHALL derive scope from current facts without a lite/full menu or forced physical upstream documents
