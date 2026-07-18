## ADDED Requirements

### Requirement: A blind model may consume trusted crops but never execute or self-certify cropping

check-spec SHALL FAIL (BLOCKER, `blind_crop_prohibition`) any ui-spec asset with `acquisition: crop` when `effective_image_input=none`, unless ALL of: resolved_path exists; file sanity PASS; crop provenance verifiable — one of `external_tool` (tool name + source image hash + bbox record), `human_receipt` (confirmation receipt bound to artifact hash), `verified_artifact` (asset-crop-validation.json verified + hash match); and `human_crop_confirmed` carries a trusted identity/receipt. The bare `user_requirement` sentinel SHALL NOT count as per-item verification (existing P0-6 semantics). Assets failing the gate SHALL be redirected to `placeholder: true` + asset-manifest or the asset-request flow.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: the incident's 22 blind crop declarations

- **WHEN** a blind-tier spec declares 22 assets `acquisition: crop` with `human_crop_confirmed: false` and no validation artifacts
- **THEN** `blind_crop_prohibition` SHALL FAIL listing every offending asset key

### Requirement: Asset role and criticality are machine-derived and cross-checked, never agent-trusted

Asset manifest entries SHALL carry `role` (brand_logo|illustration|icon|mask|decoration|system_symbol), cross-checked against ui-spec `icon.kind`, ref-elements, and must_have membership — a mismatch SHALL FAIL. Criticality (brand-critical) SHALL be derived from P0-screen membership + must_have + reference-element linkage, not agent-declared. `placeholder_allowed` governs development continuation only; release readiness for still-placeholder brand-critical assets SHALL be BLOCKED by release policy regardless of the flag.

Enforcement: `harness/scripts/utils/ui-spec-shared.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`, `harness/scripts/check-{spec,coding}.ts`

#### Scenario: a brand logo declared as decoration

- **WHEN** an asset used by a P0 screen's must_have bank row is declared `role: decoration, placeholder_allowed: true`
- **THEN** the cross-check SHALL FAIL the declaration and derived criticality SHALL remain brand-critical

### Requirement: Materialized images pass role-aware source sanity; blank placeholders are blockers at every tier

Every image materialized into module media SHALL pass role-tiered jimp sanity (fully transparent / near-solid / abnormally low content ratio / undecodable-dimensions); thresholds SHALL be calibrated per role, not lifted from the crop-scenario constants. A brand-critical asset failing sanity SHALL be BLOCKER at every fidelity tier (existence, not fidelity). Placeholders SHALL be visible and role-appropriate: brand_logo → deterministic text-avatar (initial glyph + neutral palette rounded block); system_symbol → HarmonyOS sys symbol; illustration → explicitly labeled neutral placeholder frame; decoration → neutral block or omission. Blank/transparent PNG placeholders SHALL FAIL.

Enforcement: `profiles/hmos-app/harness/{asset-materialization-sanity,placeholder-generator}.ts`（新增）, `harness/scripts/check-coding.ts`

#### Scenario: the incident's 23 invisible placeholder PNGs

- **WHEN** coding materializes placeholder PNGs whose jimp stats show blank content for brand-critical bank logos
- **THEN** the materialization gate SHALL FAIL (BLOCKER) naming each asset, at semantic_layout no less than at pixel_1to1

### Requirement: On-device rendered visibility is verified in a calibrate-then-enforce rollout

A device-side check SHALL compare uitree Image/self-drawn node bboxes against the device screenshot region for: indistinguishability from surrounding background, absent foreground contrast, absent edge/structure signal, and declared-vs-rendered bbox consistency. Rollout is two acceptance nodes: `calibrate` (WARN; frozen positive samples ≥6 from the incident screenshots, negative samples ≥10 including flat legitimate UI, acceptable false-positive rate 0 on the negative set, versioned thresholds) then `enforce` (BLOCKER after two consecutive real runs with zero false positives). The capability SHALL NOT be reported complete while in calibrate.

Enforcement: `profiles/hmos-app/harness/render-visibility-check.ts`（新增）, `harness/scripts/check-testing.ts`

#### Scenario: TC-002's fake-visible icons

- **WHEN** the uitree lists five Image nodes whose screenshot regions are indistinguishable from the background
- **THEN** the check SHALL flag all five (calibrate: WARN with structured findings; enforce: BLOCKER), breaking the "node exists = visible" equivalence

### Requirement: Fidelity intent tri-state detection covers phase-driven runs

The goal-fakepass-hardening tri-state intent detection (strong pixel intent + missing visual capability → DEFERRED_CAPABILITY_MISSING before spec; ambiguous phrasing with reference images → await_human_fidelity_tier; none → semantic_layout; downgrade only via valid confirmation receipt; --fidelity never lowers) SHALL also run on the phase-driven path via a harness-runner spec-phase pre-hook reusing the same source functions (no fork). Results (`reference_intent{value,source}`, desired_fidelity, effective_fidelity incl. deferred, downgrade_receipt ref) SHALL be persisted. A blind tier SHALL only yield effective=deferred or receipt-authorized downgrade — never a silent semantic_layout continuation of a strong-intent requirement. Interactive sessions reuse the vision.blind_tier disclosure flow, whose copy SHALL state the expected per-requirement confirmation cost and the ≥4/5 rubric first-run expectation.

Enforcement: `harness/scripts/harness-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-spec.ts`

#### Scenario: the CodeAgentCLI path no longer skips intent detection

- **WHEN** a phase-driven (non-goal) spec run starts for a requirement citing eight authoritative screenshots on a blind adapter
- **THEN** the pre-hook SHALL run intent detection and either defer (strong intent) or require the human fidelity-tier confirmation (ambiguous), instead of defaulting to semantic_layout
