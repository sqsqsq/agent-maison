## ADDED Requirements

### Requirement: Full-track closure is published by staged summary commit
The closure finalizer SHALL validate evidence, construct final summary 1.2 bytes, generate the phase evidence manifest from the staged summary hash while recording the canonical summary path, strictly update `.current-phase.json`, and atomically publish the staged summary last. Enforcement SHALL be implemented in `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-state.ts`, and `harness/scripts/utils/phase-evidence-manifest.ts`.

#### Scenario: Manifest generation fails
- **WHEN** closure evidence validation passes but attestation, manifest, or pointer generation fails
- **THEN** canonical summary MUST remain open and downstream recommendation MUST remain ineligible

#### Scenario: Staged summary is published
- **WHEN** finalization succeeds
- **THEN** recomputing the manifest entry for canonical `summary.json` SHALL match the bytes published by the atomic rename

### Requirement: Summary 1.2 distinguishes verified closure and quality depth
`harness/schemas/summary.schema.json` and mirrored TypeScript readers SHALL support schema 1.2 with `depth` and versioned `closure_commit@1`. Full-track closure SHALL require the commit marker and a valid manifest.

#### Scenario: Existing summary lacks depth
- **WHEN** a 1.0 or 1.1 summary is consumed after upgrade
- **THEN** depth SHALL be `unknown` until harness rerun or explicit validating migration

### Requirement: Phase-state persistence is strict during closure
The closure finalizer MUST treat `.current-phase.json` write failure as a failed finalization rather than logging a warning and publishing closed summary state.

#### Scenario: Current-phase state cannot be persisted
- **WHEN** strict phase-state writing fails after evidence artifacts are staged
- **THEN** the finalizer MUST stop before canonical summary commit

### Requirement: Harness output includes deterministic next-step guidance
Feature-scope phase checks SHALL append a bounded next-step block outside the existing `HARNESS_SUMMARY` machine block. Global, sentinel `_global`, and `--adhoc-correction` paths SHALL remain silent.

#### Scenario: Feature phase check completes
- **WHEN** a supported feature phase reaches harness exit
- **THEN** output SHALL include the current feature/phase/mode status and the assessment recommendation without changing the machine block
