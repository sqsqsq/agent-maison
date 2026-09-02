## MODIFIED Requirements

### Requirement: P0 device acceptance criteria are proven as structured state transitions

`check-spec` SHALL require every P0 device/both interactive AC to define ordered structured checkpoints bound to the ui-spec registry and verbatim requirement references. `check-testing` SHALL consume the Hylyre trace `CaseResult` and its `cases[].steps[]` as the execution evidence for every mapped P0 case. A case contributes to acceptance only when its `execution` is `completed`, `verification` is `passed`, `evidence` is `complete`, every required element is mapped to a `StepResult` with `role=assertion` and `outcome.status=passed` carrying a presence `outcome.observation`, and every forbidden element is mapped to the corresponding absence assertion with `role=assertion` and `outcome.status=passed` carrying an absence `outcome.observation`. That identity evidence SHALL be carried by a `by_id` selector request whose `value` equals the element id: a `by_text` request MUST NOT close required or forbidden coverage even when its resolution happens to report a matching `selected.id`, because `required_element_ids` are ids. There is no flat `StepResult.status`; reading one is reading a retired 0.3 field. Goal testing SHALL retain its existing run/attempt/HAP/device identity binding; ordinary interactive testing SHALL use the same StepResult evidence and SHALL NOT SKIP runtime evidence merely because a telemetry capability is absent. Agent prose, trace notes, legacy case status, self-reported PASS, and an unbound legacy runtime receipt MUST NOT satisfy the obligation. Pass-rate reporting SHALL include skips in the denominator and reject contradictory conclusions.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: StepResult evidence proves a P0 case

- **WHEN** all required and forbidden checkpoint assertions are present as current StepResults with `role=assertion`, `outcome.status=passed`, a `by_id` selector request matching the element id, and the case has `execution=completed`, `verification=passed`, and `evidence=complete`
- **THEN** the P0 acceptance obligation SHALL pass without consulting a plan-only status or a second evidence ledger

#### Scenario: Plan text or legacy status alone is insufficient

- **WHEN** a derived plan describes the right taps or a legacy trace says `通过` but a required assertion StepResult is missing or not passed
- **THEN** P0 semantic coverage SHALL remain FAIL/uncovered

### Requirement: P0 skips and unreachable screens never launder into clean passes

