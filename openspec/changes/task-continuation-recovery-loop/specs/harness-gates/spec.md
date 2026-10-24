## MODIFIED Requirements

### Requirement: Gate internal errors are attributed as framework_bug, not agent content failures

All six feature phase checkers SHALL use the shared execution wrapper. An exception from an applicable checker SHALL preserve its required severity and emit SKIP with failure_kind framework_bug, blocking_class framework_internal, actionability framework_blocked and its stack. The result SHALL mean unexecuted/unknown, not product FAIL. Required framework execution gaps SHALL keep the phase INCOMPLETE/open and prevent required closure/completion. Only unexecuted gaps explicitly marked framework_bug/framework_internal or device_blocked/externalBlocked/capability_missing SHALL affect completion according to their requiredness, using existing framework or external recovery. Unclassified legacy BLOCKER SKIP SHALL remain in blocking_skips for verifier review and SHALL NOT by itself change an existing PASS, produce FAIL/INCOMPLETE or dispatch author repair. Confirmed not_applicable and disclosed non-result items SHALL retain their existing meaning. Independent authorized obligations SHALL continue according to actual dependencies, while dependent work waits. An unchanged checker gap SHALL NOT consume a content retry. Actual product failures and trustworthy repair candidates SHALL remain, and faults that prevent a trustworthy report, write protection, real authorization and hard budgets MUST retain hard stops. Consumer Agents MUST NOT modify framework release files to work around the gap. This follows the 2026-10-23 ruling replacing 07-16 P0-3 blanket first-touch halt.

Enforcement: `harness/scripts/utils/check-execution.ts`, `harness/scripts/utils/check-disposition.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-review.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/goal-phase-runtime.ts`.

#### Scenario: Gate crash does not feed the content retry loop

- **WHEN** a required checker throws TypeError or ordinary Error and the phase report remains trustworthy
- **THEN** its result SHALL be an execution gap with original required severity, the phase SHALL remain incomplete, and independent authorized work SHALL continue without retrying the Agent to fix framework code

#### Scenario: A checker gap does not erase a real product failure

- **WHEN** a required checker is unexecuted and another check returns a trustworthy product FAIL
- **THEN** the gap and product failure SHALL both remain, legal product repair SHALL proceed through its existing owner, and completion SHALL remain blocked until required evidence is restored
