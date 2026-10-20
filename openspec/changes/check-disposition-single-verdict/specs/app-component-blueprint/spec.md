## ADDED Requirements

### Requirement: Unattended original-scope design and architecture repair uses the existing owner chain

For an unattended original-scope task the runtime SHALL dispatch the design owner before retrying an incapable downstream stage. B1/B2 labels and the legacy personal opt-in SHALL NOT replace task authorization. Design/CU changes and all existing architecture_impact variants SHALL use drafts, isolated questioning, existing validation and writers, and re-evaluation. The current caller MAY lend its existing locks to the CU content consumer; unrelated live runs SHALL remain busy. Runtime publication SHALL preserve identity and unrelated configuration, and source/verification changes SHALL NOT reset accumulated budget.

If bindings remain valid, the same run SHALL continue; otherwise the existing continuation decision SHALL automatically select the successor, without an outer Agent or a human re-issuing the request. New effective input SHALL be distinguished from unchanged repeated failure using existing events and bounded recovery. Missing facts SHALL NOT be fabricated. Changes to original requirements or substantive acceptance, explicit prohibitions, secrets, irreversible external actions and user budget limits retain their real authority boundaries. Attended behavior remains unchanged.

#### Scenario: A CU lacks a required selection reference
- **WHEN** a design-owned failure occurs during an authorized unattended task
- **THEN** the runner SHALL obtain a revised design/CU through the original consumer, validate and rebind it, and continue construction without asking the outer Agent to edit files

#### Scenario: A genuine authority boundary remains
- **WHEN** the repair would change the original product requirement or violate an explicit restriction
- **THEN** the request SHALL remain incomplete and report the concrete decision needed, without publishing a fabricated authorization

#### Scenario: A repair changes architecture permission
- **WHEN** a necessary original-scope dependency or module decision requires a new DSL value
- **THEN** the design owner SHALL provide the decision and candidate DSL, the existing init writer SHALL publish the validated configuration before construction, and questioning SHALL inspect the original request and both candidates

Enforcement: `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/init-task-executor.ts`, `harness/scripts/goal-phase-runtime.ts`