A skipped or unexecuted P0 TC and an unreachable required P0 visual target SHALL FAIL unless the cause is an enumerated external/capability blockage bound to real machine evidence, in which case the phase SHALL defer. An explicit skip or unexecuted case whose derive manifest contains only a TC id and no StepResult SHALL remain a testing-owned FAIL and SHALL produce zero automatic coding candidates; Maison MUST NOT infer a cause from the TC name, associated AC, or report prose. Only the existing capability-resolution path may classify a missing provider as capability defer. Missing status and unregistered trace skips remain testing-owned FAIL. New runs MUST NOT emit `await_human_p0_skip` or generic human-gate deferral for this evidence gap.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/goal-runner.ts`

The same execution-completeness rule SHALL cover every top-level test-plan TC, including P1 and P2: a trace/report that omits an explicit-skip or unexecuted TC MUST keep testing FAIL even when all represented P0 cases pass. A trace case present with native non-passing axes remains a testing failure; only a machine-proven provider capability absence may defer.

#### Scenario: Explicit skip without StepResult stays testing-owned

- **WHEN** a derived plan registers a P0 TC as an explicit skip without a waiver, StepResult, or machine-proven capability absence
- **THEN** `p0_coverage_integrity` SHALL FAIL, no automatic coding candidate SHALL be created, and the run SHALL remain in testing remediation

#### Scenario: A machine-proven provider absence may defer

- **WHEN** a P0 case has no StepResult and the existing capability resolution proves the required provider is unavailable
- **THEN** the phase SHALL use the existing capability/external defer path without guessing a product or coding failure

## ADDED Requirements

### Requirement: Hylyre CaseResult steps are the sole testing execution evidence

The testing consumer SHALL read the frozen Hylyre v1 shape: `CaseResult.execution` is `completed|aborted|infrastructure_failed`, `CaseResult.verification` is `passed|failed|inconclusive`, `CaseResult.evidence` is `complete|incomplete`, `CaseResult.expected_check_mode` is `checked_vlm|disabled_by_flag|unavailable_no_vlm|empty`, and `CaseResult.steps[]` is the sole execution ledger. Each `StepResult` carries `index`, `kind`, `role=action|assertion`, `duration_ms`, `device_session`, `outcome`, `selector`, `artifacts`, `diagnostic`, and `extensions`. Machine attribution lives inside `outcome` as a four-way discriminated variant — `passed` carries `observation`, `failed` carries `failure{domain,code}`, `blocked` carries `cause`, `skipped` carries `reason` — never as flat `failure_kind`/`failure_code` fields. `CaseResult.status` still carries the legacy Chinese enum as a compatibility projection and MUST NOT be consumed for any verdict. `StepResult` has no `verification` field. `tool_calls` and Markdown reports SHALL be projections from this trace, never an alternate source; Maison MUST NOT create a step-evidence sidecar, selector ledger, assertion registry, second case state, or synthetic StepResult from logs.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: A failed assertion cannot be laundered by a passed case status

- **WHEN** a legacy or compatibility case status says `通过` but a required assertion StepResult has `outcome.status=failed`
- **THEN** the acceptance gate SHALL NOT pass and SHALL report the uncovered requirement from the authoritative trace

#### Scenario: Action-only execution is inconclusive

- **WHEN** a case contains only `role=action` steps and no checked expected assertion
- **THEN** its execution MAY be `completed`, but its verification SHALL be `inconclusive` for acceptance and it SHALL NOT enter the acceptance pass numerator

#### Scenario: Expected checking is consumed from the trace

- **WHEN** `--skip-assert-expected` is present but deterministic assertion Steps fully cover a checkpoint and the trace records `expected_check_mode=disabled_by_flag`
- **THEN** Maison SHALL use the deterministic StepResult/checkpoint evidence for that acceptance decision and SHALL NOT infer whole-case failure from the CLI flag alone

### Requirement: Acceptance coverage is computed from checkpoint requirements and StepResult status

For native runs, the trace SHALL also be bound to the actual derived plan through the existing run/identity receipt: `trace.artifacts.plan`, top-level plan path/SHA, derived-plan path/SHA, and trace path/SHA SHALL identify the same run. The ordered planned-step count, `index`, and `kind` SHALL match that derived plan case-by-case; at most one `expected_check` StepResult MAY appear as the final tail row. A newer or edited derived plan MUST NOT be used to reinterpret an existing native trace.

Maison SHALL compute acceptance/P0 coverage from the plan's checkpoint requirements and authoritative StepResults. A case enters the acceptance pass numerator only if `execution=completed`, `verification=passed`, `evidence=complete`, all `required_element_ids` map to passed assertion Steps, and all `forbidden_element_ids` map to passed absence assertions. `verification=inconclusive` or `evidence=incomplete` SHALL remain in the uncovered denominator. A case with no assertion Step and no checked expected result SHALL NOT pass. This rule is shared by ordinary interactive and goal testing; goal-only identity and run binding are additional gates and SHALL NOT be removed.

Enforcement: `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/summary-blockers.ts`

#### Scenario: Forbidden evidence is required

- **WHEN** all required presence assertions pass but a checkpoint's forbidden element has no passed absence assertion
- **THEN** the case SHALL remain outside the acceptance pass numerator

#### Scenario: Inconclusive or incomplete evidence is not a pass

- **WHEN** a case has `verification=inconclusive` or `evidence=incomplete` despite an old status of `通过`
- **THEN** the case SHALL be counted as uncovered and SHALL NOT contribute `verification=passed`

### Requirement: Testing failure routing consumes the frozen Hylyre taxonomy

The assertion-mismatch coding route SHALL require `outcome.status=failed` with `outcome.failure.domain=assertion`, and SHALL reject any row that was never attempted (`blocked`/`skipped`, including the unexecuted suffix). Structured routing ownership for rich-text failures SHALL flow into the existing repair-candidate writer: coding/spec/plan owners may produce their corresponding existing category, while capability/external/testing owners produce no coding candidate.

For an attempted, failed step Maison SHALL route by the frozen `outcome.failure.domain` first and its namespaced `outcome.failure.code` only for explanation, never by `diagnostic` text. The closed domain set is `contract|selector|assertion|capability|infrastructure|internal`, and the default responsibility is: `assertion` → coding/product; `selector` → testing re-derivation and, if needed, plan anchors, except that an unresolvable inline target routes to a coding anchor or a spec/plan target definition; `capability` → capability defer and never coding; `infrastructure` → external/toolchain; `contract`/`internal` → testing fail-closed. An unknown namespaced code SHALL still route by its domain rather than fall through. An explicit skip or unexecuted case without StepResult has no machine failure taxonomy and SHALL remain testing FAIL with zero automatic coding candidates, unless the existing capability resolution provides a provider-missing fact. Maison MUST NOT invent a third failure enum or infer responsibility from prose.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: Assertion mismatch produces a coding candidate

- **WHEN** an attempted step has `outcome.status=failed` with `outcome.failure.domain=assertion`
- **THEN** the existing coding repair-candidate route MAY receive the finding

#### Scenario: Unsupported capability does not produce a coding candidate

- **WHEN** an attempted step has `outcome.status=failed` with `outcome.failure.domain=capability`
- **THEN** the finding SHALL defer through capability routing and SHALL produce no coding candidate

#### Scenario: Error prose is not a primary route

- **WHEN** an explicit skip has only a TC id, notes, or an error-like sentence and no StepResult/capability resolution
- **THEN** Maison SHALL keep testing FAIL and SHALL not classify it as coding or capability from that text

### Requirement: Testing uses a three-part Hylyre evidence gate and a bounded legacy policy

The new StepResult reconciliation path SHALL be enabled only when all three facts hold: Hylyre version is at least the configured minimum (`0.5.0`), the authoritative trace declares schema `0.4-p0` together with result protocol `hylyre.step-outcome/1`, and the trace actually validates against the frozen `output-schema.json` shipped in the vendored contracts **and** against the frozen cross-row invariants (prior_step root references, CaseResult three-axis reduction, run outcome, `candidate_count` recomputation, `tool_calls` projection). Envelope declaration alone SHALL NOT satisfy this requirement: a trace carrying flat `0.3` step fields under a `0.4-p0` envelope MUST be rejected. Version discovery SHALL reuse `hylyre-ready.meta.json → release.manifest.json → manifest.hylyre_version`; the installed/manifest/trace environment chain must agree, and version alone is insufficient. If any fact is false, every legacy case's old pass/status—including wait_for, wait_gone, toast, action-only, expected-unchecked, and no-evidence-axis cases—MUST be marked `legacy_assertion_evidence_untrusted` and MUST NOT independently contribute `verification=passed`; the default action is to upgrade Hylyre and rerun. Existing historical runtime telemetry may provide limited legacy evidence only for a specifically proven checkpoint with action hit, required/forbidden observations, and identity binding; new runs SHALL NOT invoke the deleted monkey-patch producer, and telemetry MUST NOT synthesize a generic CaseResult or StepResult ledger.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/hylyre-vendor-sync.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: An old version blocks new evidence consumption

- **WHEN** the reported Hylyre version is below the minimum even though a legacy case status is `通过`
- **THEN** the case SHALL be untrusted for verification and testing SHALL request an upgraded rerun

#### Scenario: A new version with an old schema still blocks

- **WHEN** the version is new but the trace schema lacks `CaseResult.evidence` or `CaseResult.steps[]`
- **THEN** the new path SHALL remain disabled and the legacy status SHALL not pass the acceptance gate

#### Scenario: Complete legacy telemetry is narrowly reusable

- **WHEN** the three-part gate is unavailable but existing telemetry completely proves one named checkpoint's action hit, required/forbidden observations, and run/attempt/device identity
- **THEN** only that checkpoint MAY be used as legacy evidence; no generic StepResult ledger SHALL be synthesized

### Requirement: Selector authorization and execution are two separate evidence gates

Static authorization, runtime verification, and P0 checkpoint mapping SHALL use one shared planned-step normalizer for direct roots, `action` wrappers, `all[]` match inheritance, `within`/`scope`/`index`, current-screen context, and canonical target IDs.

The feature ui-spec is an **open world**: it models the screens this feature adds and is not a closed registry of the whole application, so pre-existing entry screens are legitimately absent from it. The derive/static selector gate SHALL therefore emit a BLOCKER only for an error it can actually determine:

- a structurally illegal selector or an illegal `match` value;
- a formal `by_text` selector without an explicit `match` of `exact` or `contains` (the choice SHALL come from acceptance intent, not character heuristics);
- a selector the ui-spec itself proves is multi-mapped **on a uniquely determined current screen** while the plan carries no `index`, `scope`, `within`, or `all` disambiguator — when the current screen cannot be determined statically, candidates spread across screens are missing static information and SHALL be a WARN, not a BLOCKER;
- a `contains` selector whose only ui-spec hit is an aggregate Text/Row with children and no independently declared interaction target;
- an explicit conflict with an acceptance checkpoint, as bounded below.

A `by_id` or `by_text` selector that is merely absent from the feature ui-spec SHALL be a provenance WARN and SHALL NOT block execution; absence from an open-world document is missing static information, not proof of an illegal selector. Runtime dumps and snapshot caches MAY suggest selectors or emit WARNs but SHALL NOT authorize a static PASS.

The checkpoint-conflict BLOCKER SHALL be structural only: the same acceptance checkpoint already binds an action step declaring `target_element_id`, the plan's bound action declares `by_id`, both are non-empty, and the two differ. Maison MUST NOT extract an intended target from case names, preconditions, expected text, contracts prose, or neighbouring steps, and MUST NOT union ui-spec with acceptance or contracts into a second canonical selector registry. Acceptance and contracts MAY only explain provenance and responsibility inside a WARN.

Step success SHALL be decided by `outcome` and its `observation`; `selector.resolution` records the identity facts the executor actually obtained and is **not a second success state** for every operation. The runtime gate MUST NOT be written as a fixed bypass keyed on `request.kind`, because the real semantics follow the execution path: native provider-side resolution of a present `by_id`/`by_key` target yields `unique` with a real structured identity; native provider-side resolution of a target whose identity is invisible to the executor legitimately yields `outcome=passed` with `resolution=not_attempted`; and a resolver that itself resolves a text node may yield `unique` with `selected.id=null` and a non-empty `selected.bounds`.

Where `unique` is claimed it SHALL be strict: `candidate_count=1`, `selected` non-null, at least one of `selected.id`/`selected.bounds` non-empty, and the request value SHALL NOT be backfilled into `selected.id` to impersonate a real identity. `not_attempted` means **no identity evidence**: it SHALL NOT flip an otherwise legal passed step to failed, and it SHALL NOT be read as proof that a target was actually selected — a downstream identity requirement simply stays unproven. `not_found` is the resolver's confirmed zero-candidate fact, not a blanket failure: a passing absence assertion legitimately carries `not_found` with `candidate_count=0` and `selected=null`. `ambiguous` and `unresolvable` SHALL be consumed per the frozen contract and builder decision table, without deriving a second status from resolution.

The runtime gate SHALL NOT reject a hit merely because that selector is absent from the feature ui-spec; the ui-spec MAY still prove a known ambiguity, but a ui-spec miss is not a runtime failure condition. Identity guardrail: a P0 checkpoint's required/forbidden identity evidence SHALL be carried by `by_id` assertions — a successful `by_text` observation SHALL NOT substitute for identity proof, since `required_element_ids` are ids. Rich-text fragments SHALL be independently declared interaction targets and SHALL fail as an unresolvable inline target when real fragment semantics/bounds are unavailable; Maison MUST NOT click a parent Text/Row center or estimate coordinates and MUST NOT implement OCR here.

Enforcement: `profiles/hmos-app/harness/selector-contract.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/hylyre-selector-gates-v1.ts`

#### Scenario: Canonical contains is statically valid only when unique

- **WHEN** an explicit `match=contains` selector maps to one canonical ui-spec node on its screen
- **THEN** static selector authorization SHALL pass independently of the current dump/cache contents

#### Scenario: Ambiguous canonical text is rejected without disambiguation

- **WHEN** the same contains substring maps to multiple canonical nodes and no existing disambiguator is present
- **THEN** static authorization SHALL fail and SHALL not choose a candidate from the dump

#### Scenario: Runtime ambiguity is rejected

- **WHEN** an executed StepResult reports `resolution.state=ambiguous` with `candidate_count>1` and no existing disambiguator actually selected one
- **THEN** the action SHALL fail with the frozen selector classification rather than silently selecting the first candidate

#### Scenario: A selector outside the feature ui-spec warns instead of blocking

- **WHEN** a plan targets a pre-existing entry element by `by_id` that the feature ui-spec does not model, and no ambiguity, illegal match, aggregate-parent, or checkpoint conflict applies
- **THEN** the static gate SHALL emit a provenance WARN, SHALL allow the case to compile and run, and the run's own native selector evidence SHALL decide legitimacy

#### Scenario: Missing identity evidence neither fails nor credits a step

- **WHEN** a native step passes with a matching observation while its `selector.resolution` is `not_attempted`
- **THEN** the runtime gate SHALL NOT raise a selector violation, and SHALL NOT record a proven selected-target identity for it
- **WHEN** a step failed and its resolution is `not_attempted`
- **THEN** it SHALL still route by `outcome.failure` and SHALL NOT be laundered into a pass

#### Scenario: A resolver-resolved text node is a legal unique

- **WHEN** `resolution.state=unique` carries `candidate_count=1`, `selected.id=null` and a non-empty `selected.bounds`
- **THEN** it SHALL be accepted
- **WHEN** `selected.id` merely echoes the request value
- **THEN** it SHALL be rejected as an impersonated identity

#### Scenario: Cross-screen duplication without a known screen is not a determinable error

- **WHEN** the same selector maps to nodes on two screens and the case's precondition does not uniquely determine the current screen
- **THEN** the static gate SHALL WARN and allow execution, leaving the decision to the run's own selector evidence
- **WHEN** the current screen is uniquely determined and that screen alone holds multiple candidates without a disambiguator
- **THEN** the static gate SHALL BLOCK

#### Scenario: A structured checkpoint conflict blocks while prose does not

- **WHEN** an acceptance checkpoint structurally binds an action with `target_element_id` that differs from the plan action's non-empty `by_id`
- **THEN** the static gate SHALL BLOCK
- **WHEN** the checkpoint has no structured action binding and only its prose mentions a different element
- **THEN** no conflict SHALL be declared and no ID SHALL be inferred from that prose

### Requirement: Report-only reconciliation fully recomputes testing projections without a device

For native `schema_version=0.4-p0`, the timing producer SHALL sum each case's `steps[].duration_ms` and set `step_count` to the native ledger row count; log `cost:` allocation is permitted only for legacy schemas. Blocked, skipped, and trailing `expected_check` rows SHALL remain in the native case duration calculation.

Testing SHALL expose `--report-reconcile-only` as a testing-specific mode that reads only the existing authoritative trace, test plan, final device-test timing, build/install/run metadata, and current report inputs. It SHALL not invoke hvigor, hdc, Hylyre, any device/provider execution, visual capture, or executable lifecycle hook; it SHALL not create a new phase or sidecar. The mode SHALL rerun the complete report/static checks and use the existing writers to fully recompute `script-report`, summary, quality axes, and repair candidates rather than patching selected fields. The authoritative trace bytes SHALL remain unchanged. Before the writers consume the inputs, the mode SHALL close the same final run using existing fields: build/install `hapPath` and current HAP content fingerprint, build/install/run timestamps and `run_ended_at`, `timing.generated_at`, build/install reused values, trace feature, exact trace/timing case-id sets, run `trace_path`/`report_path`/`log_path`, and every report pipeline/case duration value. Report duration fields SHALL use exact integer milliseconds in `Nms` form (a valid comma-grouped form such as `1,234ms` MAY be read for legacy reports); a skip or blocked case already present in trace/timing SHALL use `0ms`, while `—` is reserved for an explicit skip not present in trace/timing. A missing or mismatched field SHALL FAIL closed. Report generation SHALL count skips in the correct denominator, use final build/install reused state and final timing, and backfill every case duration from the final run.

Enforcement: `harness/scripts/check-testing.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/summary-blockers.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `skills/reference/device-testing-workflow-detail.md`

