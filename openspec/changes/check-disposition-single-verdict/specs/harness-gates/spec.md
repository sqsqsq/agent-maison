## ADDED Requirements

### Requirement: One disposition function decides whether a failed check blocks the phase

Whether a check result blocks the current phase SHALL be decided by one disposition function and its boolean projection, the blocking predicate (`harness/scripts/utils/check-disposition.ts`). The function SHALL apply three rules in order and no fourth: a result that is not `FAIL` or not `BLOCKER` does not block; a result whose id matches the disposition table follows the table (`ledger_shape` is disclosed and does not block; `product_truth`, `result_basis` and `capability_gap` block); every other result follows its own declared severity and status. An id the runtime does not recognise — dynamically built, wrapped, or defined through a constant — SHALL follow its declaration; disclosure SHALL NOT be decided by whether an id is known.

The disposition table SHALL register only checks whose destination changes. Each entry SHALL name its match (an exact id, or a restricted dynamic family with a fixed prefix and its single producing file), the protected object, the responsible owner for `result_basis` (current phase, or spec / plan / coding), the basis (an incident or checklist number) and the consequence of letting it pass. A family prefix SHALL NOT cover an existing check id or another entry, and SHALL have exactly one producing point, counted only where it produces a check id.

Consumers that previously read the literal `FAIL`+`BLOCKER` conjunction — the legacy verdict and blocker count, the external-blocker projections, the fallback suggestion, quality axes, summary blockers, verifier request eligibility, the UT repair candidate, the adhoc correction report, and the coding / testing / UT aggregate panels and coverage-report gate — SHALL read the predicate. The violation hook (FAIL of BLOCKER or MAJOR), report validity (any FAIL), the request entry (any FAIL or applicable blocking SKIP), compat downgrade (position unchanged) and the scope-revision proposal (see below) SHALL keep their native criteria. A development-time static guard SHALL keep a generated baseline of blocking constructions and SHALL fail on a new literal blocking id not in the baseline or the table, on a file whose non-literal blocking constructions exceed the baseline, and on a literal `FAIL`+`BLOCKER` judgement outside the predicate module except the listed native-semantics sites.

Enforcement: `harness/scripts/utils/check-disposition.ts`, `harness/tests/unit/check-disposition.unit.test.ts`, `harness/tests/utils/check-disposition-scan.ts`

#### Scenario: An unregistered dynamic id keeps its declaration

- **WHEN** the testing failure router emits `testing_failure_routing_<case>_<step>` as a BLOCKER FAIL and the disposition table has no entry covering it
- **THEN** the predicate SHALL report it as blocking, exactly as its declaration says

#### Scenario: A registered ledger check is disclosed consistently

- **WHEN** a check registered as `ledger_shape` fails at BLOCKER severity
- **THEN** the legacy verdict, quality axes, summary blockers, verifier eligibility and fallback suggestion SHALL all treat it as not blocking, while report validity and the violation hook keep their native criteria

### Requirement: The phase conclusion is computed once and shared

The harness runner SHALL evaluate the phase conclusion once in memory with the existing quality lattice and effective-verdict functions, bound to the script report it was computed for, and SHALL recompute it when a fatal failure replaces that report. The console verdict, verifier request eligibility, the merged report's verdict line and final section, the summary writer, the full-track closure entry gate, the phase-state record, the lite-track closure and the process exit code SHALL all use that one result, without reading the summary back from disk. The script report SHALL keep its own `summary.verdict` for legacy readers and for the device-external INCOMPLETE branch of the next-action projection.

Where the script report's legacy verdict passes but the shared conclusion does not — report validity failing without a blocking failure, or a blocked capability — the exit code SHALL be non-zero and the console SHALL show the shared conclusion. The request entry, adhoc correction and argument or entry failures SHALL keep their own conclusions and exit codes.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/report-generator.ts`

#### Scenario: A review statistics failure is one conclusion everywhere

