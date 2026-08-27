## MODIFIED Requirements

### Requirement: Full-track closure is published by staged summary commit

The closure finalizer SHALL validate evidence, construct final summary bytes, generate the phase evidence manifest from the staged summary hash while recording the canonical summary path, publish the receipt pointer and strict phase state, and atomically publish the canonical summary last. Before generic freshness rejection, it SHALL recognize a partial publication from the same finalization by verifying the staged summary, expected canonical path/hash, receipt, run/attempt identity, manifest, pointer, and phase state, then idempotently complete only the missing steps. An unprovable partial state SHALL remain open/untrusted and return to the owner phase; arbitrary current bytes MUST NOT be rebound as evidence. No new journal or sidecar is introduced.

Enforcement: `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-state.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/upstream-closure.ts`

#### Scenario: crash after manifest publication

- **WHEN** manifest publication succeeds but the process crashes before pointer, state, or canonical summary publication
- **THEN** resume SHALL identify the same staged transaction before stale rejection and idempotently finish it, or backtrack the owner if identity proof fails

#### Scenario: closed summary bytes drift

- **WHEN** a closed canonical summary hash no longer matches its manifest and no runner-owned equivalence proof exists
- **THEN** the finalizer SHALL invalidate the closure and return to owner revalidation instead of publishing a new binding for the current bytes

### Requirement: Ruling-class escalation reads the hard-pixel contract; execution keeps the pixel target

Severity ratcheting and completion capping SHALL key on `isHardPixelContract`; high-fidelity execution machinery SHALL keep keying on the pixel execution target. Under best-effort, quality gaps keep their existing severities and optional debt policy. Deterministic content integrity failures remain unconditional BLOCKERs. Missing required visual capability SHALL defer; missing/invalid evidence after capability was declared SHALL fail the owning checker. Human-confirmation state and historical visual ledgers MUST NOT affect severity, capability, phase advance, or completion.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/harness-runner.ts`

#### Scenario: human confirmation does not change the ruling class

- **WHEN** a hard-pixel deterministic visual defect is present together with legacy confirmation metadata
- **THEN** the defect SHALL retain its existing BLOCKER/repair semantics

### Requirement: Blind-crop c3 waiver requires this-invocation machine verification with binding revalidation

Under a blind adapter, a crop asset SHALL be admitted only when current machine evidence proves the source image/hash, normalized bbox, resolved output hash/path, file sanity, and the applicable independent recognition/content check. User-supplied files or bbox values MAY be retained as neutral frozen input provenance, but `confirmed_by`, `human_crop_confirmed`, a chat answer, or a pre-written verified-looking report MUST NOT waive verification. When machine verification is unavailable, the asset SHALL use an allowed visible placeholder with debt, fail for a required asset, or defer for a real missing capability.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`, `profiles/hmos-app/harness/asset-acquisition.ts`

#### Scenario: legacy crop signature cannot admit an unverified crop

- **WHEN** a blind crop carries `crop_confirmed_by` but its source/hash/bbox/output binding cannot be machine verified
- **THEN** the crop SHALL not be admitted and SHALL follow placeholder, FAIL, or capability-defer policy

### Requirement: Product behavior switches default-on are blockers with coordinate-bound waivers

A deterministic scan over in-scope non-test product sources SHALL FAIL on default-enabled test/bypass behavior switches. Current runs MUST NOT accept a behavior-switch waiver or confirmation receipt. The switch SHALL be removed/fixed, or a changed product requirement SHALL enter a correction/successor run and be represented in ordinary source/spec truth rather than a gate-lowering exception.

Enforcement: `harness/scripts/utils/behavior-switch-scan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-testing.ts`

#### Scenario: accepted risk does not close a default-on bypass

- **WHEN** the scan finds `DEVICE_TEST_FAST_PATH = true` and a legacy signed waiver exists
- **THEN** the gate SHALL remain FAIL until the product code or frozen requirement changes and is revalidated

### Requirement: P0 device acceptance criteria are proven as structured state transitions

