## ADDED Requirements

### Requirement: One pure scope resolver derives obligations and stable order

The framework SHALL resolve normalized request results, sourced facts, valid P1 content and registered workflow providers through resolveExecutionScope. It SHALL distinguish required/not_applicable/unknown, information reuse and real control predecessors. Acceptance layers SHALL use the existing layering check; device availability, test FAIL, manual or timeout SHALL NOT subtract obligations. Explicit request endpoints SHALL not become full Feature completion.

The candidate-declared applicability of evidence duties (`unit-evidence`, `device-evidence`, `visual-evidence`) SHALL NOT be trusted: the resolver SHALL recompute each one from its real source and overwrite whatever the candidate declared, and a self-reported value SHALL NOT by itself be a reason to reject the candidate. Unit and device duties SHALL derive from the existing acceptance layering; the visual duty SHALL derive from the fidelity SSOT alone, and a `pixel_1to1` decision without the visual acceptance artifact SHALL produce a spec-owned definition gap rather than an undefined duty. When no resolved source is supplied the duty SHALL derive to `unknown`, never to `not_applicable`.

Device verification MAY be pruned at a Feature endpoint only when a sourced impact judgement states no user-visible behaviour change. A request that supplies NO judgement SHALL leave the device duty `unknown` and SHALL NOT prune testing. A request that supplies a judgement SHALL supply a valid one — an explicit boolean, a reason and at least one basis, each basis verified (inside the project, real and digest-verifiable, content consistent with the binding) and intersecting this request's real targets — and an invalid one SHALL be rejected rather than silently treated as "no judgement": absence is a gap, a malformed or unsourced claim is an error. An acceptance layer that genuinely requires device verification SHALL stay `required` regardless of the judgement.

`satisfied_by` SHALL be re-resolved when the scope is frozen, not only when completion is verified: a binding that no longer re-resolves SHALL reject the freeze.

Enforcement: `harness/scripts/utils/execution-scope.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/acceptance-layering.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/runtime-policy.ts`.

#### Scenario: Host-only verification completes at UT
- **WHEN** valid scoped acceptance requires unit evidence and no device evidence
- **THEN** testing SHALL be absent from the execution chain, without placeholder reports

#### Scenario: Unknown downstream evidence preserves safe investigation
- **WHEN** spec investigation is required but later device responsibility is unknown
- **THEN** spec SHALL remain executable and unknown-dependent work/completion SHALL remain unresolved

#### Scenario: A self-reported evidence duty is recomputed from its source
- **WHEN** a candidate declares `device-evidence: not_applicable` while the acceptance layering requires device verification, or declares `visual-evidence: not_applicable` while the fidelity SSOT selects `pixel_1to1`
- **THEN** the resolver SHALL recompute both duties as required and SHALL NOT reject the candidate for what it declared; the recomputed duty is retained even when its own definition gap (a `pixel_1to1` decision with no visual acceptance artifact) makes the verifying phase temporarily not executable — a duty being retained and a phase being executable now are separate questions

#### Scenario: Missing impact evidence never prunes testing
- **WHEN** a Feature-target request carries no impact judgement at all
- **THEN** the device duty SHALL stay `unknown` and remain unresolved, and testing SHALL NOT be pruned from the scope

#### Scenario: An unsourced impact claim is rejected, not downgraded
- **WHEN** a request supplies an impact judgement with no basis, no boolean verdict, or a basis that is unverifiable or unrelated to this request's targets
- **THEN** the freeze SHALL be rejected with the offending source named, and the judgement SHALL NOT be read as "no user-visible change"

#### Scenario: Existing control predecessor is not an information substitute
- **WHEN** a required control predecessor is neither scheduled nor backed by valid execution evidence
- **THEN** range validation SHALL reject the dependent operation
