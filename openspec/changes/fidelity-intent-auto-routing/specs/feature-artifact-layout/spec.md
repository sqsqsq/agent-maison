# feature-artifact-layout Spec Delta

## ADDED Requirements

### Requirement: fidelity-intent.json is the single SSOT for the three routing axes

`<feature>/spec/reports/fidelity-intent.json` (schema 2.0) SHALL be the sole first-production record of the routing decision: `inferred_fidelity`/`selected_fidelity`/`effective_fidelity`, `acceptance_strictness`, `asset_acquisition_mode`, clamp state, `decision{source, rationale, decision_id}`, `execution_identity` and `requirement_sha256`. `decision_id = hash(execution_identity + requirement_sha + routing_input_digest)` where the digest covers manifest fidelity/receipt validity and the capability snapshot — capability or manifest changes never reuse an id. `decision.source=human_confirmed` is reserved for trusted interactive confirmation or receipts; CLI/manifest inputs cap at explicit_cli/manifest_declared. `<feature>/spec/reports/capability-snapshot.json` SHALL record the probe verdicts/sources and execution identity produced by the same initializer; harness context, prompts, check-spec and reports consume these artifacts instead of re-assembling capability booleans or re-deriving axes. spec.md/ui-spec declarations of `fidelity_target`/`asset_acquisition_mode` are projections of this SSOT, produced after it, never the first decision source. Report/summary tier lines derive from the SSOT; the headless-assumptions ledger is not claimed as an anti-rewrite defense.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`, `harness/harness-runner.ts`

#### Scenario: the first spec working context sees the asset axis before spec.md exists

- **WHEN** the initializer runs for a feature whose requirement says assets come from screenshot cropping
- **THEN** fidelity-intent.json exists with asset_acquisition_mode=auto_crop before any spec.md is generated, and the subsequent harness CheckContext loads assetAcquisitionMode=auto_crop from the same SSOT