#### Scenario: Reconciliation uses no device tools or lifecycle hooks

- **WHEN** an existing run has authoritative trace, plan, timing, report, and build/install/run metadata
- **THEN** `--report-reconcile-only` SHALL complete report/static reconciliation without invoking hvigor, hdc, Hylyre, device/provider execution, visual capture, or any executable lifecycle hook

#### Scenario: Reconciliation preserves the trace and recomputes outputs

- **WHEN** the report or summary contains stale derived values before report-only reconciliation
- **THEN** the mode SHALL leave trace bytes identical, reject any cross-run artifact combination, and rewrite the complete derived report/summary/quality axes from the authoritative inputs

### Requirement: Native StepResult evidence retires the telemetry bridge in stages

When native StepResult evidence is present, Maison SHALL consume only that evidence. Historical old-schema telemetry may be read for its actual pre/post dump, action hit, required/forbidden observation, and identity-bound checkpoint facts, but new runs SHALL invoke Hylyre directly and SHALL NOT use a private `_execute_one_step` monkey-patch. When both are present, native StepResult SHALL be authoritative and any mismatch SHALL be an explicit consistency warning, never a second verdict source; no compatibility layer may synthesize a generic `CaseResult.steps[]` ledger.

Enforcement: `profiles/hmos-app/harness/providers/device-test-run.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/hylyre-failure-routing-v1.ts`, `harness/scripts/check-testing.ts`

