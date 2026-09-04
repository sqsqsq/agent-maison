# correction-routing Spec Delta

## MODIFIED Requirements

### Requirement: Correction classifies to root layer with machine-computed revalidation

A correction SHALL still be classified by `classifyCorrection` into `{root_layer, touched_layers[], revalidate[]}` for routing and for the revalidation hint. Revalidation SHALL be executed by `--revalidate`, which runs only the necessary existing checks against stale inputs; it SHALL NOT re-produce unaffected artifacts, SHALL NOT require receipts and SHALL NOT run the verifier by default. No closing command SHALL be required for a feature correction to end.

Enforcement: `harness/scripts/utils/correction-routing.ts`, `harness/harness-runner.ts`

#### Scenario: A coding correction ends without a ledger

- **WHEN** a correction rooted at coding is implemented and `--revalidate` passes
- **THEN** the correction is finished; no state file and no reconciliation command are involved

### Requirement: Correction state persists for self-check

Only no-feature (`--adhoc-correction`) corrections SHALL persist state, and only the fields the adhoc path consumes (`base_commit`, `session_id`, `created_at`, `expires_at`). Feature corrections SHALL NOT write `.current-correction.json`, and the Stop hook SHALL NOT read it.

Enforcement: `harness/scripts/utils/correction-state.ts`, `harness/harness-runner.ts`

#### Scenario: Feature corrections leave no state behind

- **WHEN** a correction is initiated for an existing feature
- **THEN** no `.current-correction.json` is written and stopping the session is never blocked on its account

### Requirement: Enforcement tier is adapter-honest

`resolveEnforcementTier` SHALL keep describing whether physical Stop interception exists for phase closure. No tier SHALL claim that corrections are intercepted, because correction reconciliation no longer exists.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/README.md`

#### Scenario: hard_hook tier makes no correction claim

- **WHEN** the Claude adapter resolves to `hard_hook`
- **THEN** documentation and reports SHALL describe phase-closure interception only

## REMOVED Requirements

### Requirement: Reconciliation blocks undeclared touched layers
**Reason**: The three-question model cannot express `{coding, ut}` while the reconciliation classifies `ohosTest/**` as `ut`, so any correction touching product and test code was permanently blocked; the interception intercepted nothing real.

**Migration**: Delete `--correction-check`, `correction-layer-reconcile.ts` and the Stop hook correction gate; keep `classifyCorrection` for responsibility routing; use `--revalidate` to re-check stale phases.
