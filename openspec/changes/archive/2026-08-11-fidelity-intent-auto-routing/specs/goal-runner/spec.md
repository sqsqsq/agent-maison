# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Fidelity routing is a three-stage formula with auto-tiering and a single genuine-conflict halt

The runner SHALL derive fidelity routing as `inferred` (requirement-text detection: explicit enum literals — including `pixel_1to1` with underscore-safe matching — take precedence over reference-wording inference; negated mentions never match; no-visual-wording defaults to semantic_layout) → `selected = resolveRequestedFidelity(inferred, manifest.fidelity, downgrade_receipt_valid)` (upgrade-only without a valid receipt) → `effective = clampFidelityByCapability(selected, capability_snapshot)` (vision→as-selected / no-vision+OCR→semantic_layout / neither→reference_only). Acceptance strictness SHALL be a separate axis: `hard` only on explicit no-degradation wording within a bounded proximity of visual/fidelity terms; `best_effort` otherwise and by default. The former `await_human_fidelity_tier` blocking outlet SHALL NOT exist: the ONLY halt is `selected=pixel_1to1 ∧ strictness=hard ∧ clamp downgraded` → DEFERRED_CAPABILITY_MISSING (exits: vision-capable model / fidelity_downgrade receipt / relax the requirement). All other combinations proceed with the decision transparently recorded. The goal preflight SHALL run the shared initializer (capability snapshot + fidelity-intent SSOT write) before any agent invoke.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the bank-card wording auto-tiers with zero questions

- **WHEN** the requirement says 「结构/颜色/布局尽量一致；无高保真素材时可从原始截图裁剪获取；（pixel_1to1 意图）尽量与参考图一致」 under a blind adapter
- **THEN** routing resolves inferred=pixel_1to1, strictness=best_effort, asset=auto_crop, action=proceed — no human tier question, no HALT

#### Scenario: hard pixel with insufficient capability is the only deferral

- **WHEN** the requirement demands 「必须像素级还原，不接受降级」 and the adapter is blind
- **THEN** the run defers as DEFERRED_CAPABILITY_MISSING; the same requirement with 「尽量」 instead proceeds clamped with debt recording

### Requirement: Fidelity input reaches routing through all three entry paths

`buildGoalManifestFromInput` SHALL preserve and validate `fidelity`/`fidelity_receipt` (illegal enum fails closed); the fresh CLI SHALL feed `--fidelity`/`--fidelity-receipt` into the parser; CLI override application and fidelity transition authorization SHALL execute on fresh, hand-written-manifest and resume paths alike (never gated on `argv.manifest`). A validated manifest fidelity enters the `selected` stage — a flag that was accepted SHALL never be dropped at the decision layer. A CLI upgrade becomes the real execution target; a receipt-authorized downgrade executes at the lower tier while `inferred` is preserved as the ratchet anchor and downstream pixel hard gates are not re-activated by the higher inferred value.

Enforcement: `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: CLI upgrade is effective on the fresh path

- **WHEN** a fresh run starts with `--fidelity pixel_1to1` on a requirement with no visual wording
- **THEN** selected and effective are pixel_1to1 and the decision source is explicit_cli

#### Scenario: receipt downgrade does not leave pixel gates armed

- **WHEN** inferred is pixel_1to1+hard and a valid downgrade receipt selects semantic_layout
- **THEN** the run proceeds, inferred stays pixel_1to1, and `isHardPixelContract` is false downstream