#### Scenario: Native evidence wins when both sources are present

- **WHEN** a trace contains native StepResults and old telemetry for the same checkpoint with different outcomes
- **THEN** Maison SHALL use the native StepResult outcome and emit a consistency warning without changing the verdict source

#### Scenario: Old telemetry cannot prove an unobserved checkpoint

- **WHEN** old telemetry lacks an action hit, required/forbidden observation, or identity binding for a checkpoint
- **THEN** that checkpoint SHALL remain unproven and Maison SHALL not synthesize a StepResult for it

### Requirement: Every top-level test case declares one compile-time execution channel

The top-level `test-plan.md` SHALL declare exactly one `execution_channel` per test case, with the frozen value domain `hylyre`, `visual`, `manual`, or `provider:<capability-id>`. The channel is a compile-time dispatch declaration authored and reviewed by the test author; it is not an execution status and SHALL NOT create a second result ledger. A formal plan whose case lacks a channel, declares an illegal value, or declares the same test case id on more than one row SHALL FAIL as a one-time migration requirement; a repeated id fails even when both rows carry the same value, because a duplicate cannot prove uniqueness and would place one case into two channel sets at once. Maison MUST NOT guess a channel from case names, prose steps, priority, or capability heuristics. The declaration SHALL be resolved once **before any build, install, Hylyre, or device action**: when it does not close, the run SHALL emit a structured BLOCKER with zero device calls and SHALL NOT execute the merely-legal subset. What a broken declaration blocks is device action, not analysis: the device-free report-only mode SHALL still recompute in full, because its own BLOCKER already keeps the phase failing and a historical run must remain diagnosable. The channel column SHALL participate in test-plan review and phase evidence/freshness: changing a channel changes plan identity and MUST NOT be rewritten silently during derive, execution, or report reconciliation. A P0 device checkpoint retains its runtime StepResult evidence obligation regardless of channel; `visual` and `manual` SHALL NOT be used to bypass it. Legacy plans without the column remain readable for historical artifacts only and SHALL NOT have their old explicit skips laundered into passes.

