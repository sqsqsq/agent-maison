## ADDED Requirements

### Requirement: Review closure produces a source-tree attestation that testing reconciles fail-closed

At the review four-artifact closure validation point (never from a standalone check-review run), the harness SHALL emit `review-closure-attestation.json` binding: contracts.yaml self hash and normalized files list; the full product source-tree inventory from profile-aware `discoverProductSourceRoots()` (union of outer-layer modules, build-profile modules, module-catalog package paths, profile standard roots, and residual src/main candidates; excluding test dirs, build outputs, framework/, doc/) with per-file sha256 and aggregate hash; review-report and verifier-report hashes; gate fingerprint; run/attempt identity. Two fail-safes: a discovered product source file belonging to no inventory root SHALL FAIL; an empty inventory for a project type expected to have product sources SHALL FAIL. check-testing SHALL reconcile the current tree against the attestation-frozen inventory: any added/modified/deleted non-test file → BLOCKER FAIL directing a review-closure re-run; a missing attestation SHALL FAIL with no grace window.

Enforcement: `harness/scripts/utils/closure-attestation.ts`（新增）, `harness/scripts/check-receipt.ts`（review 闭环点）, `harness/scripts/check-testing.ts`

#### Scenario: fast-path constant added after review is caught regardless of contracts registration

- **WHEN** a new source file or a modified constant (e.g. DEVICE_TEST_FAST_PATH=true) lands in a product directory after review closure, whether or not contracts.yaml lists it
- **THEN** testing reconciliation SHALL FAIL and demand a fresh review closure

### Requirement: Product behavior switches default-on are blockers with coordinate-bound waivers

A deterministic scan over in-scope non-test product sources SHALL FAIL (BLOCKER, coding and testing phases) on boolean constants matching the switch-name pattern (`FAST_?PATH|TEST_ONLY|FOR_TEST|DEVICE_TEST|E2E_ONLY|BYPASS|SKIP_(SMS|VERIF\w*|AUTH)`) initialized to true. A waiver SHALL bind exact {file, symbol, content_sha256, reason} plus a valid confirmation receipt, and even then SHALL only degrade the finding to WARN with the run capped at AWAITING_HUMAN_REVIEW — never a clean pass. Pattern-level waivers SHALL be rejected.

Enforcement: `harness/scripts/utils/behavior-switch-scan.ts`（新增）, `harness/scripts/check-{coding,testing}.ts`

#### Scenario: BankAddConstants fixture

- **WHEN** the scan meets `static readonly DEVICE_TEST_FAST_PATH: boolean = true` in a product constants file
- **THEN** it SHALL FAIL naming file and line

### Requirement: P0 device acceptance criteria are proven as structured state transitions

check-spec SHALL require, for every P0 device/both interactive AC: a structured checkpoint (`pre_checkpoint{screen_id} → action{type,target_element_id[,value_class]} → post_checkpoint{screen_id,required_element_ids,forbidden_element_ids}`) referencing the ui-spec screen registry — missing structure SHALL FAIL (non-P0: WARN). Flows integrity: every flow node/edge SHALL be owned by ≥1 P0 AC checkpoint; every P0 AC SHALL carry `requirement_ref{source_path,locator,snippet_sha256}` whose snippet verifiably exists in the source document; each flow SHALL equal the ordered composition of its owning checkpoints' edges (unsupported jump edges FAIL). check-testing (`p0_semantic_coverage_integrity`, BLOCKER) SHALL verify per mapped TC: pre-screen evidence, an action resolved to the target element (by_id directly, or coordinate touch resolved via pre-action layout dump hit-test — unresolvable or non-unique hits FAIL), post-screen evidence with required present and forbidden absent, and — across each linked_flow — the declared screen sequence appearing in order in the trace (missing intermediate screens FAIL). Normalized page signatures serve anti-replay only and never substitute for checkpoint assertions; P0 checkpoints SHALL persist screenshot/layout-dump evidence bound to trace steps. Pass-rate reporting SHALL recompute execution coverage (skips in the denominator) and pass rate separately; a report conclusion contradicting the recomputation SHALL FAIL.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, acceptance/ui-spec schema, layout-dump 链复用 layout-oracle-geometry-gates

#### Scenario: the incident fast-path trace fails on missing intermediate screens

- **WHEN** the bc-openCard trace shows bank_list touch followed directly by add_success evidence for flow main_add_card
- **THEN** p0_semantic_coverage_integrity SHALL FAIL naming the absent card_type_sheet/card_selection/sms_verification screens

