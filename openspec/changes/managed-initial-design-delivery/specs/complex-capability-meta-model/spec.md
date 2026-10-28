## MODIFIED Requirements

### Requirement: Fresh delivery uses the existing design handoff

For a profile with `profileHasDesignLens`, a new formal complete delivery containing spec/plan duties without a canonical CU or valid prior task/frozen scope SHALL enter the existing `GoalPhaseRuntime` from its original requirement. Fresh prepare-run and launcher entries SHALL create or resume a managed initial-design run rather than return same-session steps as successful completion. Its immutable `initial_design` input SHALL preserve the existing request endpoint/results/actions/impact shape; original requirement, sources, adapter, model/visual pins, timeouts and budget SHALL remain in their existing fields. The blueprint workspace path key MUST NOT imply an admitted blueprint or construction Feature; the initial variant MUST NOT invent construction scope, baseline, phase chain, phase PASS or Feature completion.

The runtime SHALL invoke the existing P1 author, independent questioning, checks/admission and CU consumer/readiness, then use the existing P2 ready-set/selector. Author exit/report passed, parseability, design ready or a CU completion while other applicable CUs remain unfinished MUST NOT establish original delivery completion. The original request SHALL end when all applicable CUs have valid formal completion. Component closure SHALL then be checked once read-only under its existing semantics and disclosed without automatic repair, write, closure or verdict changes; original-request completion MUST NOT imply component closure PASS. Repairable issues within the authorized design duty SHALL return to their real owner with current schema, diagnostics, original input paths and exact commands; missing required independent questioning SHALL dispatch the real independent context/provider. Admission SHALL derive from current real checks, never author self-approval. Design-only requests MUST retain their own endpoint and MUST NOT start construction.

`check:change-unit --accept-candidates <file> --json` SHALL retain existing `ChangeUnitCandidate[]`, atomic acceptance and identity derivation; existing/already accepted CUs SHALL use `--readiness`, including pointer reconciliation and document materialization. The operations SHALL remain mutually exclusive and reject `--unit`; default checking SHALL retain compatibility. Accepted identities SHALL remain visible after readiness busy/failure, with the retry operation; document failures SHALL remain separate and SHALL NOT change accepted/readiness/bumped. The consumer command itself SHALL NOT select/launch a CU. Generic profiles, single-duty endpoints, ordinary maintenance, valid prior tasks and plan-specific supplements SHALL retain existing paths. This requirement supersedes the former main-Agent-before-birth initial-design policy.

Enforcement: `harness/scripts/utils/design-delivery-entry.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`.

#### Scenario: Raw requirement is managed before a CU exists

- **WHEN** an authorized design-lens complete delivery starts with only an original requirement and empty Feature directory
- **THEN** attended and detached entries SHALL enter managed initial design, continue real author/questioning/checks and accept/readiness before construction
- **AND** an author exiting normally with missing contracts or questioning SHALL trigger the existing repair/independent owner path rather than finish the request

#### Scenario: Already accepted candidates are not accepted again

- **WHEN** candidate acceptance succeeded but subsequent readiness is busy or fails
- **THEN** accepted identities SHALL remain available and continuation SHALL retry readiness without repeating acceptance

#### Scenario: A limited endpoint retains its responsibility

- **WHEN** the request is design-only, maintenance, single-duty or uses a profile without the required design lens
- **THEN** entry SHALL preserve the authorized endpoint and actual capability boundary rather than force App design or construction
