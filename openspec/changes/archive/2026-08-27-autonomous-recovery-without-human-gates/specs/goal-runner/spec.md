## MODIFIED Requirements

### Requirement: Fidelity routing is a three-stage formula with auto-tiering and a single genuine-conflict halt

The runner SHALL derive fidelity routing as `inferred` requirement intent → `selected = resolveRequestedFidelity(inferred, manifest.fidelity)` → `effective = clampFidelityByCapability(selected, capability_snapshot)`. Explicit fidelity may hold or raise but MUST NOT lower frozen inferred intent, and no downgrade receipt or signer state SHALL be consulted. The capability snapshot SHALL contain only current execution capability and MUST NOT include artifact/history policy state. Acceptance strictness remains separate. A required selected fidelity that current native/delegated capability cannot satisfy SHALL project `DEFERRED_CAPABILITY_MISSING` before a content invocation. Prompts SHALL keep selected target and effective execution ceiling distinct.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: a receipt cannot downgrade selected fidelity

- **WHEN** inferred intent is hard pixel, manifest requests semantic layout, and a legacy downgrade receipt exists
- **THEN** selected SHALL remain pixel and the run SHALL use capable execution or defer; the receipt SHALL be ignored

### Requirement: Fidelity input reaches routing through all three entry paths

`buildGoalManifestFromInput` SHALL preserve and validate the explicit `fidelity` upgrade input across fresh CLI, hand-written manifest, and resume paths. Legacy `fidelity_receipt` fields MAY parse for compatibility but MUST NOT enter identity decisions beyond byte/hash compatibility and MUST NOT authorize lowering. A successor SHALL derive its target from the new frozen requirement/input, not inherit a prior downgrade authorization.

Enforcement: `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-manifest-cli.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: fresh and resume paths agree without a receipt

- **WHEN** a fresh run explicitly raises fidelity and is later resumed
- **THEN** both paths SHALL use the same frozen selected target without consulting a receipt

### Requirement: Integrity blockers classify as framework_integrity_block and halt on first touch

Framework release-tree integrity blockers (manifest corruption/tamper, foreign framework files, unreadable framework state) SHALL remain `framework_integrity_block` and halt on first touch without automated reverts. An invocation-scoped write to an owner-resolvable feature artifact or protected product/test source SHALL NOT be folded into that permanent framework-integrity halt: it SHALL emit `phase_write_violation`, invalidate invocation/owner/downstream trust, preserve bytes as untrusted, and automatically use `backtrack_to_phase` for full owner revalidation. Persistent concurrent mutation, unreadable/corrupt feature bytes, repeated identical violations, absent targets, and exhausted budgets SHALL terminate through existing integrity/fuse semantics.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: framework package tamper still halts

- **WHEN** a phase detects a changed release-manifest-bound framework file
- **THEN** the run SHALL halt `framework_integrity_block` without asking the agent to restore it

#### Scenario: downstream feature write recovers

- **WHEN** plan changes spec-owned acceptance bytes once and the bytes are stable/readable
- **THEN** the runner SHALL invalidate trust and backtrack spec instead of first-touch permanent HALT

### Requirement: Blocker actionability joins the decision ladder at a single position and splits timeouts in four steps

Aggregated blocker actionability SHALL enter the decision ladder after safety terminals and transient API handling, before content retry/no-progress and closure routing. Toolchain or genuine external blockers SHALL use their existing operator/external defer path. Agent-fixable blockers SHALL retry or produce trusted responsible-phase repair candidates. Quality blockers MUST NOT be classified `human_only`, parked for a signature, or routed to `await_human_gate_deferral`; required evidence gaps SHALL remain FAIL/UNVERIFIED or capability-missing according to whether capability was available. Timed-out attempts SHALL preserve the same distinction. Agent-written assumptions remain report-only and never authorize a transition.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: only a real toolchain blocker waits for the operator

- **WHEN** the only BLOCKER is an unavailable external toolchain capability
- **THEN** the runner SHALL use the existing external/operator path and SHALL not describe it as quality confirmation

#### Scenario: unsigned quality item no longer exists

- **WHEN** machine evidence for a required quality obligation is missing
- **THEN** the outcome SHALL be repair/evidence FAIL or capability defer, never `await_human_gate_deferral`

### Requirement: Feature completion is generated only from clean lineage and verified only through one entry point

`feature-completion.json` SHALL be generated only when every phase in the resolved chain is closed and fresh, each phase-advance matrix permits progression, every applicable `required_for_release` quality axis is PASS through `projectReleaseReadiness`, no trusted open BLOCKER/MAJOR or unexecuted P0 remains, and all recovery/backtrack transactions are committed. For P0 device flows, current runtime step evidence bound to feature, acceptance flows, derived plan, HAP/source, trace, run, attempt, device, and provider identity is mandatory. Flow truth SHALL come from spec-owned hash-bound acceptance evidence. Human receipt files, P0/fidelity/behavior/review waivers, `confirmed_by`, accepted debt, assumptions-ledger `must_review`, manual resume, and legacy runtime attestation MUST NOT satisfy any condition.

The completion original remains runner-owned and atomic with a feature projection. `verify-feature-completion` remains the sole consumer and SHALL recompute artifact/requirement/source/review/runtime/evidence-manifest hashes, run-event lineage, current workflow track/chain, quality projections, and absence of newer incomplete/terminal runs. Missing or malformed run/attempt identity fails closed. Legacy completion lineage that relied on a human quality key SHALL be recomputed from current machine evidence and MUST NOT remain valid by receipt presence.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`

