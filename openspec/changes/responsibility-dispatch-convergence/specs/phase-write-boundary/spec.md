## ADDED Requirements

### Requirement: Raw producer ownership survives queue pruning

`harness/scripts/utils/repair-responsibility.ts` SHALL read raw Skill and profile responsibility contracts independently of the remaining phase order; `harness/scripts/utils/phase-write-boundary.ts` SHALL project the same result into invocation authorization. Capability availability and original request authorization SHALL remain distinct from ownership. Product source, test source and testing evidence retain their real producer, with only the checked finite compatibility modifier exception.

#### Scenario: A phase has already completed
- **WHEN** its output is targeted after its node leaves the remaining queue
- **THEN** the owner remains stable and existing reopen rules determine whether it needs another invocation
