# visual-diff Spec Delta

## ADDED Requirements

### Requirement: Golden contract targets share one canonical target set across nav, identity, and capture

When `MAISON_GOLDEN_CONTRACT` is set, the check-testing device visual_diff entry SHALL parse the golden contract exactly once (single JSON.parse via the shared env loader) and derive one canonical capture-target set `P0 targets ∪ golden positive capture targets ∪ golden forbidden nav targets`, where golden positive capture targets SHALL be the resolved canonical IDs (`resolveGoldenCaptureTargets` extraScreens/extraOverlays, e.g. `bank_card_list_sheet__overlay__0`) and forbidden nav targets SHALL be the forbidden entry ids (e.g. `HomeTab`) — raw contract names SHALL NOT be concatenated into the set. The same set SHALL be consumed by nav validation (`validateNavConfigV2`), identity resolution (`resolveIdentityForTargets`), and capture (`goldenTargets`/`goldenForbidden` passed explicitly so capture does not re-read the env). Golden-positive P1 screens and golden forbidden screens SHALL therefore be legal nav keys (no "unmatched/extra screen name" failure), SHALL be navigable, and SHALL enter capture/evidence production. When the golden contract resolves with failures (declared screen missing from ui-spec, shape drift, capture-id mismatch), the entry SHALL fail closed at the nav gate naming the failing declared ids — skipping the nav validation to work around contract failures is prohibited.

Enforcement: `harness/scripts/check-testing.ts`（`runDeviceVisualDiffCapture` 入口）、`profiles/hmos-app/harness/visual-diff-capture.ts`、`profiles/hmos-app/harness/visual-diff-targets.ts`

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

### Requirement: Golden contract env load carries targets and forbidden in a single parse

The golden contract env SHALL be loaded through one combined loader (`loadGoldenContractFromEnv`) that performs a single file read + JSON.parse, returning both `positive_screens` targets and `forbidden` entries together (env unset → `{targets: null, forbidden: []}`; set-but-unreadable/invalid shape → throw, fail-closed, identical to prior loader semantics). The existing loaders `loadGoldenContractTargetsFromEnv` and `loadGoldenContractForbiddenFromEnv` SHALL delegate to it (no second parser). Callers needing both fields — including `captureVisualDiff`'s own env fallback and the check-testing entry — SHALL load once and consume both fields from that single load; loading targets and forbidden through two separate loader calls (two file reads) is prohibited, because the file content could drift between reads.

Enforcement: `profiles/hmos-app/harness/visual-diff-capture.ts`（含 `captureVisualDiff` env 回退单次装载）、`harness/scripts/check-testing.ts`

#### Scenario: direct capture env path parses the contract file exactly once

- **WHEN** a caller invokes `captureVisualDiff` without explicit `goldenTargets`/`goldenForbidden` while `MAISON_GOLDEN_CONTRACT` names a contract with both positive screens and forbidden entries, and capture consumes both (evidence production enabled)
- **THEN** the contract file SHALL be read and parsed exactly once, and the two legacy loader entry points SHALL return the same values as the combined loader