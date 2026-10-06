## MODIFIED Requirements

### Requirement: Visual-diff screens enumerate positive render defects

Each screen entry in `visual-diff.json` SHALL preserve its raw observations and MAY carry a `defects[]` array enumerating「实现有但渲染错」defects, each `{class, bbox?, severity, note}` where `class ∈ {clipping, overlap, shape_mismatch, missing_render, other}` and `severity ∈ {blocker, major, minor}`. The device-testing rubric SHALL require per-screen enumeration and a newly written pass candidate MUST have empty defects. The writer SHALL give minor-only and soft tier-downgradable residual screens a warn candidate, preserving their observations. Raw verdict and raw must_fix SHALL NOT act as independent product vetoes when the existing effective-screen adjudication proves that they are supported exclusively by authorized structured minor defects. A pass candidate MUST still satisfy current evidence, coverage, deterministic signal and receipt gates; it SHALL NOT silently discard recorded defects.

Authorization, severity and fidelity SHALL be adjudicated through the existing `effectiveScreens` and gate materialization. An authorized minor-only screen whose every must_fix is fully supported only by minor defects SHALL remain WARN disclosure, SHALL NOT independently veto `channel_evidence_usable`, SHALL produce zero coding candidates and SHALL NOT open blocking debt, under both hard and soft fidelity. Mixed major/blocker support, unanchored legacy text, unknown structure, reverse missing and other independent deterministic failure SHALL NOT be waived by the presence of a minor defect.

Outside the hard pixel contract (`effective=pixel_1to1 ∧ acceptance_strictness=hard`, predicate `isHardPixelContract`), a screen is a **tier-downgraded residual** (`isTierDowngradedResidual`, the existing decision point) when its effective disposition is non-failing, it carries no blocker and no T8-sourced major, every must_fix is structurally anchored, and it carries a self-reported major. A valid independent visual-provider major SHALL follow that existing policy; the provider writer's old blanket raw fail from non-empty must_fix MUST NOT defeat the effective adjudication. The gate SHALL materialize these screens in `structured.downgraded_screens`, omit their product-veto/coding repair effects, disclose them with 「按档位降级」, and retain existing blocking visual-debt/release policy. Raw fail with independent actual product failure, blocker, T8 major, unanchored must_fix, placement fail_signals and other deterministic signals SHALL retain their existing evidence veto and repair effects. Duplicate screen ids SHALL aggregate conservatively: if any effective record fails the downgrade/minor conditions, the id SHALL NOT receive the corresponding exemption. Under the hard pixel contract major residuals SHALL NOT be tier-downgraded; minor SHALL retain its established disclosure rule.

A pass candidate carrying an effective blocker/major SHALL retain the existing fidelity ratchet (hard pixel FAIL, otherwise the existing WARN/product-evidence policy except eligible tier downgrade). Defect schema validation SHALL retain its current class/severity/note/bbox constraints.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: pass with blocking defect is rejected

- **WHEN** a screen has a pass candidate and an effective blocker or major defect
- **THEN** the gate SHALL retain hard-pixel FAIL or the existing soft policy and SHALL refuse channel evidence unless the screen qualifies for the established tier downgrade

#### Scenario: a self-reported major outside the hard pixel contract becomes visual debt

- **WHEN** under `pixel_1to1 ∧ best_effort` two screens each carry an anchored self-reported major shape mismatch, including a valid independent-provider observation
- **THEN** both SHALL enter `downgraded_screens`, retain WARN and open per-screen blocking debt, permit evidence when other evidence conditions pass, and produce no coding candidate
- **AND** hard pixel major, T8 major, blocker, unanchored must_fix or independently failing product evidence SHALL retain the blocking route

#### Scenario: defect schema is validated

- **WHEN** a defect has an illegal class/severity, missing note, or a bbox that is not four numbers in [0,1]
- **THEN** validateVisualDiffJson SHALL report the existing schema error

#### Scenario: provider minor fail and must_fix do not create an unrepairable blocker

- **WHEN** a real provider payload without verdict yields two identity-bound screens with fully anchored authorized minor/other observations and raw fail/must_fix, and all independent evidence conditions pass
- **THEN** the writer SHALL emit a warn candidate and gate, summary, channel evidence, repair collector and debt/report SHALL agree on minor WARN disclosure, usable evidence, zero coding candidates and no blocking debt under hard or soft fidelity

#### Scenario: an SMS keyboard blocker remains repairable

- **WHEN** the same producer chain yields a valid authorized blocker/clipping defect at sms_next with current screenshot/build identity
- **THEN** the product/evidence failure SHALL remain visible and the existing coding candidate SHALL carry its original defect and evidence for repair and fresh independent verification

#### Scenario: minor cannot hide legacy or mixed failure

- **WHEN** a screen has minor plus blocker/major references, a duplicate independently failing record, a legacy unstructured must_fix or another deterministic FAIL
- **THEN** the minor exemption SHALL NOT erase that failure or suppress its existing repair/evidence route

## ADDED Requirements

### Requirement: Effective visual adjudication is the shared consumer truth

The existing authority/effective-screen adjudication and current gate structured artifacts SHALL provide one conclusion for product checks, channel evidence, repair candidates, visual debt and reporting. The provider SHALL NOT emit verdict; the harness writer SHALL give minor-only and soft tier-downgradable residual screens warn candidates and SHALL require empty defects for a newly written pass candidate. The final gate SHALL still enforce current identity/coverage/region/receipt/deterministic evidence, and warn evidence eligibility SHALL follow the same effective adjudication without opening minor blocking debt. Original provider payload, observations, must_fix, source and hashes SHALL remain available rather than being deleted to fabricate a pass. Runtime SHALL consume only current run/attempt/gate-bound materialization and MUST NOT independently reimplement fidelity rules.

Missing, stale, malformed, replayed or identity-mismatched screenshot/build/coverage/receipt/provider evidence SHALL remain unresolved evidence, not proven product success. Its existing testing re-capture/re-review or capability route SHALL remain available without generating coding instructions from untrusted observations. Excluded or scope-unclear observations SHALL retain the existing authority filter and disclosure/owner clarification; this change MUST NOT enlarge repair or deletion authorization.

Enforcement: `profiles/hmos-app/harness/visual-provider-review.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: changing only verdict cannot leave a second must-fix veto

- **WHEN** effective adjudication classifies an authorized fully anchored observation as minor-only disclosure
- **THEN** gate hits and channel evidence SHALL consume the same effective conclusion rather than rejecting it independently because raw must_fix is non-empty

#### Scenario: missing evidence stays unclosed

- **WHEN** a minor-only screen lacks current screenshot/build binding, required coverage or valid receipt/provider evidence
- **THEN** that evidence condition SHALL stay unclosed through its existing testing/capability route; minor disclosure SHALL neither fabricate a PASS nor produce a guessed coding repair

#### Scenario: authority filtering is preserved

- **WHEN** a defect is excluded by a valid requirement quote or its element is scope-unclear
- **THEN** every effective consumer SHALL retain existing filtering/disclosure and SHALL NOT authorize implementation or deletion from the opinion alone