- **WHEN** review's only failure is `statistics_summary` (MAJOR, report validity) and the script report's legacy verdict is PASS
- **THEN** the exit code SHALL be non-zero, both console verdict lines SHALL read FAIL, the merged report SHALL say FAIL, summary SHALL be `verdict=FAIL`, and the goal runtime SHALL read FAIL from the same summary

#### Scenario: A blocked capability no longer exits zero

- **WHEN** a spec run has no requirement source so a capability resolves as blocked, the summary verdict is INCOMPLETE and the legacy verdict is PASS
- **THEN** the exit code SHALL be non-zero and the console SHALL show INCOMPLETE

### Requirement: Disclosed failures are listed and counted as completion gaps

`summary.json` SHALL carry `disclosed_failures` — each item with id, protected object, original severity and a details excerpt — for every failure the disposition function discloses; the current writer SHALL always write it (empty when nothing is disclosed) and older summaries without it SHALL remain valid. Each disclosed failure SHALL count as one completion gap, so a phase whose only failures are disclosed completes as `COMPLETE_WITH_GAPS` and is not blocked. The console summary and the goal report SHALL each render the list once.

Enforcement: `harness/scripts/utils/check-disposition.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`, `harness/schemas/summary.schema.json`, `harness/scripts/utils/goal-report-generator.ts`

#### Scenario: A disclosed schema version label

- **WHEN** a catalog run's only failure is `schema_version_present` with an empty-string label
- **THEN** the run SHALL exit zero with summary `verdict=PASS`, and `disclosed_failures` SHALL name `schema_version_present`

### Requirement: Aggregate run-status checks are not double-counted

`coding_run_status` and `testing_run_status` SHALL still be produced and SHALL still take part in the conclusion. When the aggregate fails and any of its source blocking failures (the `blocker_fail_ids` it lists) is already in the blocking set, the aggregate SHALL NOT enter the summary blocker list, the blocker count or the retry signature. When the aggregate fails without any source blocker in the set — caused only by a critical blocking SKIP or a missing required document — it SHALL stay listed. Every public blocker count (script report, Step 3 console, merged report, summary) SHALL be the size of that same effective blocking set; total and FAIL counts keep the raw checks.

Enforcement: `harness/scripts/utils/check-disposition.ts`, `harness/scripts/utils/summary-blockers.ts`, `harness/scripts/utils/report-generator.ts`

#### Scenario: A source failure and its aggregate count once

- **WHEN** a testing round has one source BLOCKER FAIL and the failing `testing_run_status` that lists it
- **THEN** the script report, console, merged report and summary SHALL all report one blocker, and the conclusion SHALL still be FAIL

### Requirement: The first classification registers one result-basis gate and six ledger checks

The disposition table SHALL register `ref_elements_excluded` as `result_basis` owned by the current phase, keeping it blocking for spec. It SHALL register as `ledger_shape` (disclosed): `context_exploration_searches_min`, `context_exploration_subagents_used`, `context_exploration_facts_schema_version`, `ut_mock_plan_typed`, `it_name_has_ac_or_branch_tag` and `schema_version_present`. Their entry boundaries SHALL stay as they are: the chain-head capability-resolution precheck still rejects a wrong facts schema at the establishing phase; the request entry still fails on any failure; the standalone `validate:ut-artifact` CLI keeps its own judgement. Registering `it_name_has_ac_or_branch_tag` also lifts the requirement-mode ban on `[REG-*]` names in the same failure; coverage stays decided by the AC coverage gates. `authoritative_content_aligned` SHALL stay unregistered and blocking until its drift and invalid branches are distinguishable in the result together with a design-owner exit.

The spec and plan scope-revision proposal (`designScopeRevisionChecks`) SHALL NOT refuse to publish design facts because of a failure the disposition function discloses; every other failure of any severity SHALL keep suppressing the proposal.

