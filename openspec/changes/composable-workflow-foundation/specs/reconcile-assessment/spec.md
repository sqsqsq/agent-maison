## MODIFIED Requirements

### Requirement: Assessment deterministically observes and reconciles feature state
`harness/scripts/assess.ts` SHALL deterministically observe feature artifacts and phase summaries, diff them against the validated execution scope and goal (workflow/track only for legacy protocol), and emit `assess@1` with observed facts, gaps, one recommendation, alternatives, and stop state.

#### Scenario: Identical authoritative inputs are assessed twice
- **WHEN** assess runs twice without execution-scope, workflow, artifact, summary, evidence, goal, or injected observation changes
- **THEN** both results SHALL have the same observed fingerprint, gaps, recommendation, and fuse state

### Requirement: Closure is required before downstream recommendation
For phases required by the validated scope (legacy full-track phases under the old protocol), assess SHALL qualify `closed` only when summary schema is 1.2, `closure_commit@1` exists, and the referenced phase evidence manifest verifies. Enforcement SHALL use `harness/schemas/summary.schema.json`, `harness/scripts/utils/phase-evidence-manifest.ts`, and `harness/scripts/assess.ts`.

#### Scenario: Harness passes but receipt closure is open
- **WHEN** a phase required by the validated scope has verdict PASS and closure is open
- **THEN** assess SHALL recommend completing that phase's closure and MUST NOT recommend a downstream phase

#### Scenario: Legacy summary claims closed
- **WHEN** a 1.0 or 1.1 summary says closed
- **THEN** assess SHALL report `legacy_unverified` and MUST NOT qualify downstream work

### Requirement: Next-step projection is fingerprint-bound and disposable
Assess SHALL write `<features_dir>/<feature>/next.json` as a non-authoritative projection bound to the execution scope, workflow/contract policy, goal, run-attempt, summary, and evidence fingerprints (track only for legacy protocol). The continue path SHALL recompute the projection on absence, corruption, or mismatch, using the same validated scope rather than re-planning obligations.

Enforcement: `harness/scripts/assess.ts`, `harness/scripts/utils/assess.ts`.

#### Scenario: Feature state changes after next.json is written
- **WHEN** a user or agent requests continue and the stored fingerprint differs from authoritative state
- **THEN** the driver MUST rerun assess and MUST NOT execute the stale recommendation