check-spec SHALL require every P0 device/both interactive AC to define ordered structured checkpoints bound to the ui-spec registry and verbatim requirement references. check-testing SHALL verify every mapped P0 case using runner/provider-owned runtime observations bound to the current flow, derived plan, HAP, source aggregate, trace, run, attempt, device, and provider identity. Verification SHALL recompute ordered pre/action/post transitions, declared-to-actual target hit, required presence, and forbidden absence. Agent prose, trace notes, self-reported PASS, human attestation, and legacy runtime-fidelity receipts MUST NOT satisfy runtime execution. Pass-rate reporting SHALL include skips in the denominator and reject contradictory conclusions.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/device-test-evidence.ts`

#### Scenario: hash-bound runtime transitions prove a P0 case

- **WHEN** all required checkpoint observations are current, ordered, correctly targeted, and bound to the current flow/plan/HAP/source/run/attempt/device
- **THEN** the P0 runtime-fidelity obligation SHALL pass without a human receipt

#### Scenario: plan text alone is insufficient

- **WHEN** a derived plan describes the right taps but no runner/provider-owned step observations exist
- **THEN** P0 runtime fidelity SHALL remain unproven

### Requirement: P0 skips and unreachable screens never launder into clean passes

A skipped or unexecuted P0 TC and an unreachable required P0 visual target SHALL FAIL unless the cause is an enumerated external/capability blockage bound to real trace/error evidence, in which case the phase SHALL defer. No waiver or confirmation receipt SHALL degrade the finding. Explicit, non-external registered skips SHALL remain repairable machine failures and produce the existing responsible-phase candidate where ownership is provable; missing status or unregistered trace skips stay testing-owned FAIL. New runs MUST NOT emit `await_human_p0_skip` or generic human-gate deferral for P0 coverage.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: ten explicit P0 skips route to repair

- **WHEN** a derived plan registers 10 of 17 P0 cases as explicit skips for non-external reasons
- **THEN** coverage SHALL FAIL and trusted ownership SHALL route repair through `backtrack_to_phase`, without waiver or WAITING(human)

### Requirement: Declared fidelity is reconciled against detected intent

check-spec SHALL FAIL when frozen requirement intent demands a higher fidelity tier than the spec declares. A receipt, signer, or manual resume MUST NOT downgrade the frozen target. A legacy `fidelity-intent.json` whose `decision.source` is `downgrade_receipt` or `human_confirmed` MAY be parsed for compatibility but MUST NOT be reused as the fidelity SSOT. At a downstream goal start, its presence SHALL invoke the existing `backtrack_to_phase(spec)` transaction so the spec owner rebuilds the on-disk SSOT from current frozen requirements before downstream execution; it MUST NOT be folded into the ordinary missing/non-UI branch or replaced by an in-memory runtime truth. That backtrack transaction SHALL remain pending across crash/resume until receipt validation and the spec closure finalizer commit a fresh owner closure after the request; a prior `phase_backtrack_completed` event alone MUST NOT release downstream execution. If the selected target requires a capability the current provider/profile cannot supply, the run SHALL defer as capability-missing; changing the target is a new correction/successor requirement input.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: strong pixel intent cannot be signed down

- **WHEN** the frozen requirement demands pixel fidelity and spec declares semantic layout with a legacy downgrade receipt
- **THEN** reconciliation SHALL FAIL or preflight SHALL defer for missing capability; the receipt SHALL be inert

#### Scenario: receipt-derived fidelity SSOT is not reusable

- **WHEN** a matching-identity, matching-requirement `fidelity-intent.json` selects semantic layout from `downgrade_receipt` or `human_confirmed` while the frozen requirement demands pixel fidelity
- **THEN** the loader SHALL withhold it from authority and a coding/review downstream start SHALL backtrack to spec, rebuild the sole on-disk SSOT from the frozen requirement, and make downstream `CheckContext` consume the rebuilt pixel/hard contract instead of the receipt-derived semantic tier

#### Scenario: legacy fidelity backtrack crashes before spec closure commit

- **WHEN** the spec harness returns during a legacy-fidelity backtrack and a historical premature `phase_backtrack_completed` is persisted before `finalizePhaseClosure`, then the process crashes
- **THEN** resume SHALL keep the original request and budget pending, verify/close spec without issuing a second request, and enter the original downstream slice only after the fresh spec closure commits

### Requirement: Visual capture completeness is tier-independent and reference images cannot be silently descoped

Missing or invalid visual-diff navigation with declared P0 visual targets SHALL be a completeness BLOCKER at every fidelity tier. Every authoritative reference SHALL map to a ui-spec screen or carry machine-verifiable out-of-scope provenance bound to the parent hash, bbox/derivation, or frozen requirement citation; requirement-cited images MUST NOT be agent-descoped. Unprovable required registrations SHALL fail or defer for a real missing capability, not wait for human confirmation. Reachable screens SHALL still be captured and checked at the selected tier.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-*`

