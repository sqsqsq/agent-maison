# verdict-lattice Specification

## Purpose

Define the machine-derived relationship between report validity, phase advancement, release readiness, and legacy summary compatibility.

## Requirements

### Requirement: Negative product verdicts propagate and block phase closure

check-review SHALL FAIL (BLOCKER, `negative_verdict_closure`) when the review report's declared verdict is 「不通过」, until issues are fixed and a re-run produces a non-negative verdict. check-testing SHALL apply the same rule to 「不达标」. The LLM verifier's PASS attests report credibility only and SHALL NOT be consumed as, or overwrite, a product verdict.

#### Scenario: a negative review cannot close as PASS

- **WHEN** review-report.md concludes 「审查结论: 不通过」 with open BLOCKER findings
- **THEN** `negative_verdict_closure` SHALL FAIL the review phase instead of closing it

### Requirement: Downstream phases consume fresh upstream machine verdicts, not re-parsed prose

At phase start, the harness SHALL gate on upstream phases' machine verdicts from `summary.json`, bound by evidence-manifest and closure freshness. An upstream negative or missing verdict, or stale binding, SHALL receive a total executable disposition through owner backtrack, closure completion, runner refresh, capability defer, or a precise terminal/fuse outcome. Markdown reports are parser input only; downstream gates SHALL NOT reinterpret upstream natural-language reports.

#### Scenario: downstream observes a failed review

- **WHEN** review summary verdict is FAIL and the UT phase is evaluated
- **THEN** the runner SHALL route the trusted gap to its responsible phase rather than advance or emit a dead textual rerun recommendation

### Requirement: summary 1.1 separates report validity from product quality axes

`summary.json` SHALL carry `report_validity` and harness-derived `quality_axes` with `{applicable, required_for_release, verdict, blocking_class, source_checks[], resolution}`. Applicability and PASS/NOT_APPLICABLE invariants remain machine-validated. Current writers SHALL resolve non-passing applicable axes through `needs_fix` or `external_dependency` with owners `agent|toolchain|external`; quality-derived `needs_human`/owner `human` is legacy-read only and MUST NOT be produced as a way to await a signature. Capability-missing SHALL remain an external/capability projection distinct from evidence FAIL. Axes SHALL never be agent-reported, and non-UI features SHALL mark visual/asset axes not applicable.

#### Scenario: a legacy needs_human axis is reprojected

- **WHEN** a legacy summary carries visual `UNVERIFIED` with resolution `needs_human`
- **THEN** the current reader SHALL preserve it for diagnostics but current completion SHALL recompute from machine evidence as repair, capability-missing, or optional advisory rather than wait for a signer

### Requirement: Dual projections keep phase advance and release readiness distinct

The top-level phase verdict SHALL be produced only by the active phase matrix and `projectPhaseAdvanceVerdict`; `QualityAxis` MUST NOT gain a persisted `required_for_phase_advance` field or a second required-axis source. Feature completion and `release_readiness` SHALL project only from applicable axes marked `required_for_release` through `projectReleaseReadiness` and `verify-feature-completion`. A required FAIL or UNVERIFIED blocks the corresponding projection; capability-missing projects `DEFERRED_CAPABILITY_MISSING`; optional UNVERIFIED remains advisory only where the current release policy permits it. No human confirmation, receipt, manual resume, or accepted-debt state SHALL lift a deterministic FAIL or required evidence gap.

#### Scenario: phase matrix and release axis differ without duplicate fields

- **WHEN** a visual axis is optional for the current phase advance but required for release and remains UNVERIFIED
- **THEN** the phase MAY advance under the phase matrix while release remains blocked, with no `required_for_phase_advance` field written to the axis

#### Scenario: deterministic FAIL ignores a signer

- **WHEN** an applicable required axis is FAIL and a legacy human receipt or `confirmed_by` value is present
- **THEN** both current phase/release projections SHALL retain the machine FAIL according to their existing matrices

### Requirement: Legacy 1.0 summaries cannot silently feed current completions

A `summary.json` with schema_version 1.0 MAY be read and displayed, but SHALL NOT serve as a clean basis for current feature completion. The owner phase SHALL be re-run under the current gate fingerprint, or its axes SHALL be conservatively projected as incomplete/unverified.

#### Scenario: a legacy PASS is not current proof

- **WHEN** completion evaluates a schema-1.0 PASS summary without current evidence bindings
- **THEN** completion SHALL remain invalid until the responsible phase produces fresh current machine evidence
