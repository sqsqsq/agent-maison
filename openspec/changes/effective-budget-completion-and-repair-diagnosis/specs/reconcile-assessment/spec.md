## MODIFIED Requirements

### Requirement: Reconciled state does not bypass feature validation
When no gaps remain and the feature completion assessment is not yet complete, assess SHALL return `run_status_candidate=CHAIN_SLICE_COMPLETED` and `feature_completion=REQUIRES_VALIDATION`. It MUST NOT emit naked `COMPLETED` or replace `verify-feature-completion`.

When the existing feature completion assessment is complete (completion record verdict VALID, no blocking run, every obligation covered), assess SHALL output the completed projection instead of requesting validation: `recommendation.action=feature_completed`, `recommendation.phase=null`, `recommendation.requires_driver_authorization=false`, `feature_completion=VALIDATED`, `run_status_candidate=CHAIN_SLICE_COMPLETED` and `gaps=[]`; `observed` SHALL be kept as observation. `requires_driver_authorization` SHALL be a boolean in the type and `assess.schema.json` (existing recommendations still write `true`), the renderer SHALL print `authorization=none` for `false`, the goal assess driver SHALL map `feature_completed` to `advance`, and the transition policy SHALL NOT authorize it. Without a run id, when the completion record (valid or broken) names a run, assess SHALL observe the feature through that run's effective execution scope rather than the whole workflow chain. A present but invalid record SHALL still recommend `validate_feature_completion`; a missing record SHALL keep the existing observation. Stale evidence SHALL keep routing back to the responsible phase.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/schemas/assess.schema.json`, `harness/scripts/utils/assess-renderer.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/utils/phase-transition-policy.ts`

#### Scenario: Goal slice has no remaining gaps
- **WHEN** every required phase satisfies verdict, closure, provenance, and depth and no valid completion record exists yet
- **THEN** assess SHALL emit a chain-slice completion candidate and require feature validation

#### Scenario: A validated completion is not asked to validate again
- **WHEN** the runtime has written and verified the feature completion record for a run whose execution scope is coding→testing, and assess runs without a run id
- **THEN** next.json SHALL carry `feature_completed`, `requires_driver_authorization=false`, `VALIDATED`, `CHAIN_SLICE_COMPLETED` and empty gaps, the observed chain SHALL be coding→testing, the rendering SHALL show `authorization=none`, and the driver SHALL map it to `advance`, not `halt`

#### Scenario: Broken or stale completion still routes to work
- **WHEN** the completion record fails verification, or product sources changed after completion
- **THEN** assess SHALL recommend `validate_feature_completion` with `REQUIRES_VALIDATION`, or `run_phase:<owner_phase>` respectively, and SHALL NOT claim completion
