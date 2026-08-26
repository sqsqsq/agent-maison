## ADDED Requirements

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

summary.json schema_version 1.1 SHALL add top-level `report_validity: PASS|FAIL|UNVERIFIED` (artifact parseability/trustworthiness; conclusion-consistency checks feed it) and `quality_axes` with per-axis objects `{applicable, required_for_release, verdict, blocking_class, source_checks[], resolution}`. Invariants (machine-validated): `applicable=false ⇒ verdict=NOT_APPLICABLE ∧ required_for_release=false ∧ blocking_class=null`; `verdict∈{PASS,NOT_APPLICABLE} ⇒ resolution=null`; `verdict∈{FAIL,UNVERIFIED,STALE,MISSING} ⇒ resolution` required with `{class: needs_fix|needs_human|external_dependency, owner: agent|human|toolchain|external, retry_phase}`. Axes SHALL be derived by the harness from check results, never agent-reported. Non-UI features SHALL mark visual/asset axes `applicable:false`.

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/quality-axes.ts`（新增）, `harness/scripts/harness-runner.ts`

#### Scenario: a non-UI feature does not block on visual axes

- **WHEN** a feature with ui_change=none completes testing with all functional checks green
- **THEN** visual/asset axes SHALL be NOT_APPLICABLE and neither phase advance nor release readiness SHALL reference them

### Requirement: Dual projections keep phase advance and release readiness distinct

The legacy top-level verdict SHALL be produced by a single projection function from `quality_axes` filtered by `required_for_phase_advance` (per-phase matrix in phase-rules): any required-axis FAIL → FAIL; no FAIL but a required axis UNVERIFIED → INCOMPLETE; all required axes PASS → PASS. Feature completion / `release_readiness` SHALL project from axes filtered by `required_for_release`. `completion_status` labels (e.g. FUNCTIONALLY_COMPLETE_VISUAL_PENDING) are projection labels only and SHALL NOT bypass `verify-feature-completion`. Resolution classes map strictly onto existing semantics: needs_fix → PARTIAL / FEATURE_INCOMPLETE; needs_human → AWAITING_HUMAN_REVIEW cap; capability-missing → DEFERRED_CAPABILITY_MISSING. A human confirmation SHALL NOT lift a deterministic FAIL.

Enforcement: `harness/scripts/utils/{quality-axes,verify-feature-completion,phase-transition-policy}.ts`

#### Scenario: spec-phase functional UNVERIFIED does not block coding

- **WHEN** the spec phase closes with functional checks not yet executable (UNVERIFIED) but spec-phase required axes green
- **THEN** the phase-advance projection SHALL be PASS for spec while the release projection keeps functional UNVERIFIED on record

### Requirement: Legacy 1.0 summaries cannot silently feed 1.1 completions

A summary.json with schema_version 1.0 MAY be read and displayed, but SHALL NOT serve as a clean basis for a schema-1.1 feature completion: the phase SHALL be re-run under the current gate_fingerprint, or its axes SHALL be conservatively projected as INCOMPLETE/UNVERIFIED (never PASS-by-absence). This prevents historical fake-PASS runs from re-entering the new state machine.

Enforcement: `harness/scripts/utils/{quality-axes,verify-feature-completion}.ts`

#### Scenario: the incident's PASS summaries meet the new completion check

- **WHEN** verify-feature-completion evaluates a chain whose review summary is schema 1.0 verdict=PASS while the review report verdict was 不通过
- **THEN** the completion SHALL NOT be VALID on that lineage without a re-run under the current gate fingerprint
