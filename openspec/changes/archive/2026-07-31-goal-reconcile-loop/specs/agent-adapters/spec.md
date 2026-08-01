## ADDED Requirements

### Requirement: Adapter goal capabilities declare reconcile execution support
`agents/adapter-schema.yaml` SHALL allow adapters to declare support for in-session reconciliation, phase-context isolation, external unattended execution, resume, and bidirectional handoff. `harness/scripts/utils/goal-adapter-capability.ts` SHALL validate the declaration.

#### Scenario: Adapter declares handoff without resume
- **WHEN** an adapter capability enables handoff but lacks the required resume capability
- **THEN** adapter validation MUST fail

### Requirement: Capability routing is fail-closed
The goal driver SHALL route in-session, unattended, and handoff behavior only when the active adapter declares and passes the corresponding capability/preflight. Missing capability SHALL select a documented fallback or halt rather than optimistic execution.

#### Scenario: Unattended permission contract is incomplete
- **WHEN** unattended mode is requested and the active adapter fails existing external-runner preflight
- **THEN** the run MUST halt before autonomous mutation and report the missing capability

#### Scenario: In-session capability is absent
- **WHEN** attended goal mode is requested without in-session support
- **THEN** the framework SHALL fall back to manual harness+assess

### Requirement: Existing adapter behavior remains backward compatible
Adapters that currently support external-runner goal execution SHALL retain their existing headless invoke, permission, output-delivery, tool-event, and usage-capture semantics unless they explicitly opt into new in-session or handoff capability fields.

#### Scenario: Legacy adapter omits new capability fields
- **WHEN** an existing adapter is loaded after upgrade
- **THEN** external-runner behavior SHALL remain available under existing preflight while new in-session/handoff behavior remains disabled
