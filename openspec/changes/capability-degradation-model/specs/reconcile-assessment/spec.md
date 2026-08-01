## MODIFIED Requirements

### Requirement: Required assurance is phase-specific
Assess SHALL read actual `assurance` from summary 1.2 capability-resolution data and
compare it to optional sparse `minimum_assurance` entries in the goal manifest using
`blocked < degraded < full`. A missing phase key SHALL add no goal-level floor. A
phase below an explicit floor SHALL emit `insufficient_assurance`; legacy or invalid
assurance data SHALL remain non-qualifying until the harness reruns.

Assess SHALL NOT use `minimum_assurance` to override quality-axis, phase-advance,
closure, or release readiness decisions.

#### Scenario: Degraded PASS is below a full requirement
- **WHEN** a phase is mechanically degraded and its goal requires full assurance
- **THEN** assess SHALL emit an `insufficient_assurance` gap and recommend restoring the necessary capability inputs

#### Scenario: Goal has no phase assurance key
- **WHEN** a goal manifest omits `minimum_assurance` for a phase
- **THEN** assess SHALL not reject the manifest or add an assurance gap solely for that omission

## ADDED Requirements

### Requirement: Assessment reports authorized degradations and blocked capability effects
Assess SHALL consume persisted capability resolutions rather than re-resolving inputs.
A pruned capability satisfying any explicit floor SHALL be represented in
`observed.degradations` and SHALL not create an additional assess gap. If an upstream
pruned capability prevents a downstream core capability from resolving, assess SHALL
emit the existing `pruned` propagation gap with producer guidance.

A blocked capability SHALL be observed through the summary's existing non-PASS and
closure facts; assess MUST NOT create a parallel blocked gap type.

> **Enforced by:** `harness/scripts/utils/assess.ts`, goal-manifest handling, summary
> readers, and assess unit tests.

#### Scenario: Authorized degradation is otherwise qualified
- **WHEN** a pruned capability satisfies the goal floor and all independent quality and closure conditions qualify
- **THEN** assess SHALL include the degradation in observations without adding an extra gap

#### Scenario: Blocked visual capability is persisted
- **WHEN** a blocked visual capability clamps the projected summary verdict to INCOMPLETE
- **THEN** assess SHALL use the existing non-PASS path and MUST NOT recommend downstream completion

### Requirement: Assessment freshness includes capability-resolution provenance
Assess SHALL treat capability-resolution contract and source-attempt fingerprints as
part of summary/evidence freshness. A stale manifest caused by a changed selected or
prior attempted source SHALL prevent downstream qualification.

#### Scenario: Fallback-preferred artifact appears after closure
- **WHEN** a previously absent higher-priority source becomes present after a derive fallback closure
- **THEN** assess SHALL observe stale evidence and refuse downstream qualification