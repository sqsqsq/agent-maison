# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Execution channels resolve to a machine-proven tri-state

Every top-level test case SHALL resolve at plan time to exactly one of `executable`, `unsupported_gap`, `invalid_test`. `unsupported_gap` SHALL be admitted only for a fixed no-primitive manual class (`system_settings`, `perf_sampling`, `memory_sampling`, `resource_variant`, `data_injection`, `external_precondition`) or a registered provider capability that is explicitly inactive/SKIP. Bare or unknown manual values, unregistered providers, and registered active providers without a per-TC producer SHALL be `invalid_test` before any build/install/device action. A gap SHALL NOT count as PASS or FAIL, SHALL NOT block normal development completion, and SHALL stay in the original denominator: P0 accounting SHALL report `total`, `verified_pass`, `unsupported_gap`, `failed` and `verified_coverage`, and the completion status SHALL project `COMPLETE_WITH_P0_GAPS` whenever a P0 gap exists.

Enforcement: `harness/scripts/utils/execution-channel.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/summary-blockers.ts`

#### Scenario: A gap stays in the denominator

- **WHEN** 16 P0 cases exist and 6 are `unsupported_gap` with machine-proven reasons
- **THEN** the report SHALL show total 16 / verified_pass 10 / unsupported_gap 6 / verified_coverage 62.5% and completion status `COMPLETE_WITH_P0_GAPS`, never "10/10 100%"

#### Scenario: An expressible case declared manual is a test-writing error

- **WHEN** a case only needs tap, input and presence assertions but is declared `manual`
- **THEN** the static check SHALL classify it `invalid_test` and block device execution with the fix "改为 hylyre 通道并写出步骤"

### Requirement: P0 identity assertions are injected when the derived plan is loaded

When testing copies the newest derived plan into the run directory it SHALL, for every P0 criterion checkpoint mapped to a case, insert a bare `{"wait_for":{"by_id":<id>,"timeout":N}}` for each required id and `{"wait_gone":{"by_id":<id>,"timeout":N}}` for each forbidden id after the checkpoint action step and before any `by_text` assertion resolving to the same canonical id. Existing equivalent bare assertions SHALL be kept (idempotent), agent-written predicate assertions (`visible`, `enabled`, layout, content) SHALL be preserved as UX assertions and never deleted, `scroll`/`swipe` actions SHALL NOT be rewritten to `touch`, and an ambiguous action or insertion position SHALL yield an actionable `invalid_test` gap listing the candidates instead of a guess. The source derived plan file SHALL NOT be modified; the run copy SHALL carry the injection list.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/utils/hylyre-planned-step-lint.ts`

#### Scenario: Injection is idempotent and ordered before by_text

- **WHEN** a case already has a `wait_for by_text` for the checkpoint element and no bare `by_id` assertion
- **THEN** the run copy SHALL gain one bare `wait_for by_id` placed before the `by_text` step, and a second load SHALL not add another

#### Scenario: Ambiguity is reported, not guessed

- **WHEN** two steps in the case could be the checkpoint action
- **THEN** no assertion SHALL be injected and the case SHALL be `invalid_test` naming both candidate steps

### Requirement: Derived-plan lints reject unbindable P0 shapes before device execution

`STEP-P0-IDENTITY` SHALL fire only when injection could not supply a bare identity assertion; `STEP-BYTEXT-ORDER` SHALL fire when a `by_text` assertion resolving to a checkpoint id precedes that id's identity assertion and injection could not reorder; check-spec SHALL reject a checkpoint `action` that is not an action value with the guidance to name the triggering action or use `required_element_ids`. Each BLOCKER SHALL name TC, step index, actual shape, expected shape and the direct fix. No Maison-side mirror of Hylyre selector constraint keys SHALL be maintained: identity is defined by exact step shape.

Enforcement: `harness/scripts/utils/hylyre-planned-step-lint.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`

#### Scenario: A predicate assertion is not an error

- **WHEN** a case carries `{"wait_for":{"by_id":"x","visible":true}}` and injection added the bare identity assertion
- **THEN** no lint SHALL fire; the predicate step stays as a UX assertion

### Requirement: Blocker diagnostics name the fix

Every BLOCKER FAIL emitted by a feature-phase check SHALL carry a suggestion naming the artifact or step to change and the change to make. Fixtures SHALL prove the root cause is named for `p0_coverage_integrity` (each uncovered AC → TC/step/reason), `hylyre_selector_runtime_gate` (`step N request.kind=composite, remove <key> or rely on the injected identity assertion`), `visual_diff` pending or warn without must_fix, `testing_channel_evidence_obligation`, `report_trace_reconciliation` (mismatched cells), `upstream_verdict_gate` and evidence staleness (changed paths translated to "re-run <phase>"), and derived-plan freshness ("re-derive"). Runtime-gate wording SHALL NOT describe an agent authoring mistake as executor fraud.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/hylyre-selector-gates-v1.ts`, `harness/scripts/utils/upstream-verdict-gate.ts`

