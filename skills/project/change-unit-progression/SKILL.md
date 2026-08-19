---
name: change-unit-progression
description: Validate and continuously execute canonical Change Units from an admitted App component blueprint, one Goal Mode Feature at a time. Use after P1 blueprint admission; do not use for P3 component closure.
---

# Change Unit progression

Use this Skill only when a component has an admitted canonical blueprint and one or more canonical `change-unit@1` artifacts under `blueprint/component/<component_id>/change-units/`.

## Authority and entry

- Run `check:change-unit` for each candidate before deriving readiness. A decomposition Provider may propose only temporary/in-memory candidates; only the consumer validator may accept a provenance-bearing canonical CU.
- Read CU intent, predicates, provides and design targets from the canonical artifact. Read component design from `component_blueprint_ref`; never copy either definition into a Feature.
- Derive the Feature id from `(component_id, change_unit_id)`. `contracts.change_unit` contains only ID mappings; `contracts.state_management` remains the sole runtime-construction authority.
- Resolve workflow track and expected phase chain from the existing workflow/track SSOT. Goal Mode events, receipts, evidence and verified feature completion remain execution truth.

## Progression

1. Re-derive completion (`ABSENT|VALID|STALE|INVALID`), current blueprint target admission, exact requires/provides, blocker probes and ready candidates from formal artifacts.
2. If an existing Goal Mode run is active, resume it and do not start another CU.
3. Otherwise select at most one ready CU by ascending numeric priority, then stable `change_unit_id`.
4. Hand Goal Mode the canonical CU path/ref/hash, blueprint ref and derived Feature id. After it returns, reread all facts before selecting again.
5. On failure, pause or awaiting-human, stop on that run. Do not create a P2 checkpoint or start a second CU.

Blueprint/CU identity drift makes unimplemented mappings and readiness stale. Preserve completed CU artifacts and Goal Mode history; carry completed provides forward only when every historical stable target still resolves and remains admitted in the current blueprint. Otherwise return to P1 reconciliation. Corrections to completed work use a new revising/superseding CU id.

## Boundaries

- Standalone Features without `change_unit_ref` keep their existing workflow and are not P2 errors.
- `ready_for_component_closure` is only a handoff to later P3 evaluation. Never create or claim component closure here.
- Do not add a registry, ledger, lock, daemon, semantic-diff/invalidates engine, dynamic Provider loader or second recovery authority.
- The first release assumes one main Agent/process. If multiple writers become a real requirement, stop and propose a separate change.
