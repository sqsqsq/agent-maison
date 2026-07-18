## ADDED Requirements

### Requirement: Visual debt lives in a harness-derived JSON ledger with a markdown projection

`doc/features/<feature>/visual-debt.json` SHALL be the machine truth for visual debt, derived by the harness from asset-crop-validation, ui-spec verified state, static_fidelity_score, blind-review-pending, materialization sanity, and render-visibility findings — never agent-authored. Entries carry `{id, source_check_id, asset_key?, screen_id?, severity, status: open|closed|accepted, resolution_class, accepted_by?, acceptance_receipt?}`. `closed` means fixed (or three-state asset clearance); `accepted` means still present but explicitly accepted via receipt — both stop blocking release, and reports SHALL list them separately. `visual-debt.md` is a human projection only. Open debt maps to quality_axes (visual UNVERIFIED/FAIL per resolution class) and caps completion per the verdict-lattice rules.

Enforcement: `harness/scripts/utils/visual-debt.ts`（新增）, `harness/scripts/harness-runner.ts`, `harness/scripts/check-testing.ts`

#### Scenario: the incident's buried warnings become a ledger

- **WHEN** a blind-tier run ends with 22 unverified assets, unverified ui-spec, and an uncomputed fidelity score
- **THEN** visual-debt.json SHALL enumerate every item with its source check id, and the test-report conclusion template SHALL render the structured axes instead of a bare 「达标可发布」

### Requirement: Asset debt clears only through source, binding, and render verification

Each asset debt entry SHALL track `asset_source_status` (file sanity), `asset_binding_status` (source/resource reference check), and `asset_render_status` (on-device region visibility). A user-supplied replacement sets source=VERIFIED only; the entry closes when all three are VERIFIED — a file dropped into media while the UI still references the old placeholder SHALL NOT close the entry.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `profiles/hmos-app/harness/{asset-materialization-sanity,render-visibility-check}.ts`

#### Scenario: file replaced, binding stale

- **WHEN** a real bank logo lands at the manifest's resolved_path but the page still references the placeholder resource
- **THEN** the debt entry stays open with binding=UNVERIFIED naming the referencing source file

### Requirement: Blind-tier asset requests are a standing artifact with a confirmation flow

When blind-tier assets cannot be trusted-cropped, spec SHALL emit `doc/features/<feature>/spec/asset-request.md` (per item: purpose, suggested dimensions, drop path, current placeholder kind). Interactive sessions confirm via the registry (provide asset / accept placeholder / defer per item, copy stating the ≥4/5 first-run expectation); headless proceeds with role-appropriate placeholders and debt entries, with brand-critical placeholders keeping release BLOCKED. A re-run after the user drops assets SHALL absorb them automatically through the three-state clearance.

Enforcement: `harness/scripts/check-spec.ts`, `skills/reference/confirmation-registry.yaml`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: the user drops eight logos after the first run

- **WHEN** files land at the requested paths and spec harness re-runs
- **THEN** each passing role-aware sanity flips source=VERIFIED and the remaining binding/render states drive the entries toward closure without manual ledger edits
