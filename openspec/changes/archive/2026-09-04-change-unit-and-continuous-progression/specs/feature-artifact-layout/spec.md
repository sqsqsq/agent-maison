## ADDED Requirements

### Requirement: CU-bound Feature contracts use ID-only construction mappings

For a Feature deterministically derived from a Change Unit, `contracts.yaml` SHALL bind the exact `change_unit_ref` and map canonical CU identifiers to construction evidence without copying or redefining CU content. `predicate_mappings[]`, `provide_mappings[]`, and `design_ref_mappings[]` MUST reference IDs/refs present in the bound canonical CU and map them to real implementation, symbol, test, or verification refs. Every required CU identifier MUST be mapped, and unknown identifiers or copied predicate/provide definitions MUST fail the Feature construction mapping gate.

The existing `contracts.state_management` section SHALL remain the sole Feature-construction authority for runtime facts. CU artifacts SHALL contain only stable blueprint runtime/design refs; no `runtime_flow_slices` or second runtime-detail section may duplicate trigger, owner, mutation, publication, subscription, consumer, freshness, or recovery facts. Features without `change_unit_ref` SHALL retain their existing artifact behavior.

#### Scenario: Canonical CU definitions are mapped, not copied

- **WHEN** a CU-bound Feature maps each canonical predicate/provide/design ref to actual files, symbols, and tests
- **THEN** the construction mapping gate passes without requiring copied CU descriptions in `contracts.yaml`

#### Scenario: Runtime facts remain in state management

- **WHEN** a CU references a P1 runtime flow and the Feature plans its implementation
- **THEN** concrete runtime facts are authored once in `contracts.state_management` and linked to the stable design ref; a parallel `runtime_flow_slices` definition is rejected

#### Scenario: Standalone Feature remains compatible

- **WHEN** an existing Feature has no `change_unit_ref`
- **THEN** its current contracts loading and validation behavior remains unchanged

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-review.ts`

## MODIFIED Requirements

### Requirement: Phase-scoped feature artifacts use canonical nested paths

The framework SHALL resolve phase-scoped feature artifacts under
`<features_dir>/<feature_path>/<phase>/<basename>` as the canonical write path, where
`<features_dir>` is `paths.features_dir` (default `doc/features`, the single root SSOT),
`<phase>` is determined by `PHASE_SCOPED_ARTIFACTS` in `harness/config.ts`, and
`<feature_path>` is the **physical relative path** derived from the logical feature identity
by one neutral pure function (the Feature path SSOT):

- legacy flat Feature: `<feature_path> = <feature_id>`;
- Change-Unit Feature (identity `cu-` + `base64url(blueprint_id + "\0" + change_unit_id)`):
  `<feature_path> = <blueprint_id>/<change_unit_id>`, i.e. the evolution workspace subdirectory
  that also holds the CU canonical `change-unit.yaml`;
- an identity that starts with `cu-` but whose payload is not a canonical base64url
  `(blueprint_id, change_unit_id)` pair SHALL fail closed; it MUST NOT fall back to a flat directory.

Global cross-phase contracts (`acceptance.yaml`, `contracts.yaml`,
`use-cases.yaml`, `boundaries.yaml`, `compat.yaml`) SHALL remain at the feature
root directory, which for a CU Feature is `<features_dir>/<blueprint_id>/<change_unit_id>/`.

Every Feature path construction in the framework SHALL consume the same Feature path SSOT:
artifact read/write, `receipt_dir_pattern`/`reports_dir_pattern` and any other template that
contains `<feature>`, Goal Mode run/event/manifest/lock/resume paths, context and fidelity
artifacts, SpecLoader/catalog/receipt reconciliation enumeration, the P1/P2/P3
blueprint/change-unit/closure resolvers, CLIs and Skills, **and every independent production
entry shipped in the release**: the plain-Node hooks distributed to host agents
(`check-phase-completion.mjs`, `record-verifier-report.mjs` and any hook that resolves a receipt
or report location), agent-facing boundary/prompt text that declares writable Feature paths
(e.g. the testing write boundary), compat message templates (`{feature}`), check-spec asset
fallback paths, and framework smoke/lifecycle scripts. The SSOT SHALL be one dependency-free
module that the TypeScript harness and plain-Node hooks import alike; hooks MUST NOT carry a
second copy of the identity decoder. The `<feature>` / `{feature}` placeholder SHALL be
substituted with `<feature_path>`, never with the encoded logical identity; production code
MUST NOT concatenate `<features_dir>` with a feature identity outside the SSOT. The existing
pattern contract is unchanged otherwise: a configured `receipt_dir_pattern`/`reports_dir_pattern`
resolves relative to the project root, only its placeholders are substituted, and every other
prefix and directory level of the pattern is preserved — a CU Feature therefore changes what
`<feature>` expands to (`<blueprint_id>/<change_unit_id>`), not where a custom pattern points.

In framework documentation, skill instructions and agent templates, the placeholder
`<features_dir>/<feature>/…` SHALL denote the **physical Feature path** (`<feature_path>`):
for a CU Feature it reads `<features_dir>/<blueprint_id>/<change_unit_id>/…`. Phase skills'
"Feature 归档定位协议" SHALL instruct the agent to resolve that physical path through the
framework (SSOT/CLI output) rather than to concatenate the logical identity by hand; this
semantic is stated once in the shared reference glossary and referenced by the per-phase skills,
not re-explained per file.

Directory discovery under `<features_dir>` SHALL return only executable Features
(`legacy | cu`), never workspace containers: a first-level directory that contains
`blueprint/component-blueprint.yaml` is an evolution workspace whose subdirectories containing
`change-unit.yaml` are CU Features (identity rebuilt from `(workspace dir, subdir)` and required to
round-trip with the SSOT), its `blueprint/` subdirectory is skipped, a subdirectory holding
phase-scoped artifacts without `change-unit.yaml` is an orphan and SHALL fail closed, and
auxiliary directories with no known Feature marker are ignored; a first-level directory that
has a `blueprint/` subdirectory without `component-blueprint.yaml`, or that mixes flat Feature
artifacts with `blueprint/component-blueprint.yaml`, SHALL fail closed rather than be treated as a
legacy Feature. Any other first-level directory keeps the existing legacy flat behavior.
Feature artifact detection SHALL reuse `PHASE_SCOPED_ARTIFACTS` and the existing artifact
layout; no second hand-written artifact list is permitted.

#### Scenario: Spec written under spec subdirectory
- **WHEN** an agent writes `spec.md` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/spec/spec.md`

