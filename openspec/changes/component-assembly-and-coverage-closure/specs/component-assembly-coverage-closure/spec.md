## ADDED Requirements

### Requirement: Component closure projection has deterministic identity and input binding

The framework SHALL materialize the current Component closure at `blueprint/component/<component_id>/component-closure.yaml` as `component-closure@1`. The root MUST bind the same `component_id` in path/content, one complete `component_blueprint_ref` targeting the blueprint, a deterministically derived `input_fingerprint`, sorted requirement-source/CU/Feature observations, coverage rows, provider observations, knowledge writeback refs, degradations, gaps and a derived verdict. The artifact MUST NOT contain an authored self-hash, P2 ready state, Goal Mode completion state or P3 history ledger.

The loader SHALL compute the closure artifact SHA-256 from raw bytes. The checker MUST rebuild the ordered input manifest from P1 current-scope requirement traceability and its source revision/hash plus the exact blueprint/CU/Feature/completion/evidence identities, then reject any path/content/ref mismatch, stale fingerprint, omitted input, changed requirement source or authored verdict disagreement. The existing CLI MUST support a first-generation `--write` path that evaluates current inputs, atomically writes canonical YAML, computes its raw hash, generates Markdown from that exact YAML/hash, and revalidates through the production checker. No arbitrary path, Feature-directory, legacy or registry fallback is allowed.

#### Scenario: Authored PASS cannot override stale inputs

- **WHEN** a closure YAML says `PASS` but the blueprint revision, a CU raw hash or bound completion evidence changed after `input_fingerprint` was produced
- **THEN** the checker MUST reject the projection as stale and recompute from current authoritative inputs; the authored verdict cannot pass

#### Scenario: Another component cannot be rebound into the path

- **WHEN** the path names component A while YAML or blueprint ref names component B
- **THEN** path/content/ref identity validation MUST fail without scanning another component or adopting the artifact