Enforcement: `harness/scripts/utils/check-disposition.ts`, `harness/scripts/utils/blueprint-skill-projection.ts`

#### Scenario: Ledger exploration counts no longer stop a review

- **WHEN** a review's only failures are `context_exploration_searches_min` and `context_exploration_subagents_used`
- **THEN** the review SHALL exit zero with `verdict=PASS`, both failures listed in `disclosed_failures`, and completion labelled `COMPLETE_WITH_GAPS`

#### Scenario: A disclosed ledger failure does not hold back a design fact

- **WHEN** a plan run's only failure is a disclosed exploration count and its contracts resolved
- **THEN** the scope-revision proposal SHALL still be produced, while any additional MAJOR failure SHALL suppress it

## MODIFIED Requirements

### Requirement: check-receipt reads current-run base summary

Closure SHALL read the current run's base summary, including its shared phase conclusion, and the resolved verifier policy directly. The receipt SHALL NOT be an input to closure and SHALL NOT enter the freshness hash. `check-receipt` SHALL remain as a read-only re-check of the same facts. feature/phase match, `verdict=PASS`, `blocker_count=0` and gate-fingerprint recomputation SHALL be judged from the base summary. The full-track closure entry gate, its blocker count and the lite-track closure SHALL read the base summary's verdict and blocker count, not the script report's legacy verdict.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/harness-runner.ts`

#### Scenario: A missing receipt does not block closure

- **WHEN** the base summary is PASS with zero blockers and the verifier policy is satisfied
- **THEN** the phase closes without any agent-written receipt

#### Scenario: A legacy PASS does not close a phase whose summary is not PASS

- **WHEN** the script report's legacy verdict is PASS but the base summary verdict is INCOMPLETE because a capability is blocked
- **THEN** neither the full-track closure entry gate nor the lite-track closure SHALL close the phase

### Requirement: A diagnosable product failure still issues a verifier request

Verifier request production SHALL be decided by one shared pure predicate consumed by both the prompt assembly step and the summary writer. Its inputs SHALL be the resolved verifier plan, the phase, the shared phase conclusion and the checks, the derived `report_validity`, and the existing `has_blocked` capability projection; no caller SHALL re-derive eligibility on its own, and the predicate SHALL NOT read a model, execute a provider, or persist state. BLOCKER FAIL in these conditions SHALL mean a failure the blocking predicate reports as blocking.

`disabled` SHALL produce nothing. `enabled` with a `PASS` phase conclusion SHALL keep the existing success path unchanged. `enabled` with a `FAIL` phase conclusion SHALL produce a request in exactly two shapes, both reproduced in production:

- **review** — `report_validity=PASS`, at least one BLOCKER FAIL, every BLOCKER FAIL is `negative_verdict_closure` or `conditional_pass_closure`, no BLOCKER SKIP not carrying the confirmed not-applicable marker, no blocked capability;
- **ut** — the UT compile gate PASS, the UT run gate FAIL attributed `code_regression`, no other BLOCKER FAIL, and no BLOCKER SKIP other than a marked one, no blocked capability, and `report_validity` not `FAIL`.

The confirmed not-applicable marker is the existing `structured.applicability=not_applicable` annotation read by `isCheckNotApplicable`, the same predicate that already excludes such SKIPs from `blocking_skips`. The marker exempts only a `SKIP`; it does not change how a BLOCKER `FAIL` is judged — the existing diagnosable product-failure exceptions stay as they are, and no other BLOCKER `FAIL` becomes eligible because of the marker. UT and hmos-app coding host checkers mark only exits that have confirmed the judged object is absent; missing/invalid artifacts, upstream-blocked and not-executed exits stay unmarked. The diagnosis notice in the prompt and the verifier template's diagnosis exception SHALL state the same condition and SHALL NOT claim that no BLOCKER SKIP exists.

