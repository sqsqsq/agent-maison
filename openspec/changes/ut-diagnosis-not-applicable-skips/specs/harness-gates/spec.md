## MODIFIED Requirements

### Requirement: A diagnosable product failure still issues a verifier request

Verifier request production SHALL be decided by one shared pure predicate consumed by both the prompt assembly step and the summary writer. Its inputs SHALL be the resolved verifier plan, the phase, the script verdict and checks, the derived `report_validity`, and the existing `has_blocked` capability projection; no caller SHALL re-derive eligibility on its own, and the predicate SHALL NOT read a model, execute a provider, or persist state.

`disabled` SHALL produce nothing. `enabled` with a `PASS` script verdict SHALL keep the existing success path unchanged. `enabled` with a `FAIL` script verdict SHALL produce a request in exactly two shapes, both reproduced in production:

- **review** — `report_validity=PASS`, at least one BLOCKER FAIL, every BLOCKER FAIL is `negative_verdict_closure` or `conditional_pass_closure`, no BLOCKER SKIP not carrying the confirmed not-applicable marker, no blocked capability;
- **ut** — the UT compile gate PASS, the UT run gate FAIL attributed `code_regression`, no other BLOCKER FAIL, and no BLOCKER SKIP other than a marked one, no blocked capability, and `report_validity` not `FAIL`.

The confirmed not-applicable marker is the existing `structured.applicability=not_applicable` annotation read by `isCheckNotApplicable`, the same predicate that already excludes such SKIPs from `blocking_skips`. The marker exempts only a `SKIP`; it does not change how a BLOCKER `FAIL` is judged — the existing diagnosable product-failure exceptions stay as they are, and no other BLOCKER `FAIL` becomes eligible because of the marker. UT and hmos-app coding host checkers mark only exits that have confirmed the judged object is absent; missing/invalid artifacts, upstream-blocked and not-executed exits stay unmarked. The diagnosis notice in the prompt and the verifier template's diagnosis exception SHALL state the same condition and SHALL NOT claim that no BLOCKER SKIP exists.

Every other failure — `INCOMPLETE`, missing source, malformed report artifacts or UT structure, compile / device / toolchain failures, and any mix of a negative verdict with a material failure — SHALL produce nothing, preserving the existing "fix the input or the environment first" exit. UT SHALL NOT mechanically require `report_validity=PASS`: a pure UT round may legitimately be `UNVERIFIED` because no report-format check ran, and eligibility rests on the real compile and execution facts. `ut_run_status` is a derived MINOR WARN panel and SHALL NOT block a diagnosis the predicate already allowed.

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
