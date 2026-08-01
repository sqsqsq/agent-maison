## Why

Feature skills currently encode their inputs, outputs, verification depth, and next-step guidance in prose and scattered harness logic. This makes skills difficult to compose independently, allows hidden coupling and duplicated routing decisions, and gives users no deterministic way to reconcile the current feature state after a phase completes or a session resumes.

## What Changes

- Add versioned artifact schemas for skill-authored feature artifacts and machine-readable contracts for all seven feature skills.
- Add consistency gates that validate producer/consumer reachability, control dependencies, skill-document linkage, track/tier compatibility, and deterministic tier selection.
- Add a deterministic `assess@1` engine that observes artifacts and phase summaries, computes workflow/depth/closure gaps, and emits one recommendation plus alternatives without using an LLM.
- Add `next.json` as a disposable, fingerprint-bound projection so “continue” can be reconstructed across sessions without becoming a new SSOT.
- Add input-sensitive quality tiers for business UT, device testing, and code review while preserving the existing truth criteria and external-block semantics.
- **BREAKING** Extend harness summary schema to 1.2 with `depth` and `closure_commit@1`; legacy closed summaries become `legacy_unverified` until re-finalized.
- **BREAKING** Add a concise “next step” section to feature-phase harness output outside the existing `HARNESS_SUMMARY` machine block and replace hard-coded skill epilogues.
- Replace the unsafe receipt closure sequence with a staged, crash-consistent finalizer that binds the final summary bytes into the phase evidence manifest before publishing `closed`.

## Capabilities

### New Capabilities

- `skill-contracts`: Versioned skill inputs, outputs, verification providers, tier predicates, and artifact-schema compatibility.
- `reconcile-assessment`: Deterministic observe/diff/recommend behavior, closure/depth completion rules, fingerprinted projections, and next-step rendering.
- `skill-quality-tiers`: Input-sensitive full/basic/adhoc execution contracts for selected feature skills without weakening PASS semantics.

### Modified Capabilities

- `harness-gates`: Feature-phase closure becomes staged and versioned, summaries expose depth, and successful checks publish deterministic next-step guidance.
- `feature-artifact-layout`: The feature root gains the disposable `next.json` projection and artifact schemas become the public compatibility boundary for skill-authored artifacts.

## Impact

- Affects `skills/feature/`, `specs/artifact-schemas/`, `specs/skill-contract-schema.yaml`, workflow metadata, harness summary and receipt finalization, phase evidence manifests, and harness output.
- Adds consistency/unit/fixture coverage and updates `MIGRATION.md` for summary 1.2, legacy closure re-finalization, and stdout consumers.
- L1 is descriptive; L2 changes observable harness behavior and closure persistence; L3 adds new tiered execution behavior.
- This change must complete and freeze `assess@1` plus the contract schema before `goal-reconcile-loop` is implemented.
