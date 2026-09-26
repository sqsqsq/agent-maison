## MODIFIED Requirements

### Requirement: Closure input set is component-bounded and reuses P2 completion truth

P3's stable kernel MUST load one valid current P1 blueprint, consume its validated current-scope requirement traceability, and enumerate only canonical `<change_unit_id>/change-unit.yaml` subdirectories inside the same `<features_dir>/<blueprint_id>/` workspace. Input membership MUST NOT be delegated to a replaceable Provider. A CU without that blueprint ownership, a standalone Feature without `change_unit_ref`, a CU of another `blueprint_id` workspace (including an earlier evolution of the same `component_id`), a foreign component CU or an arbitrary Feature discovered by repository scan MUST NOT enter closure; CU/Feature observations and evidence are resolved only through the single Feature path SSOT under that workspace. The closure CLI `check-component-closure` and Skill command MUST address the workspace by `--blueprint <blueprint_id>`; `component_id` is verification output only.

Every CU enters the input set on one path. A CU whose owner `component_blueprint_ref` identity equals the current blueprint MUST resolve through the exact `resolveChangeUnitRef`, pass the existing P2 artifact, design and Feature construction projection gates, and requires `observeChangeUnitCompletion()=VALID` (projected from the single completion entry `assessFeature`). A CU still bound to an older blueprint identity has not been re-pointed in place: it MUST enter with `carry_forward: false`, contributes no provides or coverage, and its reasons MUST name the only re-point exit (the `/component-design` design hand-off readiness, `reconcileChangeUnitBlueprintRefs`) plus any existing P2 carry-forward failure explaining why it cannot be re-pointed; its Feature construction projection is not evaluated against the old blueprint. There is no second historical-CU path (no provenance-exempt validation, no separate Feature binding check). `ABSENT`, `INCOMPLETE` (with its uncovered obligations) and `INVALID` MUST remain distinct failing reasons. P3 MUST NOT write completion, ready, carry-forward or blueprint pointer state.

An exact valid `supersedes` ref MAY retire the referenced CU from current obligations while preserving it as history. Conflicting superseders, hash mismatch or a supersedes cycle MUST fail closed; `revises` alone MUST NOT retire a CU. No semantic diff or migration registry may infer retirement.

#### Scenario: Standalone Feature is excluded

- **WHEN** an existing independent Feature has a valid completion but no canonical CU/blueprint binding
- **THEN** it remains valid on its existing path but contributes no Component closure coverage

#### Scenario: A CU not re-pointed yet does not contribute

- **WHEN** the blueprint moved to a new admitted revision, every stable target of a completed CU still resolves, but the CU still binds the older blueprint identity
- **THEN** the CU enters with `carry_forward: false` and the re-point guidance, closure fails with a `reconcile_blueprint` route and no `component_closure_change_unit_invalid`; once the design hand-off re-points it in place it resolves exactly and contributes through its completion

#### Scenario: A removed target blocks the re-point

- **WHEN** a completed CU references an older blueprint identity and one stable target no longer resolves or is now open/blocking
- **THEN** it is not re-pointed; its provides and coverage MUST NOT carry forward, its reasons include the unresolvable target, and closure fails with a P1 reconciliation route while preserving the historical completion

#### Scenario: Another workspace never feeds closure

- **WHEN** `<features_dir>/ledger-evolution-2/` holds a VALID CU whose provides would satisfy an obligation of blueprint `ledger-evolution`, and both workspaces share `component_id=ledger-app`
- **THEN** closure of `ledger-evolution` MUST NOT enumerate, observe or credit that CU or its evidence; the obligation stays uncovered and the row fails with its own workspace located

#### Scenario: Two closures of the same component coexist

- **WHEN** `ledger-evolution` and `ledger-evolution-2` each materialize a closure
- **THEN** each closure lives at its own `<features_dir>/<blueprint_id>/blueprint/component-closure.yaml`; writing or recomputing one MUST NOT modify any byte of the other workspace's blueprint, CUs or closure

#### Scenario: Retired closure root path is never consulted

- **WHEN** only `blueprint/component/<component_id>/component-closure.yaml` exists and the workspace has no closure
- **THEN** the checker MUST treat the closure as absent and recompute from current inputs; it MUST NOT read, migrate or dual-write the retired path

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-inputs.ts`, `harness/scripts/utils/change-unit-completion.ts`, `harness/scripts/utils/feature-assessment.ts`, `harness/scripts/utils/change-unit-reconciliation.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`
