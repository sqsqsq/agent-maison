## Context

The current implementation already has most of the primitives needed for autonomous recovery: workflow-derived phase chains, phase contracts and artifact registries, coding/UT/testing scope resolvers, `summary.repair_candidates[]`, `backtrack_to_phase`, downstream invalidation, capability blockers, quality-axis projectors, staged summaries, evidence manifests, and runner-owned event/state files. The failure is in composition: some gap recommendations are descriptive only; phase invocations have no common write-boundary attribution; closure publication is not resumable at every publication cut; and several quality outcomes can still be released by a human receipt or manual resume.

The design must preserve the three principles in `docs/overview.md §1.2.1`: simple-first, backtrack-and-re-sign, and recoverable collaboration. It must not introduce a second owner registry, recovery state machine, visual verdict lattice, or off-repository trust store.

### OpenSpec topology

| Change | Disposition | Relationship |
|---|---|---|
| `delegated-vision-provider` | already archived | canonical provider/evidence base |
| `unified-responsible-phase-routing` | validated and archived | canonical repair-candidate/backtrack base |
| `simplify-visual-trust` | corrected a stale MODIFIED header, validated and archived | canonical current-invocation visual trust base |
| `runner-owned-machine-facts` | validated and archived | canonical runner-owned identity base |
| `product-selection-unresolved-gate` | validated and archived | ordinary selection provenance; not a quality receipt |
| `device-policy-truth-and-serial-wiring` | validated and archived | genuine device/external prerequisite base |
| `agent-containment-and-takeover` | validated and archived | process-control authority base |
| `p0-skip-repair-subtraction` | partially superseded here | keep repair-candidate routing; remove waiver and generic human release |
| `critic-loop-hardening` | partially superseded here | keep structured findings/fuse/provider evidence; remove `visual-confirm` authority and human feedback as gate state |
| `layout-oracle-geometry-gates` | partially superseded here | keep deterministic geometry/attestation; replace T2 human final confirmation with machine evidence/defer |
| `goal-host-replay-fixes` | partially superseded here | keep dry-run/budget/event truth; replace human mutation adjudication with owner revalidation |
| `runtime-policy-core` | compatible dependency | consume its resolved chain/policy API; do not duplicate it |
| `host-runtime-truth` | compatible dependency | consume provider/runtime capability facts; current-run evidence remains separate |
| UT/device freshness changes | independent/compatible | preserve their scopes and external device safety semantics |

Incomplete predecessor changes are not archived by this implementation. Their contradictory clauses are superseded by this change; their unrelated pending host verification remains honest and independent.

### Structured consumer inventory

| Mechanism | Classification | Principal production consumers | Disposition |
|---|---|---|---|
| `confirmed_by`, `human_confirmed`, human visual acceptance | quality pass key | `visual-diff-check.ts`, `check-spec.ts`, `fidelity-shared.ts`, UI-spec schema/helpers, testing/spec rules and skills | legacy-read only; remove all gate effects and new writes |
| `visual-confirm`, review feedback ledger | human verdict/recovery channel | `visual-confirm.ts`, harness package script, goal guidance, visual-diff/check/calibration docs | remove CLI and quality authority; machine calibration data stays machine-produced |
| `repair_adjudication_pending` | human recovery key | `goal-runner.ts`, `adjudication.ts`, visual provider/check | deterministic/provider evidence materializes candidates; uncertain required evidence fails/defer; no WAITING(human) |
| `repair_not_converging` | convergence fuse plus human resume key | `goal-runner.ts`, `assess.ts`, `adjudication.ts` | keep fuse; same-run resume cannot clear attempts/fingerprint or quality conclusion |
| `allow_blind_visual` / `--allow-blind-visual` | quality-risk waiver | goal manifest/CLI/runner/schema, setup/goal skills and runbook | stop new field/flag; legacy reader ignores; strict missing capability defers |
| `p0_skip_waiver`, `fidelity_downgrade`, `conditional_review_authorization`, `behavior_switch_waiver` | quality-lowering receipts | semantic gates, review/spec checks, runner/adjudication, rules | delete; repair, requirement correction, or capability defer instead |
| `source_mutation_authorization` | write-boundary waiver | mutation authorization, runner, confirmation receipt | delete; retain bytes as untrusted and backtrack owner for full revalidation |
| `flow_contract` | duplicated spec truth | spec/P0/completion/report consumers | replace with spec-owned hash-bound flow evidence |
| `runtime_fidelity_attestation` | quality obligation stored as human receipt | completion verifier, adjudication, runbook | migrate obligation to runtime step evidence; legacy receipt never gates |
| crop/bbox/baked-text confirmation fields | mixed provenance and pass key | UI-spec schema/helpers, asset acquisition/crop validation, spec checks | retain neutral input/tool/hash provenance; remove human signing authority |
| `confirmed_by_user` catalog staging | ordinary attended input provenance | catalog skills/prompts/templates | rename new writes to neutral selection provenance; unattended path uses frozen input/default, not a quality gate |
| `AWAITING_HUMAN_REVIEW`, `needs_human`, `await_human_*` | mixed legacy projection | quality axes, progress/report/reducer, schemas, phase rules | quality causes stop producing them; legacy read maps to repair/capability diagnostic; genuine external authority remains separately classified |

