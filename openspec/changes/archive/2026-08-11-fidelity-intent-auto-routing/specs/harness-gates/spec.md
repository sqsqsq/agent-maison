# harness-gates Spec Delta

## ADDED Requirements

### Requirement: The fidelity pregate re-verifies the routing SSOT instead of first-producing decisions

`fidelity_capability_pregate` SHALL load `fidelity-intent.json` and re-verify: internal consistency (`effective == clamp(selected, capability-snapshot)`), spec.md Visual Handoff projection consistency (`fidelity_target`/`asset_acquisition_mode` mismatches are BLOCKER with an agent-auto-fix-the-projection suggestion — never escalated to a user question), goal-env requirement-sha staleness, and the single genuine conflict (selected=pixel ∧ hard ∧ clamped → DEFERRED semantics). For UI-relevant features a missing SSOT is BLOCKER pointing at the initializer command; non-UI features (no ui-spec, no handoff, no reference images) proceed without one. The pregate SHALL NOT produce the decision.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: projection drift is agent-fixable, not a user question

- **WHEN** spec.md declares fidelity_target=semantic_layout while the SSOT selected pixel_1to1
- **THEN** the gate FAILs naming the projection mismatch and instructs the agent to fix the projection from the SSOT

### Requirement: Ruling-class escalation reads the hard-pixel contract; execution keeps the pixel target

Severity ratcheting (WARN→BLOCKER), human-confirmation requirements and completion capping SHALL key on `isHardPixelContract` (effective=pixel_1to1 ∧ strictness=hard); high-fidelity execution machinery (extraction, diff/metrics, layout dumps) keeps keying on the pixel execution target. Under best_effort, quality gaps keep their default severities and are recorded as visual debt — never silently dropped. Deterministic integrity failures (corruption, path escape, forged evidence, ledger tampering) remain unconditional BLOCKERs regardless of strictness.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/harness-runner.ts`

#### Scenario: best_effort records debt without ratchet halt

- **WHEN** a pixel-target best_effort run has an unconfirmed visual gap
- **THEN** the finding stays at its default severity with debt recorded, and no human final confirmation is demanded; the same scenario with strictness=hard escalates to BLOCKER

### Requirement: Blind-crop c3 waiver requires this-invocation machine verification with binding revalidation

Under a blind adapter, a crop asset SHALL be admitted without per-item human pre-confirmation ONLY when the spec asset-acquisition provider confirmedly executed in the current invocation (skip/throw disqualifies disk reports), the entry is `verified` by the strict producer (sanity — including existing blank/uniform detection — plus independent VL recognition or human bbox overrule; producer semantics are not lowered), and the artifact's hash/resolved_path binding revalidates. Otherwise the asset falls back to visible placeholder + visual debt (proceeding) or the human-confirmation route; a pre-written verified-looking report grants no waiver.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: forged verified report with a skipped provider does not waive c3

- **WHEN** an agent pre-writes a complete verified entry and the provider did not run in this invocation
- **THEN** the crop stays unadmitted and the run proceeds via placeholder+debt or human confirmation, not via the forged report
