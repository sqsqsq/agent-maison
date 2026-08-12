## Context

Flow DAGs are required-level, single-use scenario graphs, yet today they are archived into `{module}/test/dag/` for every requirement, and `check-ut.ts > loadDagFiles` reads DAG only from that archived path. Coverage gates (`branch_coverage_full`, `ut_case_per_unit_ac`) depend on those DAGs. Removing archival without a replacement evidence source would make these gates SKIP while still appearing green — the exact "looks fine, actually SKIP" trap flagged in review.

This is Track B / P1 of `.cursor/plans/code-graph-ut-evolution_f8fa08ee.plan.md` — the low-risk quick win — and depends conceptually on `define-code-graph-concepts` for the "flow DAG / ephemeral" vocabulary.

## Goals / Non-Goals

**Goals:**
- Stop archiving flow DAGs by default; write them to an ephemeral reports location.
- Keep UT coverage gates fully enforced via a machine-readable `coverage-evidence.json` with a fixed source-priority order.
- Guarantee gates SKIP only explicitly (with a recorded reason), never silently pass.

**Non-Goals:**
- The "core node touched → archive" decision (owned by `code-graph-core-closure-gate`).
- Any Code Graph schema / extractor / drift work (owned by `code-graph-extractor-drift`).
- Changing what counts as a valid `it()` tag or the existing `ac-coverage.json` schema beyond referencing them as evidence sources.

## Decisions

- **Evidence priority: archived DAG > ephemeral DAG > `ac-coverage.json` > UT `it()` tags.** Strongest, most structured evidence wins; tags are last-resort. This keeps already-archived features bit-for-bit unchanged (archived DAG still top priority), so no regression for passing features. Alternative considered: treat all sources equally — rejected, ambiguous when sources disagree.
- **Introduce `coverage-evidence.json` as the single machine-readable contract** rather than having each gate re-derive evidence ad hoc. It records `evidence_source`, paths, and AC/branch→evidence mapping, so gates and the verifier read one file. Alternative considered: infer evidence implicitly per gate — rejected, that is exactly how silent SKIP creeps in.
- **Extend `loadDagFiles` to scan the ephemeral location** in addition to `{module}/test/dag/`. Minimal, localized change to the existing loader; gates keep their current shape but gain the ephemeral source.
- **In-scope unit/both missing evidence FAILs, not SKIPs.** To honor "coverage gates fully enforced", a missing evidence source for an in-scope `ut_layer ∈ {unit, both}` AC/branch is FAIL (BLOCKER) / INCOMPLETE — never a pass and never a silent SKIP. SKIP is allowed only under a closed allowlist (no unit/both scope, profile disables UT, or registered compat downgrade) and must carry a reason surfaced in the UT status panel. This removes the "visible SKIP but phase stays green" loophole.

## Risks / Trade-offs

- [Ephemeral DAGs in reports could be cleaned up before the gate reads them] → Emit `coverage-evidence.json` in the same pass that writes the ephemeral DAG, and have gates read evidence from the json mapping (stable) rather than relying on transient scan ordering.
- [Two evidence formats (DAG vs ac-coverage vs tags) increase gate complexity] → Centralize resolution in one evidence-loader keyed off `coverage-evidence.json`; gates call the resolver, not raw file globs.
- [Behavior flip for in-flight features that expected archived DAGs] → Archived DAGs remain valid and highest-priority, so only the *default* changes; document in MIGRATION.md only if an in-flight default actually flips for consumers.

## Migration Plan

- Additive + default flip. Existing archived DAGs keep working as the top evidence source; no rewrite of past features.
- Profile impact: hmos-app UT overlay (`profiles/hmos-app/phase-rules-overlays/ut-rules.overlay.yaml`) reviewed; generic profile (doc-type) has UT compile/run disabled, so evidence behavior is gated by profile capability as today.
- Rollback: re-point default archival to `{module}/test/dag/` and keep `coverage-evidence.json` as an additive artifact; gates fall back to archived-DAG-first as before.

## Open Questions

- Exact ephemeral DAG sub-path under `doc/features/<feature>/ut/reports/` (align with the existing `<timestamp>/<model>-ut/` reports layout vs a stable `dag/` subdir) — resolve during implementation, prefer a stable location the loader can find deterministically.
- Whether `coverage-evidence.json` should be schema-validated via `validate:ut-artifact` (likely yes) — confirm when wiring the check.
