---
name: component-closure
description: Reconstruct and validate component-level assembly and coverage closure from one admitted App blueprint, canonical Change Units, deterministic Features, verified completion and existing evidence. Use after P2; never claim Capability E2E completion.
---

# Component closure

Use this Skill only after P1 admission and P2 Change Unit execution facts exist for the target component.

## Authority and entry

- Load exactly `blueprint/component/<component_id>/component-blueprint.yaml` and the same component's canonical `change-units/*.yaml`. Do not scan arbitrary Features or delegate input membership to a Provider.
- Resolve every CU's deterministic Feature identity, `contracts.change_unit` construction mapping, `contracts.state_management`, four-state completion and carry-forward through the existing P1/P2 loaders and verifiers.
- Current-scope source items and requirement traceability come from the validated blueprint. Do not parse arbitrary PRD prose or invent missing mappings.
- The canonical derived projection is `blueprint/component/<component_id>/component-closure.yaml`; generate `component-closure.md` one-way before review.

## Procedure

1. Rebuild the sorted input manifest and `input_fingerprint`, including full traceability mappings, blueprint/CU raw hashes, Feature bindings, completion/evidence identities and evidence-provider observations.
2. Derive the complete obligation set from current sources, applicable 4+1 design, runtime flows, contracts/NFRs, CU predicates/invariants/dependencies/safe states and Feature construction mappings.
3. Recompute every coverage row's CU or combination owner, deterministic Feature, exact mapping, evidence level/identity and observation. Never accept an authored owner, evidence swap, checkbox or aggregate completion count.
4. Recheck cross-view consumption, conditional runtime propagation, exact dependencies, migration/temporary assets, stable knowledge and only the authoritative `establish_seam` host evolution decisions.
5. Aggregate only `PASS|PASS_WITH_DEGRADATION|FAIL`; emit deterministic gaps with one repair route. A single Provider cannot select inputs, remove obligations or set the verdict.
6. Run `npm run check:component-closure -- --project-root <root> --component <component-id> --write` to evaluate, atomically materialize canonical YAML, hash it, derive Markdown, and revalidate both artifacts. Later read-only checks MAY omit `--write`.

## Evidence seams

Only three static evidence adapters are replaceable: automated construction evidence, UI/device/visual evidence, and human acceptance/risk evidence. They return provider-neutral observations for identities already selected by the stable kernel. A current file, symbol and source hash only create a requested identity: the default adapters claim it only when a canonical same-Feature/phase `script-report.json` has the exact PASS check and file binding, and that report is protected by a fresh phase evidence manifest, receipt pointer and VALID completion observation. Missing or failed execution stays uncovered; Providers never auto-claim the requested set. Required absence blocks; optional absence is an explicit bounded degradation; duplicate or contradictory authority fails closed. Provider exit clears transient observations and makes the projection stale, but does not delete blueprint, CU, Feature, Goal Mode or accepted evidence facts.

## Boundaries

- Do not write P1 revision/stale state, P2 ready/carry-forward state, Feature completion, Goal Mode events/receipts/evidence, or a P3 history ledger.
- Do not add a registry, execution ledger, checkpoint, lock, daemon, dynamic plugin runtime, semantic diff engine or second authority.
- Component closure proves only the exact component and bound inputs. It never claims real-host completion, MG release readiness or cross-component Capability E2E closure.
