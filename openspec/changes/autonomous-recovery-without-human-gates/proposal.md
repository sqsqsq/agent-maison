## Why

The bc-openCard incident proved that an earlier-phase artifact gap can be diagnosed correctly yet still halt because the recommendation never becomes the runner's existing `backtrack_to_phase` transaction. In parallel, human confirmation receipts and visual/source waivers let a name or manual resume act as a quality or recovery pass key, which is incompatible with unattended, repeatable development.

## What Changes

- **BREAKING**: retire human confirmation, `confirmed_by`, `human_confirmed`, `visual-confirm`, blind-run authorization, P0 skip/fidelity/conditional-review/behavior/source-mutation waivers, and generic human adjudication as inputs that can advance a phase, release a feature, or resume a repair loop. Legacy fields remain readable but inert; new writers stop producing them.
- Route every trusted earlier-phase gap through one workflow-derived disposition and the existing `backtrack_to_phase` transaction. Missing, failed, legacy-unverified, stale, pruned, and unclosed evidence obtain explicit recover/backtrack/defer/terminal outcomes instead of dead `rerun_phase:*` guidance or catch-all `framework_bug`.
- Add an invocation-scoped, dynamically derived phase write boundary using existing workflow, phase-contract `produces`, artifact/evidence resolvers, coding scope, profile UT roots, and testing source protection. A downstream write invalidates trust and automatically returns to the owner for full machine re-verification; it is not accepted, reverted, or human-waived.
- Make phase closure publication crash-recoverable across staged summary, manifest, pointer, phase state, and canonical rename. Arbitrary closed-summary drift can no longer be rebound to current bytes without runner-owned equivalence proof.
- Add runner/provider-owned P0 runtime step observations to existing device-test evidence and testing evidence manifests. Capability support is decided before provider execution; an unsupported provider defers as capability-missing, while a provider that claims support but emits missing/invalid/stale evidence fails testing and retries normally.
- Project phase advance and completion only through the existing quality-axis lattice and its current phase/release projectors. Deterministic FAIL cannot be changed by a user identity; strict missing visual/runtime capability defers honestly; optional unverified evidence remains advisory only where existing release policy permits it.
- Treat post-delivery UX feedback as a new correction/successor run input. Preserve genuine external prerequisites such as secrets, irreversible actions, legal authority, destructive device actions, and hard budgets under their existing external-wait/authorization semantics.
- Replace generic HALTED summaries with stable recovery diagnostics carrying the actual owner, gap kind, changed paths, hashes, disposition, and fuse/budget facts.

## Capabilities

### New Capabilities

- `phase-write-boundary`: derives per-invocation source/artifact ownership from existing contracts and scope resolvers, records violations, invalidates stale trust, and returns work to the responsible phase without a new owner manifest or state machine.
- `runtime-step-evidence`: defines hash-bound device-provider observations and verification for every required P0 checkpoint, including the capability-preflight/evidence-result split.

### Modified Capabilities

- `goal-runner`: unify earlier-gap disposition, automatic responsible-phase backtracking, resumable closure publication, repair convergence, completion, and precise terminal diagnostics without human release keys.
- `harness-gates`: remove receipt/waiver quality lowering, enforce runtime-step evidence, and preserve the existing phase-advance/release projector split.
- `visual-diff`: remove human-final-confirmation and blind authorization gates while retaining deterministic and current delegated-provider machine evidence.
- `confirmation-receipts`: retire the generic quality-lowering receipt mechanism after migrating every action; retain only narrowly named external authority where a real outside permission cannot be preconfigured.
- `feature-artifact-layout`: make legacy human-signature fields/files readable but inert and stop new writers from producing them; bind runtime observations through existing evidence locations.
- `verdict-lattice`: remove quality-derived `needs_human` progression and keep capability-missing, repair, optional advisory, and external authority as distinct projections.
- `runtime-policy`: expose the resolved workflow/contract facts used by phase ownership without adding a parallel phase or owner registry.
- `correction-routing`: represent post-delivery user feedback as successor input routed to the responsible phase rather than a signature on a completed run.

## Impact

- Runtime: goal runner, assess/driver/backtrack, phase closure/evidence manifests, phase contracts and scope resolvers, completion projection, visual/provider adjudication, mutation handling, device-test evidence, progress/status, and all affected phase prompts.
- Schemas and CLIs: summary/visual/device evidence compatibility readers, goal manifest blind-authorization compatibility, removal of `visual-confirm` and quality receipt commands/scripts, and deprecated legacy fields accepted without gating.
- Tests: full/lite/custom phase-owner matrices, all earlier-gap kinds, write-attribution and closure crash injection, visual/runtime capability-versus-evidence matrices, legacy read/new-writer-zero-consumer assertions, and the bc-openCard incident replay.
- OpenSpec topology: `unified-responsible-phase-routing`, `simplify-visual-trust`, `runner-owned-machine-facts`, `product-selection-unresolved-gate`, `device-policy-truth-and-serial-wiring`, and `agent-containment-and-takeover` are archived canonical dependencies. This change supersedes the contradictory human-quality portions of `p0-skip-repair-subtraction`, `critic-loop-hardening`, `layout-oracle-geometry-gates`, and `goal-host-replay-fixes`; compatible runtime/host/UT/device-freshness work remains independent.
- Migration: consumers do not rewrite existing feature artifacts. Old human-signature fields and receipt files are tolerated on read but no longer authorize PASS or recovery; new runs stop emitting them. Breaking CLI and manifest-field removal is documented in `MIGRATION.md`.