#### Scenario: a PASS carries an explicit runtime-evidence boundary

- **WHEN** p0_semantic_coverage_integrity PASSes on plan-level step evidence + trace case status
- **THEN** it SHALL also emit a `p0_runtime_step_evidence_boundary` WARN stating that runtime action-target / step-sequence / hit-test / forbidden-element evidence is not yet verified (Hylyre provider step-level capture is a declared deferred item), so the PASS is not read as full runtime fidelity proof

### Requirement: P0 skips and unreachable screens never launder into clean passes

A skipped or unexecuted P0 TC, and a P0 visual target registered unreachable, SHALL FAIL unless (a) the cause is an enumerated external blockage bound to a real failure trace/error class — then the phase defers (DEFERRED path), or (b) a waiver with a valid confirmation receipt exists — then the finding degrades to WARN and the run caps at AWAITING_HUMAN_REVIEW with both coverage metrics still reported against the full denominator. Non-external causes (missing selectors, unfinished plans, product bugs) SHALL remain FAIL. Headless encounters of P0 skips SHALL halt as `await_human_p0_skip` with machine-generated guidance. All P0 visual targets unreachable SHALL FAIL outright.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/{goal-failure-classifier,await-confirm-guidance}.ts`

#### Scenario: ten P0 skips without receipts

- **WHEN** a derived plan registers 10 of 17 P0 TCs as explicit_skip with no waiver receipts
- **THEN** the gate SHALL FAIL and a headless run SHALL halt awaiting human disposition

### Requirement: Declared fidelity is reconciled against detected intent

check-spec (`fidelity_intent_reconciliation`, BLOCKER, both modes) SHALL FAIL when the dereferenced requirement text yields strong pixel intent while spec.md declares a lower fidelity tier, unless a human-signed fidelity deferral (existing mechanism, interactive-collected) covers it. This machine-enforces the previously prose-only "禁止的降级" rule.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: 「完全参考」×7 versus semantic_layout declaration

- **WHEN** the requirement SSOT repeatedly demands 完全参考 and spec.md declares fidelity_target: semantic_layout without a human deferral
- **THEN** the gate SHALL FAIL the spec phase

### Requirement: Visual capture completeness is tier-independent and reference images cannot be silently descoped

Missing/invalid visual-diff nav config with any declared P0 visual target SHALL be a completeness BLOCKER at every fidelity tier. Every ux-reference image SHALL map to a ui-spec screen_id or carry an explicit out-of-scope registration with crop provenance (parent image hash + bbox) or requirement citation; images directly cited by the requirement text SHALL NOT be agent-descoped; unprovable registrations require human confirmation (ledger must_review + status cap); a majority of images out-of-scope SHALL FAIL. Reachable screens SHALL still be captured and, at semantic_layout, checked via text-presence/structure comparison.

Enforcement: `harness/scripts/check-{spec,testing}.ts`, `profiles/hmos-app/harness/visual-diff-*`

#### Scenario: nav config missing at semantic_layout no longer degrades to WARN

- **WHEN** ui-spec declares P0 screens and visual-diff-nav.json is absent at semantic_layout
- **THEN** the capture gate SHALL FAIL instead of warning

### Requirement: Conditional review verdicts cannot close without resolution or authorization

When the review report declares 「有条件通过」, closure SHALL require structured findings accounting with all MAJOR findings closed (re-run loop) or a conditional-review authorization receipt; otherwise the review summary verdict SHALL be INCOMPLETE and the goal SHALL NOT advance. The LLM verifier's PASS attests report credibility only and SHALL NOT be consumed as product PASS.

Enforcement: `harness/scripts/check-review.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: the incident review report

- **WHEN** review concludes 有条件通过 with 2 open MAJOR findings and no authorization receipt
- **THEN** the phase verdict SHALL be INCOMPLETE and ut SHALL NOT start

### Requirement: Headless assumption ledgers are schema-validated and registry-complete

For goal-mode phases, check-receipt SHALL FAIL when `headless-assumptions.jsonl` is missing, schema-invalid, or lacks an entry (decision or explicit n/a with reason) for any in-phase gate listed in confirmation-registry.yaml for that phase. Free-form decisions outside the registry are honestly out of this check's scope (covered by deterministic gates above).

Enforcement: `harness/scripts/check-receipt.ts`, `skills/reference/confirmation-registry.yaml`

#### Scenario: registry gate without a ledger line

- **WHEN** the spec phase registry lists spec.freeze but the ledger has no corresponding entry
- **THEN** check-receipt SHALL FAIL the phase closure
