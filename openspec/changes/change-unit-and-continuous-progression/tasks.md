## 1. Change Unit artifact and identity

- [ ] 1.1 Add `change-unit@1` JSON schema for canonical identity, revision, priority, one blueprint owner, P1-shaped provenance, bounded-transformation fields, explicit dependencies/blockers, and forbidden authored Feature/ready/completion/closure state.
- [ ] 1.2 Implement the deterministic `blueprint/component/<component_id>/change-units/<change_unit_id>.yaml` path/ref loader with safe-segment checks, raw-byte SHA-256 binding, stable component directory enumeration, and no arbitrary-path/Feature/legacy fallback.
- [ ] 1.3 Implement CU schema/identity/semantic validation for non-empty purpose/provides/design refs/ownership touches/invariants/predicates/verification/safe intermediate state; derive the injective Feature id from component/CU identity, reject overrides or an existing Feature bound to another CU, allow only truly absent preconditions/requires/blockers to be empty, and reject empty horizontal shells or unknown authority fields.
- [ ] 1.4 Add positive/negative unit cases for path/YAML/ref/provenance mismatch, second blueprint ownership, authored/duplicate Feature identity, self-reported hash/status/ready/done/closure, unsafe intermediate state, and deterministic enumeration.

## 2. Blueprint design refs and constructability

- [ ] 2.1 Reuse the P1 canonical blueprint loader/resolver for every owner/design ref and require one component/blueprint/revision/source/artifact identity across blueprint/view/node/relation/flow/decision/contract targets.
- [ ] 2.2 Implement current-delta closure derivation from target predicates, touches and design roots, including development owner, design-basis relation/decision/contract, scenario traversal, cross-view relations and conditional runtime-flow obligations.
- [ ] 2.3 Implement the design-constructability verdict: current-closure unknown/open decision/blocker/unapproved contract blocks, a future owner/needed-by decision outside the closure does not, and blueprint-invalidating facts return reconciliation rather than permitting a Feature TBD.
- [ ] 2.4 Add counterexamples for dangling/mixed-revision refs, omitted changed view/relation/scenario/flow addresses, unresolved current decisions, unrelated future decisions, and blueprint hash/schema drift.

## 3. Feature construction projection

- [ ] 3.1 Extend the existing Feature contracts schema/types/loaders with `change_unit_ref` plus ID-only predicate/provide/design-ref mappings to implementation/symbol/test refs; reject copied/redefined CU content or unknown IDs and preserve compatibility for Features without that section.
- [ ] 3.2 Update spec/plan Skill contracts and affected plan/coding/review checkers to derive the Feature id, inherit CU intent by reference, require complete concrete mappings for every canonical CU obligation, and route newly discovered blueprint conflicts to P1 without changing the CU definition.
- [ ] 3.3 Keep `contracts.state_management` as the sole Feature runtime-construction authority and mechanically derive CU-bound `use-cases.yaml`/ephemeral DAG obligations from ordered steps, failure/recovery branches, shared-state consumers, lifecycle recovery and unit/both scope; update the existing template/type/loader/gates in one chain and reject authored opt-outs.
- [ ] 3.4 Add projection counterexamples for stale CU hash, copied/redefined CU or blueprint content, missing/unknown predicate/provide/design mappings, a parallel runtime section, orphan publication/consumer, missing replay/cleanup or background recovery, and required-but-missing use-case/DAG; prove simple read-only/first-load paths need no fake mutation/subscription or unnecessary flow artifact.
- [ ] 3.5 Enforce the first shared runtime chain and first approved host-evolution seam as vertical units with real owner/contract, first Provider, real Consumer and executable/contract verification; reject empty Store/EventBus/interface units.

## 4. Dependencies, blockers, ready set, and selection

- [ ] 4.1 Implement exact same-blueprint `requires.from_change_unit_id + provide_id` matching; satisfy a require only from the provider CU's derived Feature with matching VALID completion and an all-targets-resolve-and-remain-admitted carry-forward verdict, never from priority, execution order, goal labels or capability seam dependencies.
- [ ] 4.2 Implement structured blocker validation and activity derivation, requiring probes for machine-observable release conditions and authority evidence/revision for human-only resolution; reject `resolved: true` self-reporting.
- [ ] 4.3 Implement the non-persistent `ABSENT|VALID|STALE|INVALID` completion adapter and disposable ready-set projection: derive Feature id, workflow, track and expected chain from existing SSOT, distinguish never-run/not-completed from damaged evidence, report per-unit reasons, and never consume file existence or self-reported done.
- [ ] 4.4 Implement execution-precedence cycle/SCC detection and `silent_progress_stall` when unfinished predicates have neither ready CU, active run nor legal blocker; do not create a general relation registry or persist condensation state.
- [ ] 4.5 Implement the static selector using ascending numeric priority then stable `change_unit_id`, returning at most one selected CU and preserving other candidates without writing dependency edges.
- [ ] 4.6 Add dependency/ready/provider tests for missing or wrong provides, cross-namespace pseudo-matches, completion ABSENT/VALID/tampered/missing-original states, duplicate Feature binding, cycles, legal blockers, silent stalls, multiple ready candidates, stable tie-break and active-run suppression.

