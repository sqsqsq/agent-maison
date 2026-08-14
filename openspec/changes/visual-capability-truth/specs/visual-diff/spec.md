# visual-diff Spec Delta

## ADDED Requirements

### Requirement: visual-diff-nav schema 2.0 carries per-screen identity anchors

visual-diff-nav.json SHALL support schema 2.0: top-level `schema_version` + `screens` map where each screen has `steps` and optional `identity` with `all_of`/`any_of`/`none_of` member lists (members: `{text}` | `{id}` | `{route}`) and a `proposed` flag. Legacy top-level `Record<screenId, NavStep[]>` SHALL remain readable (normalized in memory to steps-only 2.0); writes SHALL emit 2.0. Minimum identity strength: at least two "unique" texts, or one strong id/route — "unique" is machine-defined as present in the target screen's reference text corpus AND document_frequency = 0 across all other P0 screen corpora. Auto-prefilled candidates (from `componentNode.id`/`componentNode.text`/`global_elements`/ref-elements mapping, ranked by cross-screen discriminability) SHALL carry `proposed: true` and SHALL NOT participate in gate verdicts until confirmed. Under fidelity pixel_1to1, a P0 screen without confirmed identity SHALL FAIL (BLOCKER); otherwise WARN. Overlay screen ids follow the existing OVERLAY_SEP normalization.

Enforcement: `profiles/hmos-app/harness/visual-diff-nav.ts`, 迁移/候选生成命令（tasks 2.7）

#### Scenario: legacy nav file keeps working but cannot pass pixel P0 without identity

- **WHEN** a feature carries the legacy array-format nav file and fidelity is pixel_1to1 with P0 screens
- **THEN** the loader SHALL read it without error, and the identity gate SHALL FAIL those P0 screens naming the missing confirmed identity (candidates may be generated but remain `proposed`)

### Requirement: Screenshots are admitted only after an identity gate on the ui tree

The capture pipeline SHALL follow `navigate → dump uitree → identity gate → screenshot → canonical write`. When the dumped tree fails the screen's identity rule, the capture SHALL be recorded as `screen_identity_mismatch`, the screenshot SHALL be archived under `_mismatch/` (never written to the canonical screenshots directory), and `visual_diff_capture` SHALL treat the screen as missing evidence.

Enforcement: `profiles/hmos-app/harness/visual-diff-hylyre-screenshot.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: the wrong-page capture from run 20260718T063943Z is rejected

- **WHEN** navigation for `add_bank_collapsed` lands on the add-card type page (tree texts 「添加卡片/非本机卡片/管理非本机卡片…」) whose identity rule requires 「添加银行卡」 and forbids 「管理非本机卡片」
- **THEN** the screen SHALL be marked `screen_identity_mismatch`, zero bytes SHALL be written to the canonical directory, and captured-screen count SHALL NOT include it

### Requirement: Hylyre Chinese round-trip is a device-testing precondition

The hylyre launch chain SHALL inject `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for both device-test and visual-nav spawn paths, and vendored wheel steps/config reads SHALL be audited for explicit UTF-8. A doctor extension SHALL perform a real-chain Chinese round-trip — write a steps JSON containing Chinese selectors → Hylyre parser → selector predicate read-back byte-compare (not stdout echo) — covering both paths; failure SHALL BLOCK device testing classified as toolchain/environment failure. Mojibake patterns (e.g. `'����'`) SHALL be detectable in doctor and selector-log scans.

Enforcement: `profiles/hmos-app/harness/hylyre-spawn.ts`, hylyre doctor 扩项（tasks 2.3）

#### Scenario: broken encoding blocks device testing before test cases run

- **WHEN** the round-trip doctor reads back `'����'` instead of 「添加管理卡片」
- **THEN** device testing SHALL be blocked with a toolchain-classified BLOCKER explaining the UTF-8 boundary, and no test-case failures SHALL be attributed to the product

### Requirement: locator coverage remains a terminal diagnostic measurement

The locator-required denominator SHALL include only: identity anchor members, bbox geometry assertion targets, forbidden-overlap participants (forbidden_overlap pairs and protected_region), must_have_elements, region-attest elements, interaction targets, and UI-kit block instance anchors. `visual_parity_element_id_lint` SHALL remain a WARN with persisted coverage: it measures the availability of locator-dependent assertions and a low result causes those B-class assertions to SKIP rather than claiming a product defect. Two real host runs MAY calibrate the denominator and fixtures, but SHALL NOT automatically enable a P0 coverage BLOCKER/enforce path. A future hard gate requires a separate evidence-backed change.

**按屏隔离（review 2026-08-14）**：nav 触达与 region-attest 上下文 SHALL 按 `screen_id` 提供——A 屏的步骤/attest 区域不得进入 B 屏分母。nav 步骤内 by_id SHALL 递归提取（含 `within.by_id`、`scroll_to.in.by_id` 等嵌套形态）。interactive 节点类型启发式 SHALL 仅在 nav 配置缺失时作为回退启用；nav 存在时（即使某屏无触达）SHALL 禁用该启发式，交互目标语义以测试步骤 by_id 触达为准。

Enforcement: `profiles/hmos-app/harness/coding-visual-parity-check.ts`

#### Scenario: dynamic list rows do not flood the denominator

- **WHEN** a P0 screen declares a dynamic bank list with dozens of OCR text nodes, of which only the identity anchors, interaction targets and must-have elements are locator-required
- **THEN** coverage SHALL be computed over the locator-required set only, and plain decorative/OCR-noise nodes SHALL NOT count toward the denominator

#### Scenario: per-screen context does not cross screens

- **WHEN** screen A declares nav steps / region-attest regions that screen B does not
- **THEN** screen B's denominator SHALL NOT include A's interaction targets or attest regions

#### Scenario: nested selectors contribute their by_id

- **WHEN** a nav step carries `within.by_id` or `scroll_to.in.by_id` nested selectors
- **THEN** those by_id targets SHALL be counted as locator-required interaction targets

#### Scenario: interactive-type fallback requires missing nav

- **WHEN** a nav config exists but a screen has no touched by_id targets
- **THEN** interactive node-type heuristics SHALL NOT add nodes to the denominator（仅 nav 缺失时回退）
