## MODIFIED Requirements

### Requirement: Fresh delivery uses the existing design handoff

The main Agent SHALL classify the request and provide original inputs and trusted authorization to the existing Goal entry. A design-lens formal complete delivery SHALL enter the same runtime before its blueprint/CUs exist; initial author, real independent questioning, checks/admission, public CU acceptance/readiness and P2 handoff SHALL continue inside that runtime. The Skill/main Agent MUST NOT first complete all initial design outside the run, manually select successive CUs/phases or treat preparation steps, author exit or design readiness as delivery completion. Session next/report and detached transport SHALL consume the same business decisions, responsibility and completion criteria; no design-specific user flag or host callback SHALL be required. Direct design-only requests SHALL retain their own endpoint, existing confirmations and existing original authority and explicit user deadlines.

The managed original request SHALL continue through its required formal component endpoint; it MUST use the original closure writer and reread actual evidence rather than infer completion from all CUs or evaluate eligibility. Feature/CU and UT acceptance remain grounded in their actual originals.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/project/component-design/SKILL.md`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`.

#### Scenario: Fresh request continues after the initial author returns

- **WHEN** an authorized original formal complete request has no CU and the first design author returns
- **THEN** the runtime SHALL read real artifacts and continue required checks, repair or independent questioning rather than return the full request as complete

#### Scenario: Direct design remains design-only

- **WHEN** the user requested only design handoff
- **THEN** the Skill SHALL stop at that authorized endpoint and SHALL NOT create a construction run