#### Scenario: P0 completion uses runtime observations

- **WHEN** every phase is fresh and all required axes pass but a P0 device flow lacks current step observations
- **THEN** completion SHALL not be generated, regardless of a legacy runtime-fidelity receipt

#### Scenario: all machine obligations close completion

- **WHEN** the resolved chain, required axes, open-defect checks, and P0 runtime/visual evidence all verify under current identities
- **THEN** completion SHALL be generated without any user signature

### Requirement: Fidelity intent is detected from the dereferenced requirement SSOT with a capability pre-gate

Before phase prompting, the runner SHALL detect intent from the inline manifest requirement plus bounded, frozen source documents that existed at initialization. Generated feature outputs SHALL not enter requirement identity. Strong required visual intent without capable current execution SHALL yield `DEFERRED_CAPABILITY_MISSING`. Manifest fidelity remains upgrade-only; no downgrade receipt is valid. Ambiguous wording SHALL follow deterministic policy/frozen input and MUST NOT create an `await_human_fidelity_tier` gate.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: generated README cannot stale intent

- **WHEN** spec creates an output named in the requirement
- **THEN** the frozen requirement identity SHALL remain stable and no human fidelity decision SHALL be requested

### Requirement: Headless auto-decisions are recorded in a schema-validated JSONL ledger

The unattended prompt MAY record deterministic/default decisions in `<phase>/headless-assumptions.jsonl` for audit, with markdown as a human projection. Ledger `must_review` and user-like source strings SHALL be legacy/report-only and MUST NOT cap run status, advance a phase, authorize a gate change, or block completion. A decision requiring genuine external authority SHALL be represented by the existing external prerequisite state, while a quality uncertainty SHALL remain repair, UNVERIFIED/FAIL, optional advisory, or capability defer.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: historical must-review does not pause a run

- **WHEN** a legacy assumptions ledger has unresolved `must_review=true` rows
- **THEN** they SHALL appear in diagnostics only and current machine gates SHALL determine the run outcome

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Actionable defects SHALL retain signal-level `item_fingerprint` and existing event-sourced cumulative attempted accounting. A requested candidate becomes attempted only after the target phase actually executes. Eligible current identities backtrack once through the existing route. If all still-open identities were attempted, the runner SHALL retain `repair_not_converging` as a bounded convergence terminal/fuse and list machine evidence; same-run manual resume MUST NOT clear attempted identities, reset the fingerprint, change the quality conclusion, or create eligibility. Only new machine evidence producing a new identity, or a successor run with new identity/budget, can continue. A no-op owner repair SHALL not reuse downstream closures.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: manual resume cannot retry an attempted identity

- **WHEN** identity A remains open after its owner executed and the same run is manually resumed
- **THEN** A SHALL remain attempted and the convergence terminal SHALL remain unless new machine evidence changes the candidate set

### Requirement: Visual signals are adjudicated before candidate materialization