Enforcement: `harness/scripts/utils/test-plan-derive-hint.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/skills/device-testing/templates/test-plan-template.md`, `profiles/generic/skills/device-testing/templates/test-plan-template.md`

#### Scenario: A formal plan without the channel column blocks once

- **WHEN** a formal `test-plan.md` case carries no `execution_channel`
- **THEN** testing SHALL FAIL with a one-time migration instruction and SHALL NOT infer a channel from the case text

#### Scenario: An illegal channel value blocks

- **WHEN** a case declares `execution_channel` outside `hylyre|visual|manual|provider:<capability-id>`
- **THEN** the plan structure gate SHALL FAIL and name the frozen value domain

#### Scenario: A duplicated case id is rejected

- **WHEN** the same test case id appears on two rows of the case table, whether with the same channel or with two different channels
- **THEN** the declaration SHALL FAIL and that id SHALL NOT be counted into any channel set

#### Scenario: A broken declaration costs no device action

- **WHEN** the declaration is missing, incomplete, illegal, or duplicated
- **THEN** the run SHALL stop before build, install, Hylyre, and any device call, and SHALL NOT produce a partial trace from the legal subset

#### Scenario: Changing a channel changes plan identity

- **WHEN** a channel value differs between the reviewed top-level plan and the artifact consumed at execution or report reconciliation
- **THEN** the run SHALL FAIL closed rather than silently adopting the rewritten channel