## 5. Thin Goal Mode progression and lifecycle

- [ ] 5.1 Implement the stateless progression decision/loop (`resume_active | select_one | blocked | ready_for_component_closure`) with an injected existing Goal Mode caller and a fresh derivation before and after every unit.
- [ ] 5.2 Build the deterministic Goal Mode handoff from canonical CU path/ref/hash, blueprint ref and derived Feature id; resolve expected track/chain through the existing workflow/track SSOT, keep manifest/events/reducer/receipt/evidence/recovery authoritative, and bind completion back to the exact Feature contracts/CU revision.
- [ ] 5.3 Implement rolling invalidation for blueprint/CU revision or fingerprint changes: stale unimplemented CU design/ready/mapping results; preserve completed CU artifacts and Goal Mode history; carry forward only when every historical stable target still resolves and remains admitted, otherwise block dependents and return to P1; require a new revising/superseding CU id for corrections and build no semantic-diff/invalidates engine.
- [ ] 5.4 Add the `change-unit-progression` Skill and register it through the existing `skills.index.yaml`/bundle chain; document standalone Feature compatibility, the single-main-agent concurrency assumption and the handoff to P3 without claiming closure.
- [ ] 5.5 Add static provider-boundary enforcement and tests for decomposition (optional), relation/ready analysis (required) and candidate selection (required): decomposition emits only temporary candidates, consumer validation writes provenance-bearing canonical CUs, exit cleans candidates but not accepted artifacts, and missing/replacement/duplicate authority cannot mutate Goal Mode facts.

## 6. Fixtures and integration regression

- [ ] 6.1 Add valid canonical fixtures for at least three dependent provenance-bearing vertical CUs over one P1 blueprint, their deterministically derived distinct Features, independent same-priority candidates and a current structured blocker.
- [ ] 6.2 Add negative fixture bundles for artifact/ref/provenance/Feature-binding identity, design closure, ID-only construction mapping, runtime/use-case/DAG obligations, unsafe intermediate state, empty horizontal units, dependency cycles/stalls and P2/P3 authority boundaries; all mutations must enter the production validator and assert exact issue ids.
- [ ] 6.3 Add a fake/injected Goal Mode integration that advances A→B→C one at a time only after workflow/track-derived authoritative completion validation, covers ABSENT/VALID/STALE/INVALID, and proves selection order is not written back as a dependency.
- [ ] 6.4 Add failure/pause/awaiting-human/resume integration cases showing the outer loop stops on the same run, starts no second CU, and recovers by rereading existing facts without a P2 ledger/checkpoint.
- [ ] 6.5 Add blueprint/CU-revision cases showing future mappings stale while completed history remains: all historical targets resolving and admitted permits carry-forward; missing/replaced/unknown/open/blocker targets return to P1 without semantic diff; add first-seam vertical-slice plus later-Provider replacement/consumer-change counterexamples.
- [ ] 6.6 Register every P2 suite in the existing unit/fixture runners and add mutation checks for constructability, ID-only mapping, runtime/use-case/DAG derivation, exact dependency matching, four-state completion, carry-forward, cycle/stall, selector and provider-boundary sub-checkers.

## 7. Verification and handoff

- [ ] 7.1 Run TypeScript typecheck and all focused P2 unit/fixture/Goal Mode integration suites; record exact pass counts and verify every negative fixture fails through the production entrypoint.
- [ ] 7.2 Because P2 extends existing Feature contracts/types/phase and Goal Mode integration while preserving `contracts.state_management` authority, run `cd harness && npm test` and resolve all regressions without weakening standalone Feature behavior.
- [ ] 7.3 Run `npm run openspec:validate`, `node scripts/check-plan-version.mjs` and `git diff --check`; if `openspec update` was used, first rerun `node scripts/patch-openspec-artifacts.mjs` as required.
- [ ] 7.4 Confirm no breaking consumer migration was introduced; update `MIGRATION.md` only if implementation evidence proves otherwise, and keep P3 Component closure explicitly out of this change.
- [ ] 7.5 Leave `node scripts/check-plan-version.mjs --release` and `npm run release:verify` unchecked until total-plan m5/MG executes the batch release gates; do not claim either passed before that run.
