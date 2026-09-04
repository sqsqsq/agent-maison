## Context

Implement the approved b9 plan on the existing d8/e4/M7 code. Source is authoritative; index is disposable and catalog is thin. Existing `ContractsSpec.components` consumers include SpecLoader, page registration, visual-parity and exit defaults.

## Decisions

- Resolve both asset paths through config helpers. CREATE may materialize default keys; UPDATE keep/overwrite do not backfill them. File existence, not configured keys, enables Feature checks.
- Core scanner uses the existing profile harness loader. HMOS implementation scans catalog HAR/HSP modules and reuses `resolveHarExportEntryPath`; follow one named re-export hop, warn on star exports. IDs use module-relative files; `file` holds project-relative source location. Canonical sort, file SHA-256, no volatile fields.
- Kind predicate follows existing contract vocabulary: `page` (including navigation destinations), `component` and `builder` are UI entries; other utility kinds are exempt. Decorator `@Component`/`@ComponentV2`/`@Builder` and existing navigation fields also identify UI. No global kind enum is introduced.
- Extend the same decision validator and provider rules table. Development node `kind` uses the same UI predicate; logical/scenarios UI changes trigger lens reading but the selection target remains a development node. No additional applicability field.
- Feature mapping uses existing design_ref + implementation_refs (`file#symbol` disambiguates components in one file). Compare resolution/component_ref/rationale exactly. Bindings remain Feature-local.
- Dependency preflight reuses architecture permission semantics, including same-layer policy; consumer is components[].module and provider is the indexed module. Never store a dependency conclusion in contracts. Prefer another candidate, then declared refactor/downshift, then human-authorized new edge.
- Newly registered exports are determined against the existing Feature coding baseline when available, otherwise git HEAD source, using the same scanner; no new baseline/store. Legacy unknown checks remain advisory. Catalog refresh detects new exports omitted from the snapshot.
- Three static checks report only syntax facts. A dynamic or ambiguous applicable surface is unknown, never not_applicable. A component with multiple surfaces fails if any surface fails and is unknown if any applicable surface is unresolved.
- Curation follows catalog-bootstrap staging and individual y discipline. Merge validates the complete candidate catalog before write; daily dangling refs only warn and never mutate curated status.

## Goal / normal parity

Both modes consume identical skills and phase checks. Swap candidates automatically; downshift through authorized plan scope/auto-replan. A new dependency edge is human authority: unresolved design decision cannot enter current CU construction, and goal parks using existing await-confirm then resumes. No new runner state or admission protocol.

## Out of scope

No blueprint.assets, second component tree, ui-node mapping, evidence state machine, rendering/device capability proof, expanded ui-spec requirements, required_capabilities, Figma/MCP bridge, semantic-duplication gate, vector resolver/ranker, new phase, token inventory, full props type parsing, screenshots/previews, usage statistics in index, whole-project curation prerequisite, Android extractor, spontaneous component move outside plan, or conventions content authorship. Wallet dogfood and m5 are not framework completion claims.

## Validation

Run targeted scanner/selection/provider/projection/context and existing-consumer regressions, then harness npm test, plan validation, OpenSpec strict validation and release:verify (temporary verification only, no publication). Preserve the pre-existing changelog deletion. Update plan todo status and append an implementation record without changing its approved body.

## Implementation and verification record（2026-09-04）

- t0–t5 implemented; the approved plan body is unchanged and carries the detailed execution record. No archive, host edits, commit or release.
- Provider/Feature checks reuse existing validators and CU projection dispatch. Historical component discovery passes the existing export resolver a source reader instead of introducing a baseline store. CREATE defaults and UPDATE no-backfill behavior are covered.
- Skills remain within their existing body budgets: plan details live in the existing plan workflow reference, component-design delegates asset work to the App blueprint skill. Six adapter routes plus the generic shared bundle are checked against actual manifests.
- New component suite: 30/30. Complete unit run: 4185 pass / 5 metadata-lint failures out of 4190; all five were repaired without production logic changes, and their four affected suites passed 46/46 on rerun. Existing valid results are reused per repository verification proportionality. Complete fixtures: 46/46. Typecheck, OpenSpec strict (37/37), default plan check and diff check passed.
- release:verify was executed with typecheck reuse and stopped at the window plan gate before packaging. After b9 completion, release-mode plan validation identifies only the master plan's pending m5. This is deliberately left for subsequent closure; the failed initial npm test/release invocations are not described as single-run successes.
- Dogfood and device/rendering proof remain outside this framework-only task; no semantic AI reuse-effect claim is inferred from unit fixtures.

## Bounded review R1–R7 closure（2026-09-04）

The seven fixed findings are the complete scope for this correction. R1 resolves the approved plan's MAJOR-versus-blocking conflict by using BLOCKER/FAIL only for mandatory Feature selection/dependency, export registration and new-asset static failures; existing drift diagnostics and WARN remain unchanged. The plan's original body is preserved and its appended review record explicitly carries this correction.

Current component-assets blockers now enter the existing admission derivation, so the canonical resolver rejects CU construction even when the blocker is correctly labeled. Future open decisions remain constructable. Export-entry ownership is carried transiently by the same scan, not added to the index; baseline/current export differences cover newly exposed unchanged definitions. Coverage uses component entries rather than names. Unexpanded global lower-case Builder calls retain unknown (see the supplied [official Builder example](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/ui/state-management/arkts-builder.md)). Only actually cited evidence files are checked for readability; no fragment/hash protocol is added. Windows historical reads reuse the Git file list to select actual path spelling.

Validation: typecheck PASS; component-assets 37/37, contracts-cross-consumer-closure 7/7, ui-spec 35/35, component-blueprint 96/96, totaling 175/175. The user's unchanged external probe script reports R1–R7 PASS and R8 FAIL; the latter remains an accepted sampling observation, with an honest no-sample warning and no alias resolver. Target change strict validation, default plan check and diff check PASS. No unrelated full-suite/release rerun, host changes, commit, archive, or design-entry/m5 work.

## R5 direct-regression closure（2026-09-04）

The lower-case call probe now excludes method declarations by the following method body, including return annotations, instead of exempting only the build name. Calls inside method bodies remain scanned and unexpanded global Builders remain unknown. One regression covers empty aboutToAppear (with and without : void) plus Divider through the actual shared scan, review check and final report; font/touch checks stay not_applicable and the verdict is PASS with zero blockers. The test failed before the fix and passed afterward. Typecheck and 134/134 targeted tests (component-assets 38, component-blueprint 96) passed. Target OpenSpec strict validation, default plan validation and diff check passed. No scope expansion; R8 remains advisory.
