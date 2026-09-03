# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: P0 skips and unreachable screens never launder into clean passes

**Superseded by `testing-stepresult-evidence-consumption` T8a.** A skipped or unexecuted P0 TC, and a P0 visual target registered unreachable, SHALL FAIL unless the cause is an enumerated external/capability blockage bound to real machine evidence, in which case the phase defers. An explicit skip or unexecuted case whose derive manifest has no StepResult SHALL remain testing-owned FAIL with zero automatic coding candidates; Maison MUST NOT infer a cause from TC names or report prose. Only the existing capability-resolution path may prove a missing provider and use the external/capability defer route. The dedicated headless halt `await_human_p0_skip` remains retired, and all P0 visual targets unreachable SHALL FAIL outright.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/{p0-semantic-gates,goal-failure-classifier,adjudication}.ts`

#### Scenario: unexecuted explicit skips remain testing-owned

- **WHEN** a derived plan registers TC-018 as an explicit skip with no StepResult, no waiver, and no machine-proven provider absence
- **THEN** `p0_coverage_integrity` SHALL FAIL as testing-owned with zero automatic coding candidates and SHALL not emit `phase_halt(await_human_p0_skip)` or a guessed coding route

#### Scenario: explicit skips without machine cause do not gain a coding route

- **WHEN** a derived plan registers 10 of 17 P0 TCs as explicit_skip with no waiver receipts and no StepResults
- **THEN** the gate SHALL FAIL and all ten SHALL remain testing-owned; no TC name, AC association, or report prose SHALL create `code_regression` or a coding candidate

## ADDED Requirements

### Requirement: Executed StepResult assertion mismatches are machine-fixable facts consumed by the candidate route

The testing summary writer SHALL project a `p0_coverage_integrity` FAIL finding into an ordinary `RepairCandidate(category=coding)` only when an executed case has an authoritative Hylyre `StepResult` with `failure_kind=assertion` and `failure_code=assertion_mismatch`, and the existing machine conjunction for that finding holds. The projection SHALL retain the existing check id, TC list/gate details, stable item fingerprint, and `source_phase` — no `skip_reason_class` / `responsible_phase` agent-reported fields and no registration of the whole check into the check-id owner registry. Explicit-only or otherwise unexecuted findings with no `StepResult` SHALL remain testing-owned with zero coding candidates. Candidates SHALL NOT be cleared by a negative product conclusion: `report_validity` SHALL constrain only report free-text-derived (review) candidates; machine check / verifier-conjunction candidates SHALL survive `report_validity=FAIL`. External/toolchain machine signals SHALL keep suppressing candidates through the existing DEFERRED path; prose claiming "external" without a machine signal SHALL not create or suppress a coding route.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`

#### Scenario: a FAIL summary keeps an executed assertion-mismatch candidate

- **WHEN** `report_validity=FAIL` while an executed case's `p0_coverage_integrity` finding has the `StepResult`-backed `assertion + assertion_mismatch` route and three visual candidates exist in the same summary
- **THEN** the assertion-mismatch candidate and the visual candidates SHALL still be produced and assess SHALL backtrack to coding; only review free-text candidates SHALL be suppressed

### Requirement: Device-scope P0 acceptance criteria require a P0-priority test case anchor

The `acceptance_to_test_case` traceability gate SHALL additionally assert, for every criterion with `ut_layer ∈ {device, both}` and `priority=P0`, that at least one test case with `priority=P0` references that criterion (reusing the existing `parsePlanTcEntries` parser — no second priority/AC parser, no new check id / failure kind / candidate). A TC downgraded P0→P2 SHALL NOT escape the P0 full-denominator gate: the reference alone (ordinary coverage) is insufficient, and the missing P0-priority anchor SHALL fail `acceptance_to_test_case` as BLOCKER owned by testing. The details SHALL list ordinary AC coverage and P0-priority alignment coverage side by side.

Enforcement: `harness/scripts/check-testing.ts`

#### Scenario: a P0 AC downgrade leaves the denominator

- **WHEN** the only TC referencing device P0 AC-5 is downgraded from P0 to P2 while the AC reference remains
- **THEN** `acceptance_to_test_case` SHALL FAIL (BLOCKER, testing) naming AC-5 as having no P0-priority TC; when another P0 TC references AC-5 the gate SHALL pass

### Requirement: Weakening-flag reports are judged by their conclusion, not by trace-faithful status words

Under a weakening flag (`--skip-assert-expected`), the test-report SHALL keep projecting the Hylyre trace four-state table verbatim (报告/报告 "通过" included), with the flag disclosed and the "action-chain completion ≠ acceptance pass" distinction stated. `pass_rate_calculated` SHALL NOT fail `reportedPass > 0` per se; instead it SHALL fail when the weakening flag is present AND the report conclusion (parsed by the existing conclusion parser) declares 达标 — action-chain success SHALL NOT wash into full acceptance. Missing disclosure, overall-rate overclaim, trace/report mismatches, and the fresh negative-summary contradiction SHALL remain FAIL; the trace ceiling and P0 full-denominator constraints stay.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/testing-trace-gates.ts`

#### Scenario: a faithful trace projection with a negative conclusion passes the report gate

- **WHEN** the command carries `--skip-assert-expected`, the table projects the trace's 通过 verbatim with disclosure and the distinction statement, and the conclusion is 不达标
- **THEN** `pass_rate_calculated` SHALL PASS (same verdict through the `quality-axes.ts` report-validity consumption); changing the conclusion to 达标 SHALL FAIL directly without relying on a fresh negative summary
