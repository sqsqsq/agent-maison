## ADDED Requirements

### Requirement: Verification and filtered proposals retain actionable responsibility

`harness/scripts/utils/repair-candidates.ts` SHALL accept the existing verification CorrectionCategory and derive its concrete owner/fact kind from actual outputs and obligations. Writer, finalizer, assess and runtime SHALL preserve that owner rather than filter through spec/plan/coding-only sets or choose a queue head. `readPhaseRepairIssues` SHALL provide nonblocking actionable diagnostics for present but unreadable/empty/own-target proposal tables and include the expected coding-upstream-issues format in the next prompt. Independent verification SHALL remain required; unstructured prose alone never dispatches repairs. Final guidance SHALL describe the final concrete failure, owner and next step.

#### Scenario: Proposal prose produces zero rows
- **WHEN** coding/upstream-issues.md exists but contains no valid issue table rows
- **THEN** the next invocation receives the expected table/evidence format and reason instead of silent zero-candidate repetition
