---
name: component-closure
description: Reconstruct and validate component-level assembly and coverage closure from one admitted App blueprint, canonical Change Units, deterministic Features, verified completion and existing evidence. Use after P2; never claim Capability E2E completion.
---

# Component closure

Use this Skill only after P1 admission and P2 Change Unit execution facts exist for the target component.

> 真实宿主场景：闭环前的宿主证据口径（批次与八条运行时场景）与 provider 自然事件落点见
> [真实宿主准入与回灌契约](../../reference/real-host-admission-and-feedback.md)。

## Authority and entry

- Load exactly `<features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml`（`<features_dir>` 默认 `doc/features`，经框架解析）and the same workspace's canonical CU artifacts `<features_dir>/<blueprint_id>/<change_unit_id>/change-unit.yaml`. Input enumeration is limited to that single workspace; CUs of another workspace (including an earlier evolution of the same `component_id`) never enter the input set or credit a row. Do not scan arbitrary Features or delegate input membership to a Provider.
- Resolve every CU's deterministic Feature identity (逻辑 id = `cu-` + base64url `(blueprint_id, change_unit_id)`；物理路径经框架 SSOT 解析，不手工拼接), `contracts.change_unit` construction mapping, `contracts.state_management`, four-state completion and carry-forward through the existing P1/P2 loaders and verifiers.
- Current-scope source items and requirement traceability come from the validated blueprint. Do not parse arbitrary PRD prose or invent missing mappings.
- The canonical derived projection is `<features_dir>/<blueprint_id>/blueprint/component-closure.yaml`（与蓝图/评审投影同处工作区 `blueprint/` 目录）; generate `component-closure.md` one-way before review. `blueprint_id` 是路径键；`component_id` 只做所有权/一致性核验。

## Procedure

1. Rebuild the sorted input manifest and `input_fingerprint`, including full traceability mappings, blueprint/CU raw hashes, Feature bindings, completion/evidence identities and evidence-provider observations.
2. Derive the complete obligation set from current sources, applicable 4+1 design, runtime flows, contracts/NFRs, CU predicates/invariants/dependencies/safe states and Feature construction mappings.
3. Recompute every coverage row's CU or combination owner, deterministic Feature, exact mapping, evidence level/identity and observation. Never accept an authored owner, evidence swap, checkbox or aggregate completion count.
4. Recheck cross-view consumption, conditional runtime propagation, exact dependencies, migration/temporary assets, stable knowledge and only the authoritative `establish_seam` host evolution decisions.
5. Aggregate only `PASS|PASS_WITH_DEGRADATION|FAIL`; emit deterministic gaps with one repair route. A single Provider cannot select inputs, remove obligations or set the verdict.
6. Run `npm run check:component-closure -- --project-root <root> --blueprint <blueprint-id> --write` to evaluate, atomically materialize canonical YAML, hash it, derive Markdown, and revalidate both artifacts. Later read-only checks MAY omit `--write`.

## Evidence seams

Only three static evidence adapters are replaceable: automated construction evidence, UI/device/visual evidence, and human acceptance/risk evidence. They return provider-neutral observations for identities already selected by the stable kernel. A current file, symbol and source hash only create a requested identity: the default adapters claim it only when a canonical same-Feature/phase `script-report.json` has the exact PASS check and file binding, and that report is protected by a fresh phase evidence manifest, receipt pointer and VALID completion observation. Missing or failed execution stays uncovered; Providers never auto-claim the requested set. Required absence blocks; optional absence is an explicit bounded degradation; duplicate or contradictory authority fails closed. Provider exit clears transient observations and makes the projection stale, but does not delete blueprint, CU, Feature, Goal Mode or accepted evidence facts.

## Boundaries

- Do not write P1 revision/stale state, P2 ready/carry-forward state, Feature completion, Goal Mode events/receipts/evidence, or a P3 history ledger.
- Do not add a registry, execution ledger, checkpoint, lock, daemon, dynamic plugin runtime, semantic diff engine or second authority.
- Component closure proves only the exact component and bound inputs. It never claims real-host completion, MG release readiness or cross-component Capability E2E closure.
