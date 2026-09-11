## ADDED Requirements

### Requirement: Facts 1.1 follows the actual invocation subject and establishing phase

Facts 1.1 SHALL validate the actual first Skill from the explicit invocation context, not require spec/change. Feature facts SHALL bind feature/run identity; request facts SHALL bind request_sha256 exclusively and use the explicit report-dir/context/facts.md path without Feature path resolution. Checkers SHALL verify real Code Facts, current source coverage/readability, ready_to_produce and blocker coverage risk; agents SHALL establish them before their phase's substantive work.

A reused baseline SHALL preserve its original established_by, verify its baseline fingerprint and source dependencies, and require the current phase_delta. Legacy 1.0 facts SHALL only enter the modern path through an explicit validated baseline. New malformed records SHALL NOT fall back to legacy. Quantitative checks/profile snippets SHALL use the actual phase and resolved inputs; reused facts SHALL NOT repeat a new phase's full exploration budget. Checkpoint/evidence/verifier SHALL use the same actual facts path, without restoring retired pass snapshots or creating out-of-repo state.

Enforcement: `harness/scripts/utils/context-facts.ts`, `harness/scripts/utils/context-exploration.ts`, `harness/scripts/utils/exploration-strategy.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`, `harness/scripts/utils/goal-checkpoint.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/harness-runner.ts`.

#### Scenario: Coding is the first real phase
- **WHEN** a valid invocation starts at coding with no facts
- **THEN** coding SHALL establish a 1.1 baseline before writing implementation and the checker SHALL accept its actual establishing identity

#### Scenario: Standalone review has no Feature
- **WHEN** review has a request subject and matching explicit target context
- **THEN** facts SHALL be read only from its request report directory, with no fabricated feature or run fields

#### Scenario: Successor preserves previous facts identity
- **WHEN** testing inherits a validated coding-established baseline
- **THEN** it SHALL retain established_by coding and append testing delta; changed baseline/source bindings SHALL fail

#### Scenario: Later facts append does not invalidate consumed evidence
- **WHEN** a later phase appends its own unrelated phase_delta after coding evidence was published
- **THEN** coding SHALL remain fresh; changing its consumed baseline or coding delta SHALL still make it stale, using the same phase projection in ordinary and staged evidence verification

#### Scenario: Facts sources change between validation and publication
- **WHEN** a facts baseline dependency no longer matches its recorded exists/sha256 at publication
- **THEN** manifest, verifier-material and closure publication SHALL report the existing input-binding stale diagnostic instead of binding the new bytes