### Requirement: Non-Hylyre channel cases carry a machine evidence obligation

A test case whose `execution_channel` is not `hylyre` SHALL still owe machine evidence, and SHALL remain in the pass-rate denominator as FAIL/UNVERIFIED until that evidence closes. A channel declaration is a dispatch fact, never a pass.

For `visual`, the obligation MAY close only through a binding whose every hop is an id-to-id lookup over existing structured artifacts: the case's structured acceptance references in the top-level plan, then those acceptance criteria's structured `checkpoint.pre_screen`/`post_screen`, then the same screen ids in the feature's authoritative visual-diff report. Maison MUST NOT infer the binding from case names, notes, linked flows, or report prose, and a missing hop SHALL be unbound rather than covered. The report SHALL be read from the feature's own visual artifact directory, validated by the existing visual-diff validator, and each bound screen SHALL additionally pass the existing evaluated-screenshot-hash, build-fingerprint, and evaluation-freshness checks; a screen whose recorded verdict cannot be re-verified against the on-disk screenshot and the current build SHALL NOT close the obligation. This obligation SHALL be evaluated **after** the visual capture and the visual gate itself, and SHALL consume that gate's actual verdict for the current run: an obligation evaluated before its evidence exists can only consume a stale artifact and SHALL NOT be treated as proof. Maison MUST NOT introduce a second, weaker reader of the visual report.

For `provider:<capability-id>`, the obligation SHALL remain fail-closed until the provider itself emits per-test-case results — at minimum a test case id, a machine-decided outcome, and a re-checkable artifact reference bound to the current run identity. Feature-level capability resolution state SHALL NOT close it: that a capability resolved does not prove that a given case executed and passed.

For `manual`, the obligation SHALL remain permanently fail-closed by design. Human confirmation, a confirmation receipt, a quality receipt, or a manual resume SHALL NOT satisfy it.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/execution-channel.ts`

#### Scenario: A visual case closes only through the full id chain over fresh evidence

- **WHEN** a `visual` case declares structured acceptance references whose checkpoints declare screens, the current-run visual gate passed, and every bound screen in the feature's visual-diff report carries a re-verifiable passing verdict for the current build
- **THEN** the obligation SHALL close for that case, and the closure SHALL cite the case, the acceptance ids, and the screen ids

#### Scenario: A visual case with an unverifiable screen verdict stays uncovered

- **WHEN** a bound screen's recorded verdict cannot be re-verified — the evaluated screenshot hash is absent or no longer matches the on-disk file, the evaluated build fingerprint is not the current build, or the evaluation is marked invalidated
- **THEN** the obligation SHALL NOT close, and the failure SHALL name the screen and the specific re-verification that failed

#### Scenario: The obligation is not evaluated before its evidence exists

- **WHEN** the channel evidence obligation would run before the visual capture and visual gate of the current run
- **THEN** it SHALL NOT close from any pre-existing artifact, because such an artifact cannot prove the current run

#### Scenario: A resolved capability does not close a provider case

- **WHEN** a `provider:<capability-id>` case's capability resolves successfully but no per-test-case provider result exists
- **THEN** the obligation SHALL remain unbound and the case SHALL stay FAIL/UNVERIFIED

### Requirement: The Hylyre channel compiles all-or-nothing and the derive writer owns no skip decision

The formal derive writer SHALL emit exactly the set of test cases whose top-level `execution_channel` is `hylyre`, and SHALL NOT add, remove, or rewrite a channel. It SHALL NOT emit new `explicit_skip_tc_ids`; legacy explicit-skip frontmatter and derive-manifest entries remain readable for historical artifacts only and SHALL NOT be produced by a new writer. When any `channel=hylyre` case fails to compile — unparseable steps, a step-lint BLOCKER, a selector-contract BLOCKER, or a missing same-case setup/navigation action before its first assertion — the whole Hylyre run plan SHALL NOT start, and the compiler SHALL report that case's real root cause and next responsible phase instead of degrading it to a skip.

Every `channel=hylyre` case SHALL contain at least one action step before its first assertion step in the same case. This is a structural minimum that keeps a page assertion from being evaluated on an unentered screen; it is not a screen state machine. The linter SHALL NOT parse precondition prose, derive cross-case screen state, or build a reachability graph.

Enforcement: `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/derive-hylyre-plan-hint.ts`

#### Scenario: An uncompilable entry case stops the whole run

- **WHEN** one `channel=hylyre` entry case cannot be compiled
- **THEN** no Hylyre plan SHALL be started, the report SHALL name that case's root cause and next responsible phase, and the writer SHALL NOT move it into an explicit skip

#### Scenario: An assertion without a same-case setup action does not compile

- **WHEN** a `channel=hylyre` case's first step is an assertion with no preceding action step in that case
- **THEN** compilation SHALL FAIL for that case, and therefore for the whole Hylyre plan

#### Scenario: New derive output carries no explicit skip

- **WHEN** a formal derive writes a new `test-plan.hylyre.md`
- **THEN** it SHALL contain no `explicit_skip_tc_ids`, while an existing historical artifact carrying them SHALL still be readable

### Requirement: The manual channel keeps an open obligation and cannot close a quality gate

`manual` SHALL mean the test obligation currently has no machine evidence carrier. Maison SHALL NOT provide a manual pass writer, `confirmed_by`, human quality receipt, or manual resume that closes testing for the run. Any case declared `manual` SHALL remain in the denominator as FAIL/UNVERIFIED, and the feature's testing verdict SHALL NOT reach PASS while such a case exists. This is frozen design rather than an executor defect, and the guidance SHALL state it plainly. A human observation MAY become correction input for a later phase, but never evidence that closes this run.

`visual` is intended to route into the existing visual capture/diff evidence path and `provider:<capability-id>` into the existing capability registry; neither may pass without its own machine evidence. A missing provider SHALL surface as an explicit capability gap and SHALL NOT be converted into a skip.

Because non-Hylyre cases are deliberately excluded from the derived/trace/timing exact sets, they SHALL still be adjudicated by an explicit obligation carrier rather than by a self-reported report row. Until a per-case evidence binding exists for a channel — a machine mapping from the case to its visual target or to its capability evidence — every case on that channel SHALL remain in the denominator as FAIL/UNVERIFIED. Fail-closed is required here: a channel with no binding MUST NOT be treated as passed, and the gap SHALL be reported as a missing binding rather than as an executor defect.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/capability-registry.ts`