The implementation inventory is enforced by a final `rg` allowlist: production paths may retain these strings only in explicitly documented legacy readers, external-authority compatibility, migrations, and negative tests. Fixtures may preserve historical bytes but cannot be consumed as current authority.

## Goals / Non-Goals

**Goals:**

- Produce exactly one executable outcome for every earlier-phase gap in every resolved full/lite/custom chain.
- Attribute only mutations made during a controlled phase invocation and map each changed path to exactly one existing owner resolver.
- Recover from first-time downstream writes and closure publication crashes automatically without trusting changed bytes prematurely.
- Make deterministic/current provider evidence the only quality authority and distinguish missing capability from failed evidence production.
- Keep completion and phase advance on the existing quality-axis projectors and preserve genuine external permissions.
- Read existing consumer artifacts without bulk migration while ensuring new writers emit no human quality pass key.

**Non-Goals:**

- A general autonomy/permission framework, provider pool, new visual verdict enum, owner manifest, signature ledger, or persistent invocation snapshot.
- Automatic rollback of user or concurrent filesystem changes.
- Obtaining secrets, approving irreversible actions, spending budget, or making legal commitments.
- Rewriting archived OpenSpec history or running consumer-host smoke tests without an explicit user-triggered host task.

## Decisions

### 1. Derive write ownership from existing producers and scope resolvers

Add a shared in-memory resolver that consumes the active workflow chain, `loadFeatureContracts`/`phaseContractIndex`, contract `produces`, artifact registry/phase-evidence paths, coding `in_scope_modules` plus module paths, the active profile's UT test roots, and the testing protected-source resolver. Workflow supplies order only. A new path is writable only when it uniquely matches the current phase's artifact or source producer; zero/multiple matches fail closed. Runner event/state/evidence writes are excluded from agent attribution by taking the before/after snapshot strictly around the agent invocation.

Alternative rejected: a new owner manifest would duplicate contracts and profile scope, drift on custom workflows, and violate the repository's SSOT rule.

### 2. Normalize gaps to a total disposition before the driver

Introduce a pure disposition result inside the existing assess/driver modules: `backtrack_to_phase`, `complete_closure`, `runner_refresh`, `defer_capability`, `retry_current`, or a precise terminal/fuse reason. It reads trusted `repair_candidates[]`, upstream closure status, phase order, provenance, evidence freshness, and existing budgets. Recommendations such as `run_phase:*`, `rerun_phase:*`, and `restore_inputs_and_rerun` remain display-compatible only and never drive execution.

Missing/failed/legacy-unverified and stable stale bytes return to the owner. Pruned evidence is deterministically reconstructed only from current in-repository trusted artifacts; otherwise it returns to the owner or defers for a real missing capability. A first write violation invalidates the invocation, the owner closure, and downstream closures, then uses the existing backtrack transaction. Repeated identical violations, unstable/unreadable bytes, absent targets, or exhausted budgets use existing fuses and terminal semantics.

Alternative rejected: special-casing `spec` would leave the same break for plan/coding/review/UT/testing and custom chains.

### 3. Recover closure publication from existing staged artifacts

Treat staged summary plus manifest, pointer, phase state, and canonical summary as one recoverable protocol without adding a journal. Recovery runs before generic freshness rejection, verifies canonical target, expected summary hash, receipt, run/attempt identity, and every already-published component, then idempotently completes the remaining steps. If identity cannot be proven, it backtracks the owner.

