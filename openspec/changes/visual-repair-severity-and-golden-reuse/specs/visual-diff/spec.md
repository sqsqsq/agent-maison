# visual-diff Spec Delta

## MODIFIED Requirements

### Requirement: Findings and must_fix items must be transcribed with structured anchors

Gate `visual_diff_finding_transcription`: a T8 hard finding with no matching defect — matched primarily by `defect.source.finding_id`, secondarily by elements intersection with signal-class consistency, and only as legacy fallback by bbox IoU ≥ 0.5 (plain intersection is too permissive — one big bbox must not clear every finding) — SHALL be a pixel_1to1 BLOCKER carrying a copy-paste defect template (including source). Unmatched warn-tier findings SHALL WARN (T8 warn hits already block candidate-pass; the WARN is a transcription reminder, not extra blocking). Under pixel_1to1, every must_fix item on a P0 finalized screen SHALL be referenced by at least one defect's `must_fix_refs`; unanchored items SHALL be a BLOCKER (closes the "equal counts but mismatched filler defects" gap left by the rev10 count gate, which stays as the fuse-eligibility necessary condition). Unstable-screen findings (capability degradation id) SHALL be exempt from transcription.

A T8 hard finding whose matching defect (by any of the three matching paths) carries `severity: minor` SHALL be reported under the same gate id as a **downgraded hard finding** with its own wording naming `major` as the floor. It SHALL take the same ratchet as an unmatched hard finding — BLOCKER FAIL under the hard pixel contract, MAJOR WARN under best_effort — and when it FAILs the round SHALL be non-fingerprintable exactly as for an unmatched hard finding. Warn-tier findings transcribed as `minor` remain legal, and the copy-paste template continues to recommend `severity: major`. No new gate id and no new global hard gate is introduced.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: filler defects do not satisfy anchoring

- **WHEN** a P0 screen has two must_fix items and two defects none of which reference the items via must_fix_refs
- **THEN** the gate SHALL FAIL listing the unanchored items

#### Scenario: hard finding transcribed via finding_id passes

- **WHEN** a defect carries source.finding_id equal to the T8 hard finding's id and its `severity` is `major` or `blocker`
- **THEN** the transcription gate SHALL NOT fire for that finding (a `minor` match instead takes the downgraded-hard scenario below)

#### Scenario: hard finding transcribed as minor is intercepted

- **WHEN** an `A1_forbidden_overlap` hard finding on a P0 screen is matched by a defect whose `source.finding_id` equals the finding id and whose `severity` is `minor`
- **THEN** under the hard pixel contract the gate SHALL FAIL naming the finding and the `major` floor and the round SHALL be non-fingerprintable; under best_effort the same hit SHALL be a MAJOR WARN
- **AND** the same defect recorded with `severity: major` SHALL clear the hit and restore fingerprint eligibility

### Requirement: Golden contract targets share one canonical target set across nav, identity, and capture

When `MAISON_GOLDEN_CONTRACT` is set, the check-testing device visual_diff entry SHALL parse the golden contract exactly once (single JSON.parse via the shared env loader) and derive one canonical capture-target set `P0 targets ∪ golden positive capture targets ∪ golden forbidden nav targets`, where golden positive capture targets SHALL be the resolved canonical IDs (`resolveGoldenCaptureTargets` extraScreens/extraOverlays, e.g. `bank_card_list_sheet__overlay__0`) and forbidden nav targets SHALL be the forbidden entry ids (e.g. `HomeTab`) — raw contract names SHALL NOT be concatenated into the set. The same set SHALL be consumed by nav validation (`validateNavConfigV2`), identity resolution (`resolveIdentityForTargets`), and capture (`goldenTargets`/`goldenForbidden` passed explicitly so capture does not re-read the env). Golden-positive P1 screens and golden forbidden screens SHALL therefore be legal nav keys (no "unmatched/extra screen name" failure), SHALL be navigable, and SHALL enter capture/evidence production. When the golden contract resolves with failures (declared screen missing from ui-spec, shape drift, capture-id mismatch), the entry SHALL fail closed at the nav gate naming the failing declared ids — skipping the nav validation to work around contract failures is prohibited.