#### Scenario: A manual case keeps the feature out of PASS

- **WHEN** every other case passes and one case is declared `manual`
- **THEN** testing SHALL remain FAIL/UNVERIFIED for the feature and no writer SHALL accept a human confirmation as this run's evidence

#### Scenario: A channel without a per-case evidence binding cannot pass

- **WHEN** a case is declared `visual` or `provider:<capability-id>` and no machine binding proves that case's own evidence
- **THEN** it SHALL stay in the denominator as FAIL/UNVERIFIED and SHALL NOT be closed by a report row that claims it passed

#### Scenario: A missing provider is a capability gap, not a skip

- **WHEN** a case declares `provider:<capability-id>` and the capability registry cannot resolve that provider
- **THEN** the run SHALL report an explicit capability gap and SHALL NOT rewrite the case as skipped

### Requirement: Coverage and report-only reconciliation are channel-precise

Derived-plan, trace, and timing exact-set reconciliation SHALL close against the `channel=hylyre` subset only. Non-Hylyre cases SHALL NOT be reported as missing trace rows, missing timing rows, or laundered as legacy explicit skips; each channel SHALL be reconciled by its own evidence rule. The report's overall denominator SHALL still close against every top-level test case, so a non-Hylyre case without evidence stays visible and unpassed. `--report-reconcile-only` SHALL apply the same channel-precise sets and SHALL NOT report trace-missing for a case that was never routed to Hylyre.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/utils/testing-trace-gates.ts`

#### Scenario: A visual case is not reported as missing from the trace

- **WHEN** a case is declared `visual` and therefore absent from the Hylyre derived plan, trace, and timing
- **THEN** the derived/trace/timing reconciliation SHALL treat the Hylyre sets as exactly closed and SHALL NOT emit a trace-missing finding for that case

#### Scenario: The overall denominator still covers every case

- **WHEN** the Hylyre subset reconciles exactly but a `manual` case has no evidence
- **THEN** the report denominator SHALL still include that case and the feature SHALL NOT be reported as fully covered

### Requirement: One fail-closed boundary dispatches trace schema and result protocol

Acceptance for any of these gates SHALL be driven by the frozen contract package's own golden corpus or by a released entry's real output. A hand-assembled trace, receipt, or evidence document SHALL NOT stand in for it, and a negative test SHALL assert the specific rejection reason rather than only the verdict: an assertion that merely observes FAIL cannot distinguish "rejected for the reason under test" from "rejected because the fixture itself was invalid", and has already hidden three separate invalid fixtures in this change. A test that drives a vendored CLI SHALL be proven device-free by inspecting that entry's source before it is registered in the default suite.

