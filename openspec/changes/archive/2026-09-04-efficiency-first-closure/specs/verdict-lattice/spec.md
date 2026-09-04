# verdict-lattice Spec Delta

## MODIFIED Requirements

### Requirement: Dual projections keep phase advance and release readiness distinct

The top-level phase verdict SHALL be produced only by the active phase matrix and `projectPhaseAdvanceVerdict`; `QualityAxis` MUST NOT gain a persisted `required_for_phase_advance` field. Visual gaps, unsupported gaps and non-reverified verification SHALL NOT block phase advance or normal completion; release readiness SHALL keep its own matrix, and a geometry PASS from measurement SHALL NOT lift a release visual block by itself.

Enforcement: `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: Geometry PASS leaves release as it was

- **WHEN** measurement reports geometry PASS while content and style are UNKNOWN
- **THEN** phase advance proceeds and release readiness remains governed by its existing evidence policy