Every other failure — `INCOMPLETE`, missing source, malformed report artifacts or UT structure, compile / device / toolchain failures, and any mix of a negative verdict with a material failure — SHALL produce nothing, preserving the existing "fix the input or the environment first" exit. A phase whose script report's legacy verdict passes but whose shared conclusion is `FAIL` or `INCOMPLETE` SHALL NOT be treated as the success path. UT SHALL NOT mechanically require `report_validity=PASS`: a pure UT round may legitimately be `UNVERIFIED` because no report-format check ran, and eligibility rests on the real compile and execution facts. `ut_run_status` is a derived MINOR WARN panel and SHALL NOT block a diagnosis the predicate already allowed.

Attribution SHALL be read as `CheckResult.failure_kind` first, falling back to the existing `失败归因：` details parser only when the structured field is absent; structured device/toolchain classification SHALL win over conflicting text. There SHALL be exactly one implementation of that fallback parser.

The product verdict, blocker count and `closure_status` SHALL NOT change because a diagnosis request was issued. A verifier PASS SHALL NOT be consumable as a product PASS, and the failing phase SHALL NOT be required to close before the diagnosis runs.

Enforcement: `harness/scripts/utils/verifier-plan.ts`, `harness/harness-runner.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`, `harness/scripts/check-ut.ts`, `profiles/hmos-app/harness/coding-host-rules.ts`

#### Scenario: A negative review verdict reaches the verifier

- **WHEN** review's script gate fails with `negative_verdict_closure` as its only BLOCKER FAIL, the report artifact checks pass, and no capability is blocked
- **THEN** the prompt SHALL be assembled, a request SHALL be issued and written to disk, and the summary SHALL still record `verdict=FAIL` with `closure_status=open` and no repair candidates until a report exists

#### Scenario: A negative verdict mixed with a material failure produces nothing

- **WHEN** review fails with `negative_verdict_closure` plus any other BLOCKER FAIL or a BLOCKER SKIP not carrying the confirmed not-applicable marker, or with `report_validity=FAIL`
- **THEN** no prompt, request or subject SHALL be produced and the next action SHALL remain the existing fix-the-blockers route

#### Scenario: A real UT assertion failure is attributed and released

- **WHEN** every selected ohosTest module produced a real execution result and each failing module ran, produced cases, and failed some with concrete failures, with no missing tool, no timeout, no non-clear install blocking and no structured on-device failure evidence
- **THEN** the `ut_hvigor_test` FAIL SHALL carry `failure_kind=code_regression`, its details SHALL remain the unmodified formatter text, and the UT diagnosis request SHALL be issued

#### Scenario: An environment failure is never re-attributed as a product defect

- **WHEN** the UT failure carries a structured device or toolchain classification, an incomplete module execution, `total=0`, or a timeout
- **THEN** the formatter's own attribution SHALL stand, `code_regression` SHALL NOT be written, and no diagnosis request SHALL be issued

#### Scenario: Marked not-applicable SKIPs do not block a UT diagnosis

- **WHEN** the UT compile gate passes, the UT run gate fails attributed `code_regression`, and every BLOCKER SKIP in the report carries the confirmed not-applicable marker (for example no L3 audit record, no MockKit import, no characterization DAG)
- **THEN** the UT diagnosis request SHALL be issued with the run gate as its released check, and the product verdict and SKIP status/severity SHALL stay unchanged

#### Scenario: An unmarked SKIP of the same shape still blocks the diagnosis

- **WHEN** the same UT report carries a BLOCKER SKIP without the marker — a missing or invalid artifact, an upstream-blocked gate or a gate that did not execute
- **THEN** no diagnosis request SHALL be issued and the existing fix-first route SHALL remain

#### Scenario: A legacy PASS with a failing shared conclusion issues nothing

- **WHEN** review's legacy verdict is PASS but its shared conclusion is FAIL because `statistics_summary` failed
- **THEN** no request SHALL be issued on the success path, and because no BLOCKER FAIL exists the diagnosis shapes SHALL not apply either