Maison SHALL decide the trace schema version and the declared result protocol at a single parse boundary and SHALL NOT scatter per-helper schema guesses across consumers. The boundary SHALL classify three outcomes: the frozen Hylyre Step Outcome protocol pair enters typed consumption **after** passing the frozen schema and cross-row verification; `0.3-p0` and `0.2` are explicitly legacy-unsupported-for-evidence and MAY be read only as non-blocking diagnostics; every other, missing, or mismatched combination is an explicit BLOCKER. The typed view SHALL NOT be produced by a bare type assertion — the boundary MUST validate against the frozen `output-schema.json` carried by the vendored contracts (the release excludes `harness/tests/**`, so a fixture path is not a legal production source) and MUST fail closed when that schema cannot be located, cannot be parsed, or uses a keyword the validator does not implement. No required testing gate may answer a schema mismatch by returning an empty result set, SKIP, or a no-op, and none may fall back to legacy Chinese case status, flat step fields, `tool_calls`, logs, or the retired runtime telemetry. An optional diagnostic helper MAY declare itself not-applicable after the boundary has dispatched, but MUST NOT swallow an unknown schema itself.

When Hylyre exits non-zero and produced no trace, the consumer SHALL first attempt the frozen pre-run plan-contract rejection envelope on stdout and classify a valid rejection as a testing/plan-contract failure. Only a missing, invalid, or protocol-mismatched envelope SHALL fall through to the existing subprocess crash classifier, which is an out-of-protocol backstop that MUST NOT read or synthesize protocol results. Standard error text SHALL NOT participate in machine classification.

The concrete typed field shapes — outcome variants, failure/cause/reason and resolution code faces, selector request/resolution, artifacts, and CaseResult/RunResult reduction — are owned by the external Hylyre contract freeze and are deliberately NOT restated here; this requirement fixes only the dispatch discipline that holds regardless of those shapes.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`, `profiles/hmos-app/harness/hylyre-spawn.ts`

#### Scenario: An unknown schema fails loudly instead of returning nothing

- **WHEN** a required testing gate receives a trace whose schema/protocol pair is unknown or mismatched
- **THEN** the gate SHALL emit an explicit BLOCKER and SHALL NOT return an empty result set, SKIP, or a legacy-status fallback

#### Scenario: A valid pre-run rejection is a plan-contract failure, not a crash

- **WHEN** Hylyre exits non-zero with no trace and stdout carries a single valid pre-run rejection envelope
- **THEN** the result SHALL be classified as a testing/plan-contract failure and SHALL NOT enter the subprocess crash classifier

#### Scenario: A missing envelope still reaches the crash backstop

- **WHEN** Hylyre exits non-zero with no trace and no valid rejection envelope on stdout
- **THEN** the existing subprocess crash classifier SHALL run and SHALL NOT fabricate a protocol result

### Requirement: A responsibility failure route requires an actually-executed failure

Exactly one responsibility failure route SHALL be produced per step that was actually attempted and actually failed. Ledger-completeness rows for steps that were never attempted — the unexecuted suffix after a root failure, and policy-skipped expected checks — SHALL produce zero failure routes, zero owner assignments, and zero coding candidates; they explain causality only and SHALL NOT inherit the root failure's classification. A case carrying no step ledger at all SHALL produce zero failure routes; that gap is reported only by execution completeness, which keeps it a testing-owned FAIL. Several genuinely failed steps in one case SHALL each produce their own route, with no first-only deduplication. Summary blockers and repair-candidate budgets SHALL consume only real failure routes, so one root failure cannot consume budget proportional to the number of unexecuted rows.

A machine-proven capability or infrastructure blockage that prevented execution SHALL produce zero failure routes and exactly one existing capability defer or external/toolchain disposition per root cause, deduplicated by case, index, and cause; the unexecuted suffix that depends on it SHALL NOT project again. A capability failure that did occur after the operation was attempted SHALL produce its single failure route whose disposition is the existing capability defer with zero coding candidates.

An assertion mismatch SHALL be admitted as a coding candidate only when the same case contains a smaller-index action step that actually passed. Without that fact the route SHALL stay testing-owned with zero coding candidates, so a first assertion evaluated on the wrong screen cannot forge a product-fix candidate. Maison MUST NOT derive that precondition from prose, diagnostics, or a neighbouring case.

Enforcement: `harness/scripts/utils/hylyre-failure-routing-v1.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/check-testing.ts`

#### Scenario: One root failure does not multiply into many routes

- **WHEN** a case records one genuinely failed step, five unexecuted rows that depend on it, and one policy-skipped expected check
- **THEN** exactly one responsibility failure route SHALL be produced and the unexecuted and skipped rows SHALL produce none

#### Scenario: A blocked capability defers without a failure route

- **WHEN** a step never executed because a machine probe proved the required capability unavailable
- **THEN** zero failure routes SHALL be produced, exactly one capability defer SHALL be projected, and the dependent unexecuted suffix SHALL NOT project a second one

#### Scenario: A wrong-screen first assertion is not a coding candidate

- **WHEN** the first failing assertion in a case has no smaller-index action step that passed
- **THEN** the route SHALL be testing-owned with zero coding candidates
- **WHEN** a smaller-index action step in that case did pass
- **THEN** the assertion mismatch MAY produce one coding candidate