Visual signals SHALL be classified and validated before candidate materialization. A deterministic producer signal whose applicability/evidence contract passes SHALL materialize directly as a trusted machine repair candidate even when the primary agent disputes or omits it. A current delegated-provider payload that passes identity/hash/schema validation SHALL materialize through its existing provider path. Producer uncertainty or invalid/unreliable provider evidence SHALL not create a candidate: required quality stays FAIL/UNVERIFIED or capability-deferred and optional quality may remain advisory. The runner MUST NOT write `repair_adjudication_pending`, await `visual-confirm`, consume `confirmed_by`, or use human judgment as a third authority. Visual-round integrity and convergence events SHALL still be recorded before disposition.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: deterministic signal survives agent dispute

- **WHEN** a current deterministic layout invariant produces an applicable FAIL and the agent disputes it without independent machine counterevidence
- **THEN** the signal SHALL materialize a repair candidate and no human adjudication halt SHALL occur

#### Scenario: uncertain required evidence remains unclosed

- **WHEN** a producer cannot reliably compare a required signal
- **THEN** the required axis SHALL remain unclosed or capability-deferred without finalizing PASS or entering WAITING(human)

### Requirement: WAITING-projected halts revalidate before re-invoking the agent

Legacy event streams whose latest halt projects `WAITING` MAY use the existing validation-only resume optimization only to re-run machine gates against unchanged settled invocation evidence. That optimization MUST NOT clear a repair fuse, accept a receipt/signature, or turn an unchanged quality result into PASS. New quality failures SHALL not emit WAITING projections; genuine external prerequisite states retain their existing resume eligibility. Any newer invalidation/backtrack window takes priority.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: legacy waiting visual halt revalidates but does not pass by resume

- **WHEN** a legacy visual WAITING halt is resumed with no new machine evidence
- **THEN** the gate MAY run without another agent invocation but SHALL reproduce the current FAIL/UNVERIFIED/defer result rather than release it

### Requirement: Trusted repair candidates are a single shared fact in the phase summary

The harness SHALL project trusted actionable defects into `summary.repair_candidates[]` as the single machine-derived fact consumed by goal, batch, and manual drivers. Review candidates require structurally valid current reports and item-level verifier evidence; a conditional-review receipt or accepted-risk statement MUST NOT suppress them. Check-derived ownership SHALL prefer registered machine check/failure-kind mapping over affected-path fallback; underivable/mixed ownership produces no trusted candidate. Testing device/visual evidence SHALL be merged into the same field only after its existing identity/freshness verification. Failure to persist candidates remains fail-closed. Agent prose MUST NOT self-declare ownership or create a candidate.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`, `harness/prompts/verify-review.md`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: signed conditional review still produces candidates

- **WHEN** current item-level evidence verifies open MAJOR findings and a legacy conditional authorization exists
- **THEN** the findings SHALL remain repair candidates and route to their responsible phase

### Requirement: Assess routes repair candidates to the responsible phase via strict workflow mapping

Assess SHALL map repair-candidate ownership through the current resolved workflow/track, returning no phantom phase and no chain-head fallback. Multiple owners target the most-upstream real phase while retaining the grouped facts. Goal and unattended batch execution SHALL automatically authorize any in-chain earlier target through the single `backtrack_to_phase` branch, existing invalidation transaction, budget, and fingerprint fuse. Manual UI MAY display the routing but MUST NOT require confirmation to preserve quality. A target absent from the actual chain remains `backtrack_target_absent`. Old phase-specific execution branches and dead recommendation actions MUST NOT coexist.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/correction-routing.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-in-session-driver.ts`

#### Scenario: plan-owned defect from testing backtracks automatically

- **WHEN** testing emits a trusted plan-owned candidate and plan is earlier in the actual chain
- **THEN** assess/driver/runner SHALL execute one `backtrack_to_phase:plan` transaction without human authorization

### Requirement: Run end-state classification uses the executed slice; the assumptions ledger never gates it

Run end-state classification SHALL evaluate the actually executed chain slice, while feature completion evaluates the full chain. Assumptions-ledger rows and human-signature artifacts SHALL never gate either result. Current quality issues SHALL project only as repair/incomplete, capability-missing/deferred, optional advisory, genuine external prerequisite, or precise terminal/fuse outcomes through existing projectors.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: spec-only clean run has no signature cap

- **WHEN** a spec-only run closes its executed slice and only legacy human-signature items remain
- **THEN** the run SHALL classify from current machine gates and SHALL not become `AWAITING_HUMAN_REVIEW`

