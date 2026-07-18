## ADDED Requirements

### Requirement: The profile ships instantiable ArkUI blocks materialized by a deterministic scaffolder

The hmos-app profile SHALL maintain ArkUI block templates (MaisonNavBar, MaisonListCard, MaisonListRow, MaisonBottomSheetScaffold, MaisonPrimaryButton, MaisonSelector, MaisonResultState, MaisonSmsCodeField, MaisonDetailSection), each defining required children, default sizing/spacing, variants, token sources (sys.color/sys.float aligned), overridable slots, the mapped ui-spec semantic node, asset-missing behavior (role-appropriate placeholder), and source/runtime verification anchors. A deterministic scaffolder SHALL materialize blocks into the consumer project; the target directory resolves in strict order: (1) framework.config `ui_kit_target_dir`; (2) profile-recommended shared/common presentation layer; (3) derivation from architecture outer_layers config; (4) otherwise HALT for user confirmation — no hardcoded consumer layer. Scaffolding SHALL be idempotent: existing target files with matching hash → skip; hash drift → BLOCKER (no silent overwrite). The consumer project SHALL NOT gain framework runtime dependencies.

Enforcement: `profiles/hmos-app/ui-kit/**`（新增模板）, `profiles/hmos-app/harness/ui-kit-scaffolder.ts`（新增）, `harness/scripts/check-coding.ts`

#### Scenario: a consumer without the expected common layer

- **WHEN** the scaffolder cannot uniquely resolve a target directory from config, profile recommendation, or architecture derivation
- **THEN** it SHALL halt asking the user, and SHALL NOT write into a guessed path

### Requirement: Block anchors are instance-semantic, charset-constrained, and unique per screen

Runtime anchors SHALL be generated as `maison:<feature>:<screen_id>:<semantic_node_id>:<instance_key>`, each segment normalized to `[a-z0-9_-]` (invalid chars → `-`, lowercased), `:` separators, total length ≤ 96 (over-long instance_key truncated with a 4-char content-hash suffix preserving uniqueness). Anchors SHALL be injected via ArkUI `.id()`; repeated rows SHALL differ by instance_key; uniqueness within a screen SHALL be validated. uitree queries and hypium By.id matching against this charset SHALL be covered by regression tests.

Enforcement: `profiles/hmos-app/harness/ui-kit-anchors.ts`（新增）, `profiles/hmos-app/ui-kit/**`

#### Scenario: twenty bank rows on one screen

- **WHEN** the bank list screen instantiates MaisonListRow twenty times
- **THEN** each row carries a distinct anchor (e.g. `maison:bc-opencard:bank-list:bank-row:icbc`) and visual-diff-nav can address any row stably

### Requirement: Declared containers close a three-stage loop from ui-spec through source to runtime

ui-spec SHALL support container/frame semantic nodes (list_card_container, nav_bar, sheet_header, …) mapped one-to-one to kit blocks, and must_have SHALL cover structural containers. A check SHALL verify the three-stage loop: a declared semantic node → the mapped block instantiated in source (anchor string present in code) → the anchor ID plus expected structural relations present in the runtime uitree. Custom-component names SHALL NOT be relied upon in uitree (components may be flattened); only anchor IDs and structure count. A declaration whose source or runtime stage is missing SHALL FAIL.

Enforcement: `harness/schemas/ui-spec.schema.json`, `harness/scripts/utils/ui-spec-shared.ts`, `profiles/hmos-app/harness/ui-kit-conformance-check.ts`（新增）, `harness/scripts/check-{coding,testing}.ts`

#### Scenario: container declared, loose Text emitted

- **WHEN** ui-spec declares list_card_container for the bank list but the source renders bare Text children with no block anchor
- **THEN** the source-stage check SHALL FAIL naming the screen and missing block

### Requirement: The kit itself is protected against visual regression by a gallery fixture

The kit SHALL ship a gallery fixture that compiles every block, asserts its structural contract, and compares against maintainer-approved baseline screenshots; kit changes breaking compilation, structure, or baselines SHALL fail framework CI (harness test suite), preventing global visual regressions from kit evolution.

Enforcement: `profiles/hmos-app/harness/tests/ui-kit-gallery/**`（新增）

#### Scenario: a token change shifts every list card

- **WHEN** a kit edit changes MaisonListCard's default padding beyond the baseline tolerance
- **THEN** the gallery fixture SHALL fail until the maintainer re-approves baselines
