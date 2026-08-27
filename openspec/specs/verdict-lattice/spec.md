# verdict-lattice Specification

## Purpose
TBD - created by archiving change blind-visual-hardening. Update Purpose after archive.
## Requirements
### Requirement: Negative product verdicts propagate and block phase closure

check-review SHALL FAIL (BLOCKER, `negative_verdict_closure`) when the review report's declared verdict (via `extractDeclaredVerdict`, the sole extraction entry) is 「不通过」, until issues are fixed and a re-run produces a non-negative verdict — mirroring the `conditional_pass_closure` texture and covering the branch it leaves open. check-testing SHALL apply the same rule to 「不达标」. The LLM verifier's PASS attests report credibility only and SHALL NOT be consumed as, or overwrite, a product verdict (code-level assertion, not prose).

Enforcement: `harness/scripts/check-review.ts`, `harness/scripts/check-testing.ts`

#### Scenario: the bc-openCard round-2 incident review closes as PASS

- **WHEN** review-report.md concludes 「审查结论: 不通过」 with 3 open BLOCKER findings and the script harness finds the report internally consistent
- **THEN** `negative_verdict_closure` SHALL FAIL the review phase (summary verdict != PASS) instead of closing it

### Requirement: Downstream phases consume fresh upstream machine verdicts, not re-parsed prose

At phase start, the harness SHALL gate on upstream phases' machine verdicts read from their summary.json (slice 1: top-level verdict + blockers; slice 2: `quality_axes`), bound by receipt/evidence-manifest freshness — an upstream negative or missing verdict, or a stale binding, SHALL block the downstream phase (BLOCKER). Markdown reports are parser input only; downstream gates SHALL NOT re-interpret upstream natural-language reports (TOCTOU guard). Slice 1 SHALL NOT depend on slice-2 structures.

Enforcement: `harness/scripts/utils/upstream-verdict-gate.ts`（新增）, `harness/scripts/check-{coding,review,ut,testing}.ts`

#### Scenario: ut starts after a failed review

- **WHEN** review summary verdict=FAIL (negative verdict) and the ut phase harness is invoked
- **THEN** ut SHALL FAIL at startup naming the upstream phase and its open blockers

### Requirement: summary 1.1 separates report validity from product quality axes

`summary.json` SHALL carry `report_validity` and harness-derived `quality_axes` with `{applicable, required_for_release, verdict, blocking_class, source_checks[], resolution}`. Applicability and PASS/NOT_APPLICABLE invariants remain machine-validated. Current writers SHALL resolve non-passing applicable axes through `needs_fix` or `external_dependency` with owners `agent|toolchain|external`; quality-derived `needs_human`/owner `human` is legacy-read only and MUST NOT be produced as a way to await a signature. Capability-missing SHALL remain an external/capability projection distinct from evidence FAIL. Axes SHALL never be agent-reported, and non-UI features SHALL mark visual/asset axes not applicable.

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`

#### Scenario: a legacy needs_human axis is reprojected

- **WHEN** a legacy summary carries visual `UNVERIFIED` with resolution `needs_human`
- **THEN** the current reader SHALL preserve it for diagnostics but current completion SHALL recompute from machine evidence as repair, capability-missing, or optional advisory rather than wait for a signer

### Requirement: Dual projections keep phase advance and release readiness distinct

The top-level phase verdict SHALL be produced only by the active phase matrix and `projectPhaseAdvanceVerdict`; `QualityAxis` MUST NOT gain a persisted `required_for_phase_advance` field or a second required-axis source. Feature completion and `release_readiness` SHALL project only from applicable axes marked `required_for_release` through `projectReleaseReadiness` and `verify-feature-completion`. A required FAIL or UNVERIFIED blocks the corresponding projection; capability-missing projects `DEFERRED_CAPABILITY_MISSING`; optional UNVERIFIED remains advisory only where the current release policy permits it. No human confirmation, receipt, manual resume, or accepted-debt state SHALL lift a deterministic FAIL or required evidence gap.

Enforcement: `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: phase matrix and release axis differ without duplicate fields

- **WHEN** a visual axis is optional for the current phase advance but required for release and remains UNVERIFIED
- **THEN** the phase MAY advance under the phase matrix while release remains blocked, with no `required_for_phase_advance` field written to the axis

#### Scenario: deterministic FAIL ignores a signer

- **WHEN** an applicable required axis is FAIL and a legacy human receipt or `confirmed_by` value is present
- **THEN** both current phase/release projections SHALL retain the machine FAIL according to their existing matrices

### Requirement: Legacy 1.0 summaries cannot silently feed 1.1 completions

A summary.json with schema_version 1.0 MAY be read and displayed, but SHALL NOT serve as a clean basis for a schema-1.1 feature completion: the phase SHALL be re-run under the current gate_fingerprint, or its axes SHALL be conservatively projected as INCOMPLETE/UNVERIFIED (never PASS-by-absence). This prevents historical fake-PASS runs from re-entering the new state machine.

Enforcement: `harness/scripts/utils/{quality-axes,verify-feature-completion}.ts`

#### Scenario: the incident's PASS summaries meet the new completion check

- **WHEN** verify-feature-completion evaluates a chain whose review summary is schema 1.0 verdict=PASS while the review report verdict was 不通过
- **THEN** the completion SHALL NOT be VALID on that lineage without a re-run under the current gate fingerprint
