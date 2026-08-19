# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: P0 skips and unreachable screens never launder into clean passes

A skipped or unexecuted P0 TC, and a P0 visual target registered unreachable, SHALL FAIL unless (a) the cause is an enumerated external blockage bound to a real failure trace/error class — then the phase defers (DEFERRED path), or (b) a waiver with a valid confirmation receipt exists — then the finding degrades to WARN and the run caps at AWAITING_HUMAN_REVIEW with both coverage metrics still reported against the full denominator. Non-external causes (missing selectors, unfinished plans, product bugs) SHALL remain FAIL. The dedicated headless halt `await_human_p0_skip` SHALL be retired: when every unwaived gap of the round belongs to the existing `explicit_skip_tc_ids` registration, the gate SHALL reuse the existing `failure_kind=code_regression` with `actionability=agent_fixable` (default repair — lowering no acceptance standard is not an authorization act); when any unwaived gap has empty status or an unregistered trace skip, the gate SHALL remain FAIL without the coding attribution (testing restores execution/derived facts); external conditions SHALL keep the existing DEFERRED route and SHALL NOT be disguised as explicit skips. A valid waiver remains WARN + AWAITING_HUMAN_REVIEW (waivers only lower standards, never launder). All P0 visual targets unreachable SHALL FAIL outright.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/{p0-semantic-gates,goal-failure-classifier,adjudication}.ts`

#### Scenario: unwaived explicit-only P0 gaps default to coding repair

- **WHEN** a derived plan registers TC-018 as an explicit skip with no waiver, no external DEFERRED, and it is the only unwaived gap (e.g. 3 verified coding-oriented candidates coexist in the same summary)
- **THEN** `p0_coverage_integrity` SHALL FAIL with `failure_kind=code_regression` + `actionability=agent_fixable`, the summary writer SHALL produce a coding-owned repair candidate for it, and assess SHALL route `backtrack_to_phase` to coding — no `phase_halt(await_human_p0_skip)`, no WAITING/human

#### Scenario: ten P0 skips without receipts split by registration

- **WHEN** a derived plan registers 10 of 17 P0 TCs as explicit_skip with no waiver receipts
- **THEN** the gate SHALL FAIL; if all ten are registered explicit skips the finding SHALL carry `code_regression` and a coding candidate, while any TC with empty status or an unregistered trace skip SHALL keep the finding without the coding attribution (testing owns it)

## ADDED Requirements

### Requirement: Unwaived P0 explicit skips are machine-fixable facts consumed by the candidate route

The testing summary writer SHALL project `p0_coverage_integrity` FAIL findings only when the machine conjunction `id === 'p0_coverage_integrity' && status === 'FAIL' && failure_kind === 'code_regression'` holds, into ordinary `RepairCandidate(category=coding)` entries (existing check id, TC list/gate details, stable item fingerprint, `source_phase` — no `skip_reason_class` / `responsible_phase` agent-reported fields, no registration of the whole check into the check-id owner registry). Candidates SHALL NOT be cleared by a negative product conclusion: `report_validity` SHALL constrain only report free-text-derived (review) candidates; machine check / verifier-conjunction candidates SHALL survive `report_validity=FAIL`. External/toolchain machine signals SHALL keep suppressing candidates (existing DEFERRED path); prose claiming "external" without a machine signal SHALL NOT suppress an explicit-only coding candidate.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`

#### Scenario: a FAIL summary keeps its machine candidates

- **WHEN** `report_validity=FAIL` while `p0_coverage_integrity` is FAIL with `code_regression` and three visual candidates exist in the same summary
- **THEN** the p0 candidate and the visual candidates SHALL still be produced and assess SHALL backtrack to coding; only review free-text candidates SHALL be suppressed

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
