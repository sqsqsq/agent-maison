# feature-artifact-layout Spec Delta

## ADDED Requirements

### Requirement: A diagnosis prompt states the failure, the released checks and the terminal-state rule

When the request was issued under the diagnosable-product-failure path, the assembled `ai-prompt.md` SHALL carry a section stating that this round's script verdict is FAIL, listing the check ids that were released, and restating the terminal-state counting rule. It SHALL be produced as an in-memory option of the existing prompt assembly — no new request field, no persisted mode, no second prompt producer. Ordinary verification requests SHALL be byte-identical to before.

The embedded script report SHALL remain the raw FAIL report. It SHALL NOT be projected into a PASS, and the section SHALL state that the product's FAIL and open closure are unchanged by the verifier's conclusion.

Enforcement: `harness/scripts/utils/report-generator.ts`, `harness/harness-runner.ts`

#### Scenario: The notice reaches the file the verifier actually reads

- **WHEN** a diagnosis request is assembled
- **THEN** both the returned prompt text and the `ai-prompt.md` written to disk SHALL contain the section, naming every released check id and the `blocker_count` rule

#### Scenario: A normal request carries no notice

- **WHEN** the script gate passed and the request is an ordinary verification request
- **THEN** the assembled prompt SHALL contain no diagnosis section

### Requirement: Verifier check status is read from the formal summary table and the legacy YAML alike

The machine reader of per-check verdicts SHALL parse the formal §7.1 summary table through the shared markdown table extractor, accepting only a table whose headers exactly contain `id` and `status`, and SHALL additionally accept the legacy `- id: / status:` YAML shape. The formal prompt requires the summary table to list every check including PASS rows while the YAML detail block lists only non-PASS items; reading the YAML alone made every PASS machine-invisible, so a report that follows the prompt and one that ignores it produced different candidate sets from the same conclusion.

Only `PASS`, `FAIL` and `WARN` SHALL be recognized. Repeated consistent statements of the same check SHALL dedupe to one value. Conflicting statements, and statuses that are absent, placeholder or otherwise unrecognized, SHALL NOT be accepted and SHALL fall through to each consumer's existing unconfirmed / format-repair path; the reader SHALL NOT resolve a conflict by choosing the favourable `PASS`. Cell decoration (backticks, emphasis) SHALL be normalized, but the check id itself SHALL be preserved intact. After that normalization the whole cell SHALL match a single status **exactly**: scanning for the first status word inside the cell accepts a conflict (`PASS / FAIL`), a negation (`NOT PASS`) and an unfilled placeholder (`<PASS>`) as `PASS`, which is the same "choose the favourable value" the paragraph forbids.

`end_to_end_driving`, `business_assertion_value` and `device_ac_delegation` SHALL share this one reader. The verifier SHALL NOT be asked to emit an extra PASS YAML block to compensate, and review's per-issue verification and evidence binding SHALL be unchanged — a summary-table PASS SHALL NOT substitute for a per-issue `confirmed`.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/markdown-parser.ts`, `harness/prompts/verify-ut.md`

#### Scenario: The formal table and the legacy YAML yield the same candidates

- **WHEN** the same conclusions are expressed once as a §7.1 summary table and once as legacy per-check YAML
- **THEN** the candidate assembly SHALL produce identical results

#### Scenario: A conflict is refused rather than resolved

- **WHEN** the summary table and the YAML detail block state different statuses for the same check
- **THEN** the reader SHALL return no status and no candidate SHALL be derived from it

#### Scenario: A conflicting, negated or placeholder cell is refused

- **WHEN** a status cell reads `PASS / FAIL`, `NOT PASS` or `<PASS>`
- **THEN** the reader SHALL return no status and no candidate SHALL be derived from it

## MODIFIED Requirements

### Requirement: Verifier output is a terminal block plus an item table

The verifier's answer SHALL consist of the versioned terminal block and one table of check id / verdict / one-line evidence / fix, with no prose sections.

The terminal block SHALL carry exactly one meaning in both the ordinary and the diagnosis branch: `blocker_count` is the number of items in **this round's own semantic checks** whose severity is BLOCKER and whose status is FAIL; `verdict=PASS` if and only if `blocker_count` is zero. The block SHALL echo the current subject. `FAIL` with zero blockers and `PASS` with a non-zero count SHALL be rejected as invalid evidence.

Confirmed product defects SHALL NOT enter that count. A review report that accurately confirms N unclosed product problems while the review itself has no semantic BLOCKER FAIL SHALL be `PASS / 0`, and the product summary SHALL remain FAIL and open — the report's credibility and the product's quality are two separate facts. A diagnosis request SHALL NOT force the report to inherit the product's FAIL, and SHALL NOT be answered by skipping the semantic checks: for UT, the two candidate-required checks SHALL still be evaluated, because their PASS/FAIL is what decides whether the failure routes to coding or back to the tests. Equally, a `PASS` terminal block SHALL NOT be described as the product passing.

Where the round is not a diagnosis request, the native compile and execution preconditions on the verifier SHALL be unchanged.

Enforcement: `harness/prompts/verify-spec.md`, `harness/prompts/verify-plan.md`, `harness/prompts/verify-coding.md`, `harness/prompts/verify-review.md`, `harness/prompts/verify-ut.md`, `harness/prompts/verify-testing.md`, `agents/claude/templates/agents/verifier.md`, `harness/scripts/utils/verifier-evidence.ts`

#### Scenario: The report returned to the driver is short

- **WHEN** a verifier finishes a phase with 12 checks
- **THEN** its final message is the 12-row table and the terminal block only

#### Scenario: An accurate report of a failing product is PASS / 0

- **WHEN** a review diagnosis confirms three unclosed product defects and the review round itself has no BLOCKER-severity semantic FAIL
- **THEN** the terminal block SHALL be `PASS / 0`, the per-issue confirmations SHALL be able to drive candidates, and the product summary SHALL stay FAIL with `closure_status=open`

#### Scenario: A UT diagnosis still evaluates the candidate-required checks

- **WHEN** a UT diagnosis request is answered
- **THEN** `end_to_end_driving` and `business_assertion_value` SHALL each carry a real verdict, and the product execution FAIL SHALL remain recorded by the harness rather than copied into the terminal block