#### Scenario: Composite selector is explained as a shape

- **WHEN** a P0 assertion step resolved with `request.kind=composite`
- **THEN** the gate detail SHALL name the step index and the constraint key and SHALL NOT use wording such as "疑似回填冒充"

### Requirement: Device execution is keyed by real execution inputs

Testing SHALL compute `execution_key = sha256(HAP full digest, run-copy derived plan digest, device identity and available display environment, reset mode, Hylyre/profile/provider/tool-config versions, normalized execution flags)` and record it in the run metadata. Full mode SHALL inspect only the newest real attempt carrying an execution key and reuse it only when that attempt has the current key, succeeded, and has complete trace/timing evidence. A newer different-key attempt or a newest same-key failure SHALL force a real run; temporary directories without an execution-key record SHALL not participate. It SHALL NOT reuse when the user asked for a fresh run or for N stability rounds. Document wording, report text and version numbers SHALL NOT trigger device operation. `--force-device` SHALL be the only explicit escape. Derived-plan freshness SHALL compare every execution/adjudication-relevant TC field (id, precondition, steps, expected result, AC links, priority and channel) while ignoring prose outside the canonical TC table; an uncomparable required column SHALL be stale.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/native-trace-binding.ts`, `profiles/hmos-app/harness/device-test-evidence.ts`, `profiles/hmos-app/harness/build-fingerprint.ts`

#### Scenario: Only the latest real attempt can be reused

- **WHEN** attempts are A(key-1 success), B(key-2 success), and the current key is key-1
- **THEN** testing SHALL run the device instead of reaching back past B to reuse A

#### Scenario: A later failure is never hidden by an earlier pass

- **WHEN** two attempts share a key and the later one failed
- **THEN** the earlier pass SHALL NOT be reused

### Requirement: Stability is computed per execution key and includes failed attempts

Stability SHALL be generated inside testing (no public CLI) by grouping attempts by the full execution key, including every eligible successful and failed attempt, carrying device environment and reset mode, counting only within the current requirement's scope, and reporting per TC the same-key rounds, consistent rounds and first divergent step. A requirement for two cold-start rounds SHALL require two real executions; the execution strategy SHALL be one full run plus one targeted cold-start re-verification of the relevant TCs.

Enforcement: `profiles/hmos-app/harness/test-report-writer.ts`, `harness/scripts/check-testing.ts`

#### Scenario: Failed attempts appear in the stability table

- **WHEN** three same-key attempts exist and one failed at step 7 of TC-013
- **THEN** the stability row for TC-013 SHALL show 3 rounds, 2 consistent, first divergence step 7

### Requirement: The testing report is generated by the harness and concludes per axis

`test-report.md` SHALL be generated by the harness from the authoritative run's trace, timing, build/install/run metadata, the gaps ledger, `visual-diff.json`, `visual-debt.json`, geometry measurement when present, the current quality axes and the stability data when present. Every section SHALL be deterministic and readable back by the existing report parsers. The conclusion SHALL be derived per axis — functional PASS/FAIL, interaction stability PASS/FAIL/UNKNOWN, visual geometry PASS/FAIL/UNKNOWN, visual content CHECKED/UNKNOWN, visual style CHECKED/UNKNOWN, known gaps — with an overall `COMPLETE` / `COMPLETE_WITH_GAPS` / `FAILED`. Incomplete visual evidence SHALL NOT block functional completion, and a report SHALL NOT claim UX conformance from the trace alone. Agent observations SHALL live in `testing/notes.md`, which SHALL NOT participate in gates, closure, subject or freshness. `--report-reconcile-only` SHALL regenerate the machine report. The review report's statistics table SHALL be recomputed by the checker, and citation/count lints SHALL be WARN only.

Enforcement: `profiles/hmos-app/harness/test-report-writer.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `harness/scripts/check-review.ts`, `harness/scripts/check-testing.ts`

