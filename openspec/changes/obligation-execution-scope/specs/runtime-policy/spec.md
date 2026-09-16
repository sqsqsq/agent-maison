## ADDED Requirements

### Requirement: One pure scope resolver derives obligations and stable order

The framework SHALL resolve normalized request results, sourced facts, valid P1 content and registered workflow providers through resolveExecutionScope. It SHALL distinguish required/not_applicable/unknown, information reuse and real control predecessors. Acceptance layers SHALL use the existing layering check; device availability, test FAIL, manual or timeout SHALL NOT subtract obligations. Explicit request endpoints SHALL not become full Feature completion.

The candidate-declared applicability of evidence duties (`unit-evidence`, `device-evidence`, `visual-evidence`) SHALL NOT be trusted: the resolver SHALL recompute each one from its real source and overwrite whatever the candidate declared, and a self-reported value SHALL NOT by itself be a reason to reject the candidate. Unit and device duties SHALL derive from the existing acceptance layering; the visual duty SHALL derive from the fidelity SSOT alone, and a `pixel_1to1` decision without the visual acceptance artifact SHALL produce a spec-owned definition gap rather than an undefined duty. When no resolved source is supplied the duty SHALL derive to `unknown`, never to `not_applicable`. The same distrust SHALL extend to the definition duties a candidate declares (`design-context`, `acceptance-context`): each SHALL be recomputed from whether its artifact resolves and, for a request that carries an implementation phase, whether a verifiable write set exists at all — by the same derivation the candidate entry uses — so that a hand-written definition gap cannot suppress a fail-closed rule that reads it. Recomputation SHALL be confined to those declared duties and SHALL NOT be a whole-candidate comparison, which would reject the legitimate human inputs the candidate is allowed to carry. It SHALL run on every proposal that can reach the resolver — the birth candidate and each revision proposal alike, each on its own copy and never on the frozen scope. On a revision proposal it SHALL only tighten a declared gap back into a live duty and SHALL NOT downgrade a duty, because the revision is resolved in a richer phase context than the recomputation's own probe and a probe that cannot resolve a source there would otherwise invent a gap and read as a silently removed duty. It SHALL recompute the conclusion and its source only: a duty whose source is unavailable SHALL also lose any satisfaction proof it carried, while a duty whose source is available keeps whatever proof it already had, because an artifact being present is not the same as the responsibility being discharged.

Device verification MAY be pruned at a Feature endpoint only when a sourced impact judgement states no user-visible behaviour change. A request that supplies NO judgement SHALL leave the device duty `unknown` and SHALL NOT prune testing. A request that supplies a judgement SHALL supply a valid one — an explicit boolean, a reason and at least one basis, each basis verified (inside the project, real and digest-verifiable, content consistent with the binding) and intersecting this request's real targets — and an invalid one SHALL be rejected rather than silently treated as "no judgement": absence is a gap, a malformed or unsourced claim is an error. An acceptance layer that genuinely requires device verification SHALL stay `required` regardless of the judgement. An empty target set SHALL never be read as "the basis is unrelated", and a pending definition gap SHALL be settled before target relevance is judged: while the scope still carries an unfilled definition duty the write set is not yet decided, so the judgement SHALL fall back to the same path as a missing one (device `unknown`, testing not pruned) instead of rejecting the scope declaration. Rejecting the declaration for a missing write set is reserved for a request that carries an implementation duty with no definition gap left to fill.

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

#### Scenario: A hand-written definition gap is recomputed, not believed
- **WHEN** a candidate declares a definition duty as `unknown` while its artifact resolves and is valid
- **THEN** the freeze SHALL recompute that duty as satisfied, and any fail-closed rule that reads the presence of a definition gap SHALL fire as if the hand-written gap were absent

#### Scenario: A pending definition gap outranks the impact target check
- **WHEN** a Feature-target request carries a complete impact judgement, asks for both the design phase and the implementation phase, and the design artifact declares no write set
- **THEN** the freeze SHALL succeed with the device duty `unknown` and testing kept, the implementation phase SHALL stay out of the birth chain and appear in the gap's `needed_by`, and the scope SHALL NOT be rejected for a missing write set

#### Scenario: An unsourced impact claim is rejected, not downgraded
- **WHEN** a request supplies an impact judgement with no basis, no boolean verdict, or a basis that is unverifiable or unrelated to this request's targets
- **THEN** the freeze SHALL be rejected with the offending source named, and the judgement SHALL NOT be read as "no user-visible change"

#### Scenario: Existing control predecessor is not an information substitute
- **WHEN** a required control predecessor is neither scheduled nor backed by valid execution evidence
- **THEN** range validation SHALL reject the dependent operation
