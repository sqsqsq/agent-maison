## ADDED Requirements

### Requirement: Handoff transition has one lifecycle writer

A compatibility or host API MAY publish a request through the existing handoff mailbox while fenced, but only `GoalPhaseRuntime` SHALL consume the request, emit handoff lifecycle events, quiesce/release the source owner and accept the target epoch. Compatibility helpers MUST NOT perform those transition steps.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-handoff.ts`, `harness/scripts/utils/goal-phase-runtime.ts`

#### Scenario: Session requests process ownership
- **WHEN** a fenced session publishes a process handoff request while the canonical runtime is active
- **THEN** the canonical runtime consumes and projects the handoff exactly once before the process owner resumes

#### Scenario: Compatibility helper publishes intent
- **WHEN** a compatibility caller requests session-to-process handoff
- **THEN** it writes only the mailbox request and does not append lifecycle events or release the owner itself