> **Enforced by (P3 implementation):** `harness/schemas/component-closure.schema.json`, `harness/scripts/utils/component-closure-path.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Closure input set is component-bounded and reuses P2 completion truth

P3's stable kernel MUST load one valid current P1 blueprint, consume its validated current-scope requirement traceability, and enumerate only canonical `change-units/*.yaml` under the same component. Input membership MUST NOT be delegated to a replaceable Provider. A CU without that blueprint ownership, a standalone Feature without `change_unit_ref`, a foreign component CU or an arbitrary Feature discovered by repository scan MUST NOT enter closure.

Every current CU MUST pass the existing P2 artifact, design and Feature construction projection gates. A CU bound to the current blueprint requires `observeChangeUnitCompletion()=VALID`; a completed historical CU MAY contribute only when the existing P2 carry-forward verdict allows every historical stable target under the current blueprint. `ABSENT`, `STALE` and `INVALID` MUST remain distinct failing reasons. P3 MUST NOT write completion, ready or carry-forward state.

An exact valid `supersedes` ref MAY retire the referenced CU from current obligations while preserving it as history. Conflicting superseders, hash mismatch or a supersedes cycle MUST fail closed; `revises` alone MUST NOT retire a CU. No semantic diff or migration registry may infer retirement.

#### Scenario: Standalone Feature is excluded

- **WHEN** an existing independent Feature has a valid completion but no canonical CU/blueprint binding
- **THEN** it remains valid on its existing path but contributes no Component closure coverage

#### Scenario: Historical completion needs carry-forward

- **WHEN** a completed CU references an older blueprint identity and one historical stable target no longer resolves or is now open/blocking
- **THEN** its provides and coverage MUST NOT carry forward; closure fails with a P1 reconciliation route while preserving the historical completion

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-inputs.ts`, `harness/scripts/utils/change-unit-completion.ts`, `harness/scripts/utils/change-unit-reconciliation.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`

### Requirement: Current-scope source traceability closes before assembly

P1's existing `discovery.inputs.current_scope_items` SHALL contain the closed set of current `requirement|goal|invariant|high_risk` inputs recognized by discovery/authorized manual input. Each item MUST have a stable `item_id`, kind, a project-safe and resolvable exact `source_ref`, and, for a project-local file, the actual raw-byte content hash; a source revision MAY be additional identity but MUST NOT replace that hash. `discovery.requirement_traceability` MUST form a bidirectional one-to-one cover of those item IDs and map each item to one or more real stable addresses in the same canonical blueprint. The P1 `source_fingerprint` MUST include normalized discovery facts and current-scope source/provenance/revision/hash only; traceability mappings MUST NOT enter it. P3 MUST independently resolve the same local source and place its actual raw hash in the existing input manifest so byte changes stale `input_fingerprint` even when an authored revision/hash was not refreshed. Mapping changes MUST instead change the blueprint revision/raw `artifact_sha256` and therefore P3 `input_fingerprint`; no traceability-specific fingerprint is allowed. Duplicate IDs, missing/extra traceability, missing/escaping/unresolvable sources, missing or mismatched hash, an empty mapping, or a mapping to an absent or foreign-component address MUST block P1 admission and therefore P3 closure.

P3 MUST derive one source obligation per traceability record and verify that every mapped blueprint address participates in the downstream obligation/coverage chain. It MUST NOT parse arbitrary PRD prose, discover requirements by directory scan, or invent a source registry. A source record that cannot be mapped uniquely MUST route to P1 discovery/traceability repair; P3 cannot author a replacement mapping.

#### Scenario: Requirement source is missing

- **WHEN** a P1 blueprint lists `requirements/ledger.md` for a current requirement but the project-safe source cannot be resolved
- **THEN** P1 admission and P3 closure MUST block with that source identity rather than treating the requirement set as complete

#### Scenario: Source requirement is omitted from the blueprint

- **WHEN** a current-scope input item is omitted from traceability or has no mapping to any real blueprint stable address
- **THEN** P3 MUST fail the requirement-to-blueprint obligation and route repair to P1 instead of accepting CU and Feature completion

#### Scenario: Mapping-only change stales closure without changing source identity

- **WHEN** a traceability mapping changes while all discovery facts and current-scope source identities remain unchanged
- **THEN** P1 `source_fingerprint` MUST remain stable, but blueprint revision/`artifact_sha256` and P3 `input_fingerprint` MUST change so the old closure cannot pass

> **Enforced by (P1/P3 implementation):** `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/utils/blueprint-provenance.ts`, `harness/scripts/utils/component-closure-inputs.ts`, `harness/scripts/utils/component-closure-obligations.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Coverage obligations are mechanically derived and cannot be authored away

The closure evaluator SHALL deterministically derive an obligation closed set from P1 current-scope source traceability and blueprint objects, current P2 CU contracts, bound Feature artifacts and component-level assembly concerns. The set MUST include each source requirement/goal/invariant/high-risk record and its blueprint mappings, applicable target/delta view nodes, current relations, runtime flows and conditional edges, current decisions/contracts/NFRs/gaps, CU target predicates/invariants/touches/provides/requires/safe-state/verification, Feature acceptance and construction mappings, cross-CU assembly edges, migration/compatibility/temporary-asset disposition, remaining risk and stable-knowledge placement.

Each obligation id MUST derive from its authority artifact identity, kind and stable local address/id. The stable kernel MUST uniquely derive every coverage row's owner or multi-CU combination owner, deterministic Feature identity/mapping, required evidence level, canonical evidence identity and observation from exact upstream traceability, stable blueprint relations/flows, CU design/dependency refs, Feature construction mappings and existing evidence gates. YAML SHALL only materialize those derived rows. The checker MUST recompute and compare every normalized field; rows MUST NOT copy/redefine obligations or provide an author selection point. Missing, extra, duplicate, foreign-component, owner-swapped, evidence-swapped or otherwise non-derivable rows MUST fail. If derivation is ambiguous or incomplete, closure MUST route to P1/P2/Feature repair instead of accepting a manual binding.

A blueprint node that is purely current-state, has no target/delta change and is not changed by any current CU SHALL require authoritative current-fact evidence but MUST NOT force a fake construction CU. A future gap SHALL block only when its `needed_by` or current design closure affects a current CU/closure claim; otherwise it remains a visible non-blocking frontier.

#### Scenario: Target predicate owner is missing

- **WHEN** a canonical CU target predicate or current blueprint target node has no resolvable CU/combination owner row
- **THEN** closure MUST fail and identify the exact predicate or stable blueprint address rather than accepting aggregate completion counts

#### Scenario: Current-only node does not create fake work

- **WHEN** a blueprint node is unchanged current-state context with authoritative provenance and no current CU changes it
- **THEN** fact evidence satisfies its obligation without requiring an invented CU or Feature

#### Scenario: Author swaps the owner

- **WHEN** a materialized row binds a valid obligation to a different valid CU than the one mechanically established by blueprint and CU design refs
- **THEN** full-row recomputation MUST reject the owner even if that CU completed successfully

#### Scenario: Unrelated valid evidence is substituted

- **WHEN** a row cites a valid passing evidence artifact whose canonical identity is not assigned to that obligation by the Feature mapping and evidence gate
- **THEN** full-row recomputation MUST reject the evidence binding and keep the obligation uncovered

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-obligations.ts`, `harness/scripts/utils/component-closure-coverage.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Coverage resolves through existing Feature and evidence gates

For every construction obligation, P3 MUST resolve the owner CU's deterministic Feature identity and canonical `predicate_mappings`, `provide_mappings` or `design_ref_mappings`. Implementation, symbol, test and verification refs MUST pass existing project-relative path and current consumer gates; arbitrary file existence, prose, Markdown checkboxes or provider booleans MUST NOT count as evidence.

Completion MUST be verified by the existing workflow/track-derived `verifyFeatureCompletion()` chain. The stable kernel MUST first derive an obligation-specific evidence identity from the exact authority `file#symbol`, owner Feature and current raw hash; this identity alone MUST NOT count as execution evidence. UT/coverage, contract/API, build/runtime, visual/device and manual Providers MAY report only identities requested for their assigned rows. Before classifying an observation as current, the kernel MUST find a canonical same-Feature/phase `script-report.json` check with `id` equal to the exact symbol, `status=PASS`, and `affected_files` containing the exact project-relative file, then verify that report through a fresh existing phase-evidence-manifest, receipt pointer and VALID completion chain. The existing phase manifest output set SHALL bind `script-report.json`; no new evidence file type is introduced. Freshness alone is not binding: the authority `file#symbol`'s file MUST itself be a tracked input of that fresh manifest, recorded at exactly the bytes the evidence identity carries. To make that reachable, phase closure SHALL record every existing project-relative file named by a PASS check's `affected_files` as a manifest input; non-PASS checks, absent paths and paths outside the project root MUST NOT enter the evidence chain. Without this binding, editing an executed proof source while keeping the same symbol leaves every phase fresh and lets the old report keep endorsing the changed source. Missing execution, a failed check, an unbound report, stale/invalid report chain, arbitrary same-Feature observation, completion hash, screenshot filename or provider boolean MUST NOT cover another identity or obligation. P3 MUST NOT create a generic evidence registry. An unsupported or unresolvable evidence type remains an explicit gap/blocker.

Evidence level MUST match the obligation: unit/contract evidence MAY cover local logic or stable contracts; cross-module/CU behavior requires integration/combination evidence; UI refresh, lifecycle recovery and platform behavior require the UI/device/manual level assigned by blueprint/acceptance. Lower-level PASS MUST NOT waive an explicitly required higher layer.

#### Scenario: Completion exists but mapping is fabricated

- **WHEN** a Feature completion is VALID but a closure row names a symbol/test not present in the bound Feature mapping or current consumer gate
- **THEN** closure MUST fail the construction/evidence binding instead of trusting completion alone

#### Scenario: Required device evidence cannot be replaced by UT

- **WHEN** a current UI lifecycle obligation explicitly requires device evidence but only UT evidence exists
- **THEN** closure MUST remain failed/blocking and identify the missing device observation

#### Scenario: Source symbol exists but no successful execution proves it

- **WHEN** an evidence identity's file, symbol and source hash are current but no matching canonical PASS check exists in a fresh report/receipt/completion chain
- **THEN** the default Provider MUST NOT claim that identity and closure MUST keep the obligation uncovered or invalid

#### Scenario: PASS report names an authority file the fresh manifest never tracked

- **WHEN** a canonical PASS check names the exact symbol and file, the phase manifest is intact and fresh and completion is VALID, but that authority file is not a tracked input of the manifest at the identity's recorded bytes
- **THEN** the observation MUST NOT be classified as current and closure MUST keep the obligation uncovered

#### Scenario: An executed proof source changes after its report

- **WHEN** a project file recorded as a manifest input by a PASS check changes after that phase closed, while every symbol it exports stays the same
- **THEN** the owning phase MUST become stale, its report MUST stop covering the obligation, and closure MUST fail

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-evidence.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Cross-view design must be both coherent and consumed

P3 SHALL re-resolve every current-scope stable blueprint address and verify both P1 coherence and P2/Feature consumption. Applicable target/delta view nodes MUST have a CU or combination owner; each key scenario MUST traverse its logical objects/contracts, runtime interactions and development owner, and when crossing a runtime boundary its deployment node. Runtime relations MUST resolve logical data/contract and development mappings; development modules MUST have design basis; deployment nodes MUST map software/data/platform constraints.

Terminology, contract version, state owner and failure semantics MUST remain consistent across blueprint, CU, Feature contracts and observations. A P1-valid design that no current CU consumes, or a CU/Feature common design that lacks current blueprint authority, MUST fail with a precise design-bypass gap; P3 MUST route repair to P1 reconciliation or CU/Feature mapping rather than editing the blueprint.

#### Scenario: Blueprint design is silently ignored

- **WHEN** all CUs have VALID completion but one current blueprint relation/decision has no CU design ref and no combination owner
- **THEN** Component closure MUST fail and locate the unconsumed stable address

#### Scenario: Deployment is falsely marked irrelevant

- **WHEN** a runtime scenario crosses process/device/external boundaries while deployment is missing or unsupported `not_applicable`
- **THEN** closure MUST fail through the existing applicability/cross-view evidence rather than accepting the CU green lights

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-cross-view.ts`, `harness/scripts/utils/component-blueprint-path.ts`, `harness/scripts/utils/change-unit-design-gate.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Runtime data flow closes through implementation, combination and observation

For each current-scope `flow_id`, P3 MUST preserve the P1 conditional model and map every applicable trigger, initial-load, state-owner, mutation, publication, subscription, consumer, recovery and lifecycle stable local ID/edge to current CU design refs, the matching local object/propagation edge in Feature `contracts.state_management`, implementation owner and that object's exact evidence identity. A flow-level mapping or common verification ref MUST NOT substitute for these local observations. Read-only/initial-load flows MUST NOT fabricate mutation, publication or subscription. When present, mutation MUST reach persistence/recovery and publication/invalidation; every publication MUST reach all affected consumers; subscriptions MUST prove snapshot/replay, ordering and cleanup; consumers MUST prove initial load and applicable update source; lifecycle/system/external triggers MUST prove idempotency, failure and recovery.

When a flow's producer, state owner, consumer or recovery spans multiple CU/Features, P3 SHALL derive a combination obligation requiring one end-to-end scenario/use-case/integration/UI/device observation over the assembled path. Separate valid completions MUST NOT substitute for that observation. A consumer that remains stale, bypasses the state owner, or reads/writes a concrete provider outside the approved path MUST fail.

#### Scenario: All CUs pass but UI remains stale

- **WHEN** producer and consumer Features are individually VALID but no assembled observation proves publication/invalidation reaches the affected UI consumer
- **THEN** closure MUST fail the specific `flow_id` producer-to-consumer combination obligation

#### Scenario: Read-only flow stays conditional

- **WHEN** a flow only performs cold-start initial load and read-only consumption
- **THEN** closure validates source, freshness, owner, consumer and recovery without requiring fake mutation/publication/subscription evidence

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-runtime.ts`, `harness/scripts/utils/runtime-data-flow-check.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Dependencies, migration, NFR and temporary assets close at assembly level

Current CU `requires/provides` MUST pass the existing exact P2 dependency rules using only VALID/current or allowed carry-forward providers; unresolved provides, cycles, current blockers or damaged evidence MUST fail closure. New cross-CU call/data/state/publication edges SHALL require real assembly verification beyond a dependency name.

Applicable migration, compatibility, rollback, feature flag, dual-write, controlled fake, temporary adapter/asset, NFR and remaining-risk items MUST derive from current structured blueprint contract/cross-view/decision/gap facts, CU safe intermediate state/blockers and Feature acceptance/evidence. Each item MUST have an authoritative disposition, owner, needed-by/gate and exact verification or knowledge-writeback ref. P3 MUST NOT infer either an obligation or PASS from filename/prose keywords, source-string matches or absence. Remaining risk that affects the closure claim requires explicit authorized acceptance.

#### Scenario: Provide exists but assembly is unverified

- **WHEN** B's exact require is satisfied by A's VALID provide but the newly introduced A→B call/data edge has no integration or combination evidence
- **THEN** dependency resolution passes locally while Component closure still fails the assembly obligation

#### Scenario: Temporary dual-write has no exit

- **WHEN** all Features complete but a current dual-write/compatibility path has no owner, removal/retention decision or verification
- **THEN** closure MUST fail and report the migration/temporary-asset gap

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-assembly.ts`, `harness/scripts/utils/change-unit-dependencies.ts`, `harness/scripts/utils/component-closure-coverage.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Approved host evolution seams have four closure proofs

P1 SHALL restrict each `kind=evolution_candidate` decision's `human_decision` to `establish_seam|keep_direct`. P2 MUST apply first-slice and later-Provider rules, and P3 MUST create host-seam obligations, only when the resolved decision also has `status=decided_with_authority` and `human_decision=establish_seam`. Ordinary decisions and `keep_direct` candidates MUST use ordinary design/CU/dependency closure and MUST NOT be treated as seams; `keep_direct` still requires its P1 re-extraction condition. Every approved seam MUST bind four distinct, resolvable `closure_proofs` identities that are also exact entries in the decision's tests: authoritative contract compatibility; a new/replacement Provider preserves the existing Consumer contract binding; Provider absence/failure matches the blueprint decision (`degrade|disable|block|fail_closed`); and Consumer implementation/dependency refs do not bypass the stable contract to a concrete Provider. One common design mapping, code comments or Provider/Contract string co-occurrence MUST NOT satisfy these proofs.

The first seam CU and later Provider dependencies SHALL reuse P2's vertical-slice and exact same-decision contract provide rules. If replacement requires changing the stable contract or existing Consumer, P3 MUST fail with blueprint reconciliation/contract version/migration routing, not report a successful replacement. No host-provider registry is allowed.

#### Scenario: Unrelated decision does not become a seam

- **WHEN** a provider-only CU references a valid ordinary or `not_applicable` decision
- **THEN** generic dependency checks apply, but no evolution-seam contract/replacement obligations are inferred

#### Scenario: Keep-direct candidate is not blocked by seam construction

- **WHEN** an evidence-backed evolution candidate is authoritatively marked `human_decision=keep_direct` with a re-extraction condition
- **THEN** P2 and P3 MUST apply ordinary design/dependency/coverage rules and MUST NOT demand a contract-provider-consumer vertical seam slice or four seam proofs

#### Scenario: Consumer bypasses the approved seam

- **WHEN** a Consumer directly imports or calls a concrete Provider even though the blueprint approved a stable contract
- **THEN** closure MUST fail and identify the Consumer implementation/dependency ref that bypasses the contract

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-evolution-seam.ts`, `harness/scripts/utils/change-unit-evolution-seam.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Verdict and gaps are deterministic derived outcomes

The stable evaluator SHALL emit only `PASS`, `PASS_WITH_DEGRADATION` or `FAIL`. `PASS` requires every required obligation covered with current valid inputs and no degradation. `PASS_WITH_DEGRADATION` requires every required obligation covered while one or more optional-provider absences have bounded impact, owner and retrigger condition. Any uncovered obligation, current blocker, stale/invalid input, authority conflict, required provider absence or unaccepted risk MUST produce `FAIL`.

Gaps MUST be deterministically sorted and classified as `incomplete|blocked|stale|invalid|conflict`, with obligation/source refs, owner, needed-by, reason, unlock condition and one repair route: `repair_feature_or_evidence`, `repair_or_add_change_unit`, `reconcile_blueprint`, or `resolve_authority_or_risk`. These classifications MUST remain report data, not a mutable state machine. Equal normalized inputs MUST yield equal obligations, gaps and verdict regardless of file enumeration or provider call order.

#### Scenario: Optional provider absence is visible

- **WHEN** no required obligation needs visual evidence but the optional visual provider is unavailable
- **THEN** closure MAY be `PASS_WITH_DEGRADATION` only with bounded impact, owner and retrigger condition; it MUST NOT silently emit `PASS`

#### Scenario: One required gap prevents closure

- **WHEN** every CU is VALID except one required recovery obligation lacks evidence
- **THEN** verdict MUST be `FAIL` with a stable recovery gap and cannot be overridden by aggregate pass counts

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-verdict.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: Team review projection is complete and one-way

Before team review, the framework SHALL generate `component-closure.md` deterministically from a validated current YAML projection. It MUST present blueprint/input identity; CU revision/hash and completion/carry-forward reasons; Feature contracts/acceptance/completion/evidence hashes; every coverage row's source, blueprint refs, Feature mapping and exact evidence identities; Provider authority refs and observation status; cross-view/runtime/assembly/seam results; provider degradations; every gap's source/obligation/needed-by, owner, route and unlock condition; and stable knowledge writeback refs. The Markdown MUST NOT omit failing rows, redefine obligations, or act as an input to verdict calculation.

#### Scenario: Markdown hides a failing row

- **WHEN** a hand-edited Markdown says closed while canonical recomputation has an uncovered runtime obligation
- **THEN** review/checking uses the YAML/input recomputation, regenerates or rejects the projection, and remains `FAIL`

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-review-projection.ts`, `harness/scripts/check-component-closure.ts`

### Requirement: P3 evidence seams preserve authority and lifecycle

P3's canonical input enumeration, input binding, stable obligation/full-row derivation and final verdict MUST NOT be replaceable by a provider. Static providers MAY only return provider-neutral observations over inputs and evidence already selected by the stable kernel. The first-version evidence Seam Cards are:

| Seam Card | Definition | Consumer | Provider | required/optional | Missing behavior | Replacement/exit/conflict behavior | Authority and source rule |
|---|---|---|---|---|---|---|---|
| Automated construction evidence | Verified UT/coverage, contract/API, build/runtime observations keyed by obligation/evidence identity | coverage and assembly evaluator | existing static harness evidence adapters | required when an obligation assigns these layers; otherwise optional | required layer blocks; non-required absence is bounded degradation | replacement preserves observation protocol; exit drops observations and stales closure; hash/verdict conflict fails | exact PASS check in canonical script report plus fresh receipt/evidence manifest and VALID completion are authority; file/symbol/hash alone are not evidence |
| UI/device/visual evidence | Verified observable UI, lifecycle, device or visual result keyed by scenario/flow obligation | runtime and user-visible coverage evaluator | existing static UI/device/visual adapters | required when blueprint/acceptance assigns this layer; otherwise optional | required layer blocks; optional absence is explicit degradation | replacement preserves observation protocol; exit drops observations; two authoritative contradictory observations fail | exact PASS check in the existing device/visual report chain and its fresh receipt/evidence manifest are authority; provider boolean is not |
| Human acceptance and risk | Authorized acceptance/refusal observation for explicit human gate or residual risk | final closure evaluator | existing manual/signature evidence adapter | required only for an explicit human/risk obligation; otherwise optional | required item blocks with owner/unlock condition | replacement must preserve authority identity; exit retains signed evidence but stales transient observation; conflicting authorities fail | existing signed/manual evidence and named authority are source; provider cannot self-sign |

Providers MUST NOT select or omit canonical inputs, bind owners/evidence, claim an unrequested or same-Feature/different-obligation identity, delete obligations, set closure verdict, write canonical blueprint/CU/Feature facts, or modify Goal Mode events/receipt/evidence/completion. Every claimed identity MUST be rechecked against its exact authority ref/hash by the existing verifier before it can cover a row. Provider exit clears transient observations/cache and makes the derived closure stale; formal inputs and accepted evidence remain. No dynamic loader, plugin registry or provider ledger may be added.

#### Scenario: One provider cannot self-approve closure

- **WHEN** a visual or manual provider returns PASS while required contract/runtime obligations are missing
- **THEN** final closure remains `FAIL`; the provider observation only addresses its exact assigned obligations

#### Scenario: Authoritative observations conflict

- **WHEN** two sources claim authority for the same evidence identity with contradictory results
- **THEN** closure MUST fail closed and report both sources rather than applying registration or call order

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-provider-boundary.ts`, `harness/scripts/utils/component-closure-verdict.ts`, `skills/project/component-closure/SKILL.md`

### Requirement: Knowledge placement and P3 boundaries remain explicit

Stable engineering conclusions MUST be proven by exact resolvable `file#conclusion-id` refs to existing architecture, catalog, conventions, long-lived spec/scenarios or ADR truth already listed in the blueprint's knowledge inputs. File existence alone MUST NOT count as placement. Closure MAY record those refs and validation results but MUST NOT copy stable knowledge into a second editable body or automatically rewrite those truth sources. One-off construction detail remains in blueprint/CU/Feature/reports according to existing authority.

P3 MUST NOT create or mutate P2 ready state, Goal Mode recovery/completion, a cross-unit ledger/checkpoint, dynamic plugin runtime or Capability E2E completion. A Component closure PASS proves only the current component and exact bound inputs. Real-host semantic completion still requires the AI ledger's actual multi-CU build/run/recovery and applicable UI/device/manual evidence; framework fixtures alone MUST be reported only as mechanical closure readiness.

#### Scenario: Component PASS is not capability E2E PASS

- **WHEN** the App component closes but an external service component is unknown or incomplete
- **THEN** P3 may expose the component evidence but MUST NOT declare the cross-component capability complete

#### Scenario: Stable knowledge is copied into closure

- **WHEN** a closure projection embeds an editable replacement for an ADR or architecture rule instead of a resolvable writeback ref
- **THEN** validation MUST fail the authority boundary and require the stable conclusion to remain in its existing truth source

> **Enforced by (P3 implementation):** `harness/scripts/utils/component-closure-knowledge.ts`, `harness/scripts/check-component-closure.ts`, `skills/project/component-closure/SKILL.md`, `openspec/specs/complex-capability-meta-model/spec.md`