### Requirement: Downstream-start runs must not rewrite spec-owned frozen decision files

A downstream-start run SHALL read and reuse upstream frozen decision files byte-for-byte. If requirement/fidelity identity differs, files are corrupt/missing where required, or upstream closure is stale, the runner SHALL produce the total earlier-gap disposition: return to the actual owner through `backtrack_to_phase` when the resolved chain/run can execute it, otherwise surface `backtrack_target_absent` with a successor/full-chain route. A hard capability conflict still defers using in-memory capability facts. The runner MUST NOT rewrite upstream files, emit a dead `rerun_phase:*` recommendation, or classify a known owner gap as `framework_bug`.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/goal-assess-driver.ts`

#### Scenario: plan start observes stale spec

- **WHEN** a run starts at plan and the spec closure is stale while the effective workflow permits a spec backtrack
- **THEN** the runner SHALL invalidate downstream state and execute spec backtracking rather than halt with only `rerun_phase:spec` guidance

## ADDED Requirements

### Requirement: Earlier-phase gaps have a total executable disposition

For every upstream phase in the resolved chain, the runner SHALL map `missing`, trusted `failed`, `legacy_unverified`, `unclosed`, `pruned`/assurance-insufficient, and `stale` gaps to exactly one executable disposition using existing facts. Missing/failed/legacy-unverified and stable stale bytes return to owner revalidation. A provable partial finalization is completed idempotently; otherwise fresh valid unclosed evidence may use `complete_closure`, while stale/invalid unclosed evidence returns to the owner. Pruned evidence is restored/re-signed only when current in-repository trusted artifacts prove it; otherwise it returns to owner or defers for a genuine capability gap. Runner-owned equivalent rewrites may refresh narrowly. Current downstream writes use the phase-write-violation recovery contract. Known gaps MUST NOT fall through to catch-all `framework_bug` or display-only actions.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/upstream-closure.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: every earlier owner/current pair is executable

- **WHEN** any earlier phase in a full, lite, or valid custom chain is missing, failed, legacy-unverified, unclosed, pruned, or stale
- **THEN** the disposition SHALL be backtrack, proven closure completion/refresh, capability defer, or a precise existing terminal/fuse result, never a dead recommendation

### Requirement: Closure recovery precedes generic freshness rejection

When staged summary and already-published closure components prove the same run/attempt finalization, resume SHALL reconcile them before upstream freshness gates reject the state. Each manifest, pointer, phase-state, and canonical-summary cut SHALL be idempotent. A closed-summary mismatch without runner-owned equivalence proof SHALL invalidate and backtrack; it MUST NOT publish evidence against current bytes.

Enforcement: `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/upstream-closure.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: pointer published but summary rename missing

- **WHEN** the pointer and phase state identify a staged summary whose expected hash and run/attempt identity verify but canonical rename did not occur
- **THEN** resume SHALL publish the canonical summary exactly once before normal freshness consumption

### Requirement: Recovery diagnostics report the actual disposition

Progress, report, and terminal projection SHALL carry the latest stable recovery reason, current phase, owner/target phase, gap kind, normalized changed paths and safe pre/post hashes, suggested machine action, and budget/fingerprint facts. Capability defer, phase write violation, target absence, budget/fingerprint fuse, external prerequisite, and framework defect SHALL remain distinct. A generic `HALTED` summary MUST NOT be paraphrased as an unspecified external wait.

Enforcement: `harness/scripts/utils/goal-progress.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/utils/run-state-reducer.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: bc-openCard write violation is visible

- **WHEN** plan changes acceptance and recovery backtracks spec
- **THEN** status SHALL report plan write violation, spec owner, the exact path, and automatic spec revalidation rather than `rerun_phase:spec` or a generic external wait

## REMOVED Requirements

### Requirement: Blind visual launch requires one explicit authorization per run

**Reason**: Blind execution quality is determined by frozen requirements and actual native/delegated capability. A per-run human waiver wastes interaction and can authorize an evidence gap without fixing it.

**Migration**: New CLI/manifest writers remove `--allow-blind-visual` and `allow_blind_visual`. Legacy manifests may parse the field but it is ignored. UI runs with required visual evidence use native/delegated capability or defer; optional non-strict visual evidence follows existing advisory policy.