#### Scenario: Functional pass with visual failure is not COMPLETE

- **WHEN** all 20 cases pass but `visual-diff.json` holds a FAIL screen
- **THEN** the generated conclusion SHALL show functional PASS, visual geometry FAIL and an overall that is not `COMPLETE`

### Requirement: Fast revalidation is a check executor, not a phase owner

`--revalidate --feature <f> [--from <phase>]` SHALL resolve the phase chain, recompute staleness, and for each stale phase run the necessary existing checks against the actual stale inputs. It SHALL NOT regenerate phase artifacts, SHALL NOT require a receipt, SHALL NOT run the verifier by default, and SHALL finalize a passing phase through the common finalize with `script_revalidated` and `semantic_not_reverified` recorded. A failing phase SHALL stop the chain and print its blockers and fixes. It SHALL NOT be described as a full semantic re-review.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/upstream-verdict-gate.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A spec edit is revalidated in one command

- **WHEN** acceptance.yaml changed after all six phases closed
- **THEN** one `--revalidate` run SHALL re-check plan, coding, review, ut and testing, close each on PASS, and mark them `semantic_not_reverified`

### Requirement: Post-review UX source drift is verified by risk tier

Source changes after review closure SHALL be classified and each class SHALL require exactly one matching verification: documents, reports and notes → none; test code → run the related tests; navigation, state or business interaction → one scoped diff review; layout, font, color or resources → one device screenshot or geometry re-check; several classes at once → one final merged diff review. The testing `review_closure_attestation` gate SHALL report the required tier and SHALL WARN, not BLOCK, when it is unmet, recording the honest state. Production source modified during the UT phase SHALL be reclassified as a coding change and routed to compile and tests rather than ignored or permanently blocked.

Enforcement: `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/utils/mutation-authorization.ts`

#### Scenario: Three layout constants need one geometry re-check

- **WHEN** three padding constants changed after review closure
- **THEN** the gate SHALL require one geometry re-check and SHALL NOT demand a full review→UT→testing rerun

## MODIFIED Requirements

### Requirement: Non-Hylyre channel cases carry a machine evidence obligation

