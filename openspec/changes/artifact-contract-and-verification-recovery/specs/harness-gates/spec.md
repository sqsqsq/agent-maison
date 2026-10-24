## ADDED Requirements

### Requirement: Artifact content has one canonical consumption contract

File, supplied memory, blueprint fragment and merged artifact paths SHALL use `resolveArtifactContent` before typed consumption. Calls SHALL accept a non-empty string or a non-empty list of named references and normalize to an ordered string list preserving every entry and duplicate. Single-value fields SHALL reject incompatible shapes with path/message diagnostics. Shape compatibility SHALL NOT replace semantic, ownership or frozen-binding checks.

Enforcement: `harness/scripts/utils/artifact-content.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/component-blueprint-validator.ts`, `specs/artifact-schemas/`.

#### Scenario: Original list input reaches every real consumer

- **WHEN** fe4512 calls lists are loaded from file, supplied memory or design projection
- **THEN** coding/UT named handlers and testing bindings SHALL consume every normalized call without TypeError; a missing second target SHALL still fail the existing implementation check

#### Scenario: Ambiguous single-value input remains a repairable input problem

- **WHEN** coordinator is a list or calls contains an empty, numeric or object entry
- **THEN** the result SHALL name the invalid field and expected shape and SHALL reach the original artifact/design owner rather than coercing or dropping content

### Requirement: Applicable checker exceptions retain honest verification gaps

All six feature phases SHALL use the shared execution wrapper. An applicable checker exception SHALL be SKIP with its original required severity, framework_bug, framework_internal, framework_blocked and diagnostic stack; it MUST NOT become product FAIL or successful evidence. Required execution gaps SHALL keep the phase INCOMPLETE/open and prevent required closure/completion. Actual product failures SHALL remain failures with their trustworthy repair routes; confirmed not_applicable and disclosed non-result items SHALL retain their existing semantics.

Only unexecuted gaps explicitly marked framework_bug/framework_internal or device_blocked/externalBlocked/capability_missing SHALL affect completion according to their requiredness, using the existing framework or external recovery path. Unclassified legacy BLOCKER SKIP SHALL remain in `blocking_skips` for verifier review; neither severity nor a missing classification SHALL by itself change an existing PASS, produce FAIL/INCOMPLETE or dispatch author repair. Confirmed not_applicable and disclosed non-result items SHALL retain their existing semantics.

Completion assessment SHALL classify an explicitly marked required framework or external execution gap, or an existing pure INCOMPLETE verdict, as an existing evidence gap, using required_check_conclusion only as a transient completion diagnostic. It SHALL NOT infer a missing required conclusion from an unclassified legacy SKIP or classify that absence as product result failure or dispatch content repair on that basis. A real FAIL SHALL retain its result classification when a verification gap also exists; no new gate, persistent field, run state or halt reason is introduced.

Enforcement: `harness/scripts/utils/check-execution.ts`, `harness/scripts/utils/check-disposition.ts`, `harness/scripts/check-*.ts`, `harness/scripts/utils/report-generator.ts`, `harness/scripts/utils/verify-feature-completion.ts`.

#### Scenario: Ordinary Error and TypeError have the same execution meaning

- **WHEN** a required applicable checker throws either error type
- **THEN** both SHALL preserve unknown execution rather than changing mandatory evidence based on the JavaScript class

#### Scenario: A real product failure coexists with a gap

- **WHEN** another checker returns an actual FAIL
- **THEN** its failure and verified repair candidate SHALL survive, while the missing checker evidence still prevents completion

#### Scenario: An unclassified legacy skip retains PASS compatibility

- **WHEN** an otherwise passing legacy report contains an unclassified BLOCKER SKIP
- **THEN** the check SHALL remain in blocking_skips for verifier review, the existing PASS SHALL remain compatible, and no author repair or INCOMPLETE SHALL be inferred from that SKIP alone

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