Same-key device execution reuse SHALL NOT bypass this entry. When testing reuses a prior run by execution key and `MAISON_GOLDEN_CONTRACT` resolves to targets, the reuse branch SHALL invoke the same device visual_diff entry instead of recording `visual_diff_capture` as a reuse PASS — only capture runs; device_test and UT execution are not repeated — and the nav executor options SHALL be read from the top-level `device-test-run.meta.json` restored from the reused run's frozen copy, so navigation starts the app the way the reused execution did. Without a golden contract the reuse branch SHALL keep its existing `visual_diff_capture` PASS line. In both branches the `visual_diff_capture` details SHALL disclose `golden_contract=<first 16 hex of the contract file's sha256>` or `golden_contract=none`. The golden contract identity SHALL NOT enter the execution key.

Enforcement: `harness/scripts/check-testing.ts`（`runDeviceVisualDiffCapture` 入口与 `checkDeviceTestRunGate` 复用分支）、`profiles/hmos-app/harness/visual-diff-capture.ts`、`profiles/hmos-app/harness/visual-diff-targets.ts`

#### Scenario: golden P1 screen declared in nav config passes validation and is captured

- **WHEN** the golden contract names a P1 overlay-root screen (`bank_card_list_sheet` → `bank_card_list_sheet__overlay__0`) and the nav config declares navigation steps for that canonical overlay id
- **THEN** nav validation SHALL pass (no "extra/misspelled screen name" failure) and capture SHALL produce the `bank_card_list_sheet__overlay__0` entry

#### Scenario: golden forbidden screen participates in nav and identity sets

- **WHEN** the golden contract declares a forbidden target (HomeTab) and the nav config declares steps (and, under pixel_1to1 hard contract, a confirmed identity) for it
- **THEN** the nav validation SHALL accept the HomeTab key, the capture SHALL navigate it and produce the run/build-bound forbidden evidence wrapper, and (pixel hard) a missing confirmed identity for HomeTab SHALL fail validation like any other target — proving forbidden targets are inside the shared identity set

#### Scenario: golden contract resolution failure fails closed at the nav gate

- **WHEN** a golden declared screen is absent from ui-spec or its expected capture id does not match the screen's shape
- **THEN** the entry SHALL return a BLOCKER/FAIL `visual_diff_capture` whose details name the `golden_contract:<declared>` failure and capture SHALL NOT run

#### Scenario: no golden contract keeps P0-only behavior

- **WHEN** `MAISON_GOLDEN_CONTRACT` is unset
- **THEN** the target set SHALL remain P0-only: ordinary P1 screens written into the nav config SHALL still be rejected as extra/misspelled keys, capture SHALL NOT expand to P1, and no golden evidence production SHALL occur

#### Scenario: same-key reuse with an active golden contract still captures

- **WHEN** the newest same-key run is reusable, its frozen `device-test-run.meta.json` (`omit_bundle_for_hylyre=true`) has been restored to the top-level reports dir, and `MAISON_GOLDEN_CONTRACT` names a valid contract
- **THEN** `device_test_run` SHALL report `reused_by_execution_key=true` without re-executing the device test, no reuse PASS `visual_diff_capture` line SHALL be emitted, the visual_diff entry SHALL run (golden P1 and forbidden targets navigated and captured), the nav executor SHALL be built with `omitBundle=true`, and the `visual_diff_capture` details SHALL contain `golden_contract=<sha16>`

#### Scenario: same-key reuse without a golden contract is unchanged

- **WHEN** the same reuse occurs with `MAISON_GOLDEN_CONTRACT` unset
- **THEN** the reuse PASS `visual_diff_capture` line SHALL be emitted verbatim with `golden_contract=none` appended and no device transport SHALL be touched