A test case whose `execution_channel` is not `hylyre` SHALL still owe machine evidence; the obligation SHALL be projected through the tri-state. For `visual`, the obligation MAY close through the existing id-to-id binding into `visual-diff.json`. For `manual`, the case SHALL be `unsupported_gap` only when its `gap_reason` is one of the machine-proven no-primitive classes. For `provider:<capability-id>`, the case SHALL be `unsupported_gap` only when the capability is registered but inactive/SKIP; an unregistered provider or a registered active provider without a per-TC producer SHALL be `invalid_test` before device execution. `unsupported_gap` cases stay in the denominator, never count as PASS, and never block ordinary completion.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/execution-channel.ts`

#### Scenario: A proven gap completes with disclosure

- **WHEN** a P1 frame-rate case is declared with `gap_reason: perf_sampling` and no capability provides sampling
- **THEN** the run MAY complete as `COMPLETE_WITH_GAPS` with the case listed as unsupported_gap, not as PASS and not as a blocker

### Requirement: The manual channel keeps an open obligation and cannot close a quality gate

`manual` SHALL mean the obligation currently has no machine evidence carrier. Maison SHALL NOT provide a manual pass writer, `confirmed_by`, human quality receipt or manual resume. A `manual` case SHALL be classified by the tri-state: `unsupported_gap` when its reason is machine-proven, `invalid_test` when the current step primitives could express it. It SHALL never count as PASS; it SHALL NOT keep the feature from normal completion when it is a proven gap.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/capability-registry.ts`

#### Scenario: A manual case that Hylyre could run is rejected before the device

- **WHEN** a manual case's steps are all expressible with existing step primitives
- **THEN** the static check SHALL report `invalid_test` and device execution SHALL not start

### Requirement: Acceptance coverage is computed from checkpoint requirements and StepResult status

For native runs the trace SHALL be bound to the actual run-copy derived plan. Maison SHALL compute acceptance/P0 coverage from checkpoint requirements and authoritative StepResults: a case enters the verified numerator only if execution completed, verification passed, evidence is complete and every required presence / forbidden absence has a passed bare `by_id` StepResult at or after the checkpoint action. For `scroll` and `swipe` actions whose trace selector is null, the action SHALL be located by step kind and order and the checkpoint SHALL bind through the post-state identity assertions. Accounting SHALL report total, verified_pass, unsupported_gap, failed and verified_coverage.

Enforcement: `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/summary-blockers.ts`

#### Scenario: A scroll checkpoint binds through post-state

- **WHEN** the checkpoint action is `scroll` and the trace scroll step has `selector: null` but the injected `wait_for by_id` after it passed
- **THEN** the case SHALL count as verified for that checkpoint

### Requirement: Review closure produces a source-tree attestation that testing reconciles fail-closed

At review closure the harness SHALL still emit `review-closure-attestation.json` with the source-tree inventory. Testing reconciliation SHALL classify each drifted file by risk tier and report the single verification the tier requires; an unmet tier SHALL be a WARN carrying the honest state, not a BLOCKER, and SHALL NOT demand a full review rerun.

Enforcement: `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/check-testing.ts`

#### Scenario: A default-on behavior switch is still caught by its own gate

- **WHEN** a fast-path constant lands after review closure
- **THEN** `product_behavior_switch_scan` SHALL still block it; the attestation gate itself reports the tier

### Requirement: check-receipt reads current-run base summary

Closure SHALL read the current run's base summary, the script verdict and the resolved verifier policy directly. The receipt SHALL NOT be an input to closure and SHALL NOT enter the freshness hash. `check-receipt` SHALL remain as a read-only re-check of the same facts. feature/phase match, `verdict=PASS`, `blocker_count=0` and gate-fingerprint recomputation SHALL be judged from the base summary.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/harness-runner.ts`

#### Scenario: A missing receipt does not block closure

- **WHEN** the base summary is PASS with zero blockers and the verifier policy is satisfied
- **THEN** the phase closes without any agent-written receipt

### Requirement: Slim receipt keeps only non-derivable self-attestation

The receipt SHALL be a machine-generated read-only projection of closure facts. It SHALL contain no agent-filled fields: no agent model, timestamps, commit sha, verifier paths, testing artifact paths or anti-assumption checkboxes. Agent remarks SHALL go to `<phase>/notes.md`, which is non-gating.

Enforcement: `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`, `harness/harness-runner.ts`

#### Scenario: Editing notes never stales a closure