#### Scenario: unprovable descoping stays unclosed

- **WHEN** a requirement-cited image is marked out of scope without machine-verifiable provenance
- **THEN** the applicable gate SHALL FAIL or capability-defer and SHALL NOT create a must-review signature item

### Requirement: Conditional review verdicts cannot close without resolution or authorization

When review declares a conditional or negative verdict, all open BLOCKER/MAJOR findings SHALL be machine-verified and routed as responsible-phase repair candidates until a fresh review closes them. Conditional-review authorization receipts and accepted-risk statements MUST NOT suppress candidates, advance review, or close the feature. The verifier's PASS attests report credibility only and MUST NOT be consumed as product PASS.

Enforcement: `harness/scripts/check-review.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`

#### Scenario: open MAJOR findings cannot be accepted away

- **WHEN** review has two current verified MAJOR findings and a legacy conditional authorization receipt
- **THEN** the findings SHALL route to their owner and review SHALL not close until a fresh review verifies resolution

### Requirement: A blind model may consume trusted crops but never execute or self-certify cropping

check-spec SHALL admit a crop under a blind primary only when current machine evidence verifies its resolved path, file sanity, source image hash, bbox/derivation, output hash, and applicable independent content recognition. Legacy `human_receipt`, `human_crop_confirmed`, `crop_confirmed_by`, and `user_requirement` signer sentinels SHALL be ignored as quality authority. Failing assets SHALL use an allowed visible placeholder, remain FAIL when required, or defer when the missing fact is a real unavailable capability.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: a signer field cannot self-certify cropping

- **WHEN** an agent-authored ui-spec sets human crop fields but no current source/bbox/output evidence exists
- **THEN** the gate SHALL reject crop admission without asking for another signature

### Requirement: On-device rendered visibility is a debt-gated observation

A device-side check SHALL compare rendered regions against the screenshot using its calibrated deterministic observations and write machine-derived visual debt. An open required debt SHALL keep the visual axis unclosed and release blocked; it SHALL close only after source/binding/render evidence verifies the fix. New debt MUST NOT enter an accepted-by-human state, and no receipt SHALL clear it. Optional low-confidence observations remain advisory according to the existing calibrated policy.

Enforcement: `profiles/hmos-app/harness/render-visibility.ts`, `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: accepted metadata cannot clear an invisible asset

- **WHEN** a current rendered-visibility finding remains open but legacy accepted-by metadata exists
- **THEN** current projection SHALL keep the required visual axis unclosed

### Requirement: Fidelity intent tri-state detection covers phase-driven runs

The shared fidelity-intent detection SHALL run on goal and phase-driven spec paths. Strong pixel intent with missing required visual capability SHALL produce `DEFERRED_CAPABILITY_MISSING`; no strong intent follows the normal default policy. Ambiguous wording SHALL be resolved from frozen requirement inputs and deterministic policy, not `await_human_fidelity_tier`. `--fidelity` may hold or raise the target but MUST NOT lower frozen intent, and no downgrade receipt SHALL be consumed.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-spec.ts`

#### Scenario: blind phase-driven strong intent defers

- **WHEN** a phase-driven spec run has strong pixel intent and no capable native/delegated visual provider
- **THEN** it SHALL defer before producing a downgraded semantic target and SHALL NOT ask for a fidelity signature

## ADDED Requirements

### Requirement: Human quality pass keys have zero production consumers

After migration, phase checks, quality-axis derivation, transition policy, closure, and completion SHALL consume no signer identity, human confirmation receipt, accepted-risk state, blind-run waiver, or manual-resume flag as a quality result. Legacy schema fields MAY be tolerated only by explicitly identified readers and negative/migration tests. Ordinary selection/input provenance and genuine external authority SHALL remain separate and MUST NOT lower quality.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `specs/phase-rules/*.yaml`

#### Scenario: production zero-consumer scan

- **WHEN** the framework release checks scan production paths after migration
- **THEN** every remaining human-quality term SHALL match only the explicit legacy-reader/external-authority allowlist and no writer or gate consumer