Closed-summary hash drift no longer calls generic evidence rebinding. Only a narrowly proven runner-owned equivalent rewrite can refresh evidence; ordinary or unknown drift invalidates closure and triggers owner revalidation.

### 4. Split runtime capability from runtime evidence

Before a P0 device testing invocation, the profile/provider capability handshake declares whether `runtime_step_telemetry` is supported. Unsupported or bounded-probe-unavailable providers project through the existing external/capability-missing carrier and perform zero content retries. Only an available provider is invoked. Once support is declared, missing, malformed, stale, replayed, misordered, wrong-target, or incomplete step observations are testing BLOCKER failures, never capability-missing.

The existing `device-test-evidence.json` and testing phase evidence bind each required checkpoint to case/step identity, action, declared target, actual stable node identity or hit bounds, pre/post screen signatures, required/forbidden observations, outcome, device session, provider/tool version, run and attempt, plus hashes of feature, flows, derived plan, HAP, source aggregate, and trace. No confirmation receipt or independent ledger is added.

### 5. Remove human quality authority before changing completion projection

Machine evidence migration lands first. Then all receipt actions are migrated or removed, `visual-confirm` and blind authorization are deleted, and legacy fields become ignored provenance. Deterministic FAIL always materializes repair or stays FAIL. Valid current delegated/native evidence can close applicable axes. Required evidence that cannot be produced because the capability is absent defers; evidence failure under a claimed capability retries/fuses. Optional unverified axes remain advisory only under existing policy.

`repair_not_converging` remains a fuse, not an approval queue. User feedback after delivery becomes a new correction/successor input and cannot rewrite the old completion proof.

### 6. Preserve the existing projector split

Phase advance continues to use the phase matrix plus `projectPhaseAdvanceVerdict`. Release/completion continues to use `required_for_release`, `projectReleaseReadiness`, and `verify-feature-completion`. No `required_for_phase_advance` field is added to `QualityAxis`. Quality-derived `needs_human` is retired; real external prerequisites retain a separate external owner/classification.

### 7. Diagnose the action actually taken

Progress/report projection consumes the latest recovery or halt event and reports stable fields: current phase, gap kind, owner/target phase, changed paths and hashes where safe, disposition, budget/fingerprint state, and exact terminal reason. `HALTED` is not paraphrased as a generic external wait. Secret-bearing values and long agent text remain excluded.

## Risks / Trade-offs

- [Broad legacy vocabulary makes accidental consumers easy to miss] → maintain a structured inventory, production `rg` allowlist, schema writer tests, and negative completion tests.
- [Dynamic owner resolution may classify a new file as ambiguous] → fail closed and require an existing contract/profile resolver; never grant broad source ownership.
- [Keeping violating bytes could appear to accept them] → invalidate all old trust first and require the owner's complete machine gates before re-signing.
- [Closure recovery could rebind unrelated drift] → require exact staged/canonical identity and fault-inject every publication cut; otherwise backtrack.
- [Runtime providers may overclaim telemetry support] → treat post-handshake evidence absence/invalidity as ordinary testing failure with retry/fuse, not capability defer.
- [Removing human fallback can expose real capability gaps] → project `DEFERRED_CAPABILITY_MISSING` honestly; do not manufacture completion.
- [Active predecessor changes may later be archived with obsolete clauses] → this proposal records explicit supersession; their conflicting deltas must be removed or reconciled before any future archive.

## Migration Plan

1. Archive validated completed dependencies and record active-change dispositions.
2. Add owner/write-boundary and total gap disposition while old human gates still block completion.
3. Add runtime step evidence and prove unsupported-versus-invalid behavior.
4. Remove human/waiver consumers, CLI/scripts, and new-writer fields; update canonical phase rules, skills, templates, and runbook.
5. Switch completion/progress projections and legacy readers atomically in the same release window.
6. Run strict OpenSpec validation, typecheck, focused suites, then `cd harness && npm test`; only after production zero-consumer checks may the generic quality receipt module be deleted.

Rollback is code rollback to the pre-change release. Legacy artifacts remain readable throughout, so rollback requires no consumer data transformation.

## Open Questions

None. The owner sources, capability/evidence split, legacy strategy, completion projectors, and external-authority boundary are frozen by the approved plan.