- **WHEN** the agent appends a remark to `<phase>/notes.md` after closure
- **THEN** no manifest becomes stale and no phase reopens

### Requirement: Report-only reconciliation fully recomputes testing projections without a device

`--report-reconcile-only` SHALL read the existing authoritative trace, plan, timing, metadata and current inputs, regenerate the machine report, and recompute report/static gates, summary, quality axes and repair candidates without invoking hvigor, hdc, Hylyre, device or provider execution, visual capture or lifecycle hooks. The verifier subject SHALL follow the reviewed material only; a regenerated report changes the subject only when its machine content changed.

Enforcement: `harness/scripts/check-testing.ts`, `harness/harness-runner.ts`, `profiles/hmos-app/harness/test-report-writer.ts`

#### Scenario: Notes do not rotate the subject

- **WHEN** only `testing/notes.md` changed since the last full run
- **THEN** report-only reconciliation SHALL leave the verifier subject unchanged

### Requirement: check-receipt adjudicates verifier evidence by identity, dispatched on the resolved plan and the summary generation

The finalize step SHALL adjudicate verifier evidence. plan `disabled` → nothing required; plan `blocked` → BLOCKER `verifier_provider_unavailable`; plan `enabled` → load `verifier.report.<subject>.json` for the current subject through `loadVerifierEvidence()`. When the current subject has no report but the phase holds any identity-verified PASS report, closure SHALL proceed with `verifier: completed_with_prior_review` and `current_material_not_reverified` listing the differing material; it SHALL NOT be described as PASS for the current material. BLOCKER SHALL remain only when the policy is `required` and the phase never obtained a PASS report. Earlier-generation summaries keep the existing grandfather rule.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/verifier-evidence.ts`

#### Scenario: Changed material with a prior PASS completes honestly

- **WHEN** spec.md changed after a verified PASS and the driver did not re-run the verifier
- **THEN** the phase closes with `completed_with_prior_review` and the summary lists `spec.md` under `current_material_not_reverified`

### Requirement: Direct-mode UT source-mutation gating is attestation-first and never accepts partial closure evidence as a downgrade licence

Outside the goal environment the UT gate SHALL still select its baseline by attestation availability and reconcile drift by per-file content hash. Its outcome SHALL be reclassification and tiered verification: production source changed during UT SHALL be reported as a coding change routed to compile and the related tests, with WARN and honest status, never a permanent BLOCKER. Unavailable closure evidence SHALL be reported as `review_closure_baseline_unavailable` WARN.

Enforcement: `harness/scripts/check-ut.ts`, `harness/scripts/utils/mutation-authorization.ts`

#### Scenario: UT touches production code

- **WHEN** a UT-phase edit modifies a production `.ets` file
- **THEN** the gate SHALL classify it as a coding change requiring compile plus related tests and SHALL not block closure permanently

### Requirement: Goal-env source-mutation gating shares the review-closure baseline and never trusts self-reported approvals

In the goal environment the UT gate SHALL judge drift against the review closure attestation through the shared reconciliation and SHALL project the same tiered outcome as direct mode; self-reported approvals SHALL still carry no weight.

Enforcement: `harness/scripts/check-ut.ts`, `harness/scripts/utils/mutation-authorization.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Goal-env drift is tiered, not halted

- **WHEN** one file drifted after review in a goal run
- **THEN** the gate SHALL report the file's tier and required verification instead of an unresolved halt

### Requirement: Harness output includes deterministic next-step guidance

Feature-scope phase checks SHALL append a bounded next-step block outside the `HARNESS_SUMMARY` machine block and SHALL end with a single `NEXT:` line naming the action to take, the check id and the path or step to change. Failures-only output SHALL remain the default.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/assess.ts`

#### Scenario: A failing run tells the agent what to do

- **WHEN** a feature phase check exits with one BLOCKER
- **THEN** the last line SHALL read `NEXT: 修 <check id> 见 <path或step>，然后重跑本 harness`