#### Scenario: Plan written under plan subdirectory
- **WHEN** an agent writes `plan.md` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/plan/plan.md`

#### Scenario: Global contract stays at feature root
- **WHEN** harness loads `contracts.yaml` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/contracts.yaml`

#### Scenario: CU Feature artifacts live inside the evolution workspace
- **WHEN** an agent writes `spec.md` for the Feature derived from `blueprint_id=ledger-evolution`,
  `change_unit_id=cu-ledger-write`
- **THEN** the canonical path SHALL be `<features_dir>/ledger-evolution/cu-ledger-write/spec/spec.md`,
  and `contracts.yaml` SHALL be `<features_dir>/ledger-evolution/cu-ledger-write/contracts.yaml`

#### Scenario: Default receipt and report templates substitute the physical path
- **WHEN** `receipt_dir_pattern` is the default `doc/features/<feature>/<phase>` and the feature is a CU Feature
- **THEN** the receipt directory SHALL resolve to `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>`,
  not to `<features_dir>/cu-<base64url>/<phase>`

#### Scenario: Custom pattern keeps its own structure and only expands the placeholder
- **WHEN** `receipt_dir_pattern` is the custom `requirements/features/<feature>/phases/<phase>` and the
  feature is a CU Feature
- **THEN** the receipt directory SHALL resolve to
  `requirements/features/<blueprint_id>/<change_unit_id>/phases/<phase>` relative to the project root;
  the custom prefix and levels SHALL be preserved, the pattern SHALL NOT be relocated under
  `<features_dir>`, and the encoded identity SHALL NOT appear as a segment

#### Scenario: No shadow directory after a Goal Mode run
- **WHEN** a CU Feature completes a Goal Mode run that writes events, manifest, lock, receipts and reports
- **THEN** no resolved path SHALL contain the encoded `<encoded-featureId>` as a segment and
  `<features_dir>/<encoded-featureId>` SHALL NOT exist. Artifacts whose location is fixed relative to the
  Feature root — Goal Mode events, manifest and lock under `goal-runs/`, and `context/facts.md` — SHALL
  always be located under `<features_dir>/<blueprint_id>/<change_unit_id>/` regardless of any pattern;
  receipts, reports, phase-scoped artifacts and any other artifact resolved through
  `receipt_dir_pattern`/`reports_dir_pattern` follow the pattern: under
  `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>/…` with the default patterns, or under the custom
  pattern's own structure with `<feature>` expanded to `<blueprint_id>/<change_unit_id>`

#### Scenario: Shipped hooks resolve the CU physical directory
- **WHEN** the distributed `check-phase-completion.mjs` and `record-verifier-report.mjs` hooks run for a
  CU Feature
- **THEN** with the default patterns the receipt they check and the verifier report they write SHALL
  resolve to `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>/…`; with a custom pattern they SHALL
  resolve to that pattern with only `<feature>` expanded to `<blueprint_id>/<change_unit_id>` (e.g.
  `requirements/features/<blueprint_id>/<change_unit_id>/phases/<phase>/…`); in both cases they SHALL go
  through the same Feature path SSOT, SHALL NOT read or write a path containing the encoded identity, and
  SHALL NOT embed a private decoder

#### Scenario: Agent-facing boundary text names the physical path
- **WHEN** the testing write boundary (or any prompt/compat message) declares writable or forbidden
  Feature paths for a CU Feature
- **THEN** the declared paths SHALL be `<features_dir>/<blueprint_id>/<change_unit_id>/…`, identical to what
  the machine snapshot check enforces; the declared set and the checked set MUST NOT diverge

#### Scenario: Custom features_dir is honored end to end
- **WHEN** `paths.features_dir` is configured to a non-default directory
- **THEN** legacy Features, evolution workspaces, CU Features, receipts and reports SHALL all resolve
  under that directory; no path construction SHALL hardcode `doc/features`

#### Scenario: Workspace container is not a Feature
- **WHEN** `<features_dir>/ledger-evolution/` contains `blueprint/component-blueprint.yaml` and the
  subdirectory `cu-ledger-write/change-unit.yaml`
- **THEN** enumeration SHALL yield only the CU Feature `cu-ledger-write` (kind `cu`) and SHALL NOT yield
  `ledger-evolution` itself

#### Scenario: Invalid cu- identity fails closed
- **WHEN** a Feature identity starts with `cu-` but its payload does not decode to a canonical
  `(blueprint_id, change_unit_id)` pair
- **THEN** path resolution SHALL fail with a located error and SHALL NOT create or read
  `<features_dir>/<identity>`

#### Scenario: Ambiguous or incomplete workspace fails closed
- **WHEN** a first-level directory mixes flat `spec/spec.md` with `blueprint/component-blueprint.yaml`, or
  has `blueprint/` without `component-blueprint.yaml`
- **THEN** enumeration and loading SHALL fail closed with the directory located, not silently pick one
  interpretation
