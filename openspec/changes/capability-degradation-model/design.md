## Context

The archived `skill-contracts-assess` change introduced seven feature contracts,
finite `tiers`/`when` selection, contract-local depth, summary 1.2 closure, and
`assess@1`. The current 3.0.0 development baseline now has mature quality axes,
staged closure evidence, profile capability execution, and goal reconciliation.
The tier model remains the wrong abstraction for fallback: it duplicates missing-input
policy in checkers, cannot bind source-choice freshness, and does not make a selected
fallback or its degradations a single consumable fact.

This change stays inside the existing runtime SSOTs: contracts, summary, evidence
manifest, quality axes, phase rules, checkers, and assess. OpenSpec remains a readable
behavior layer. The 3.0.0 window has not been released, so the migration is direct:
there is no depth/assurance compatibility reader or dual persisted field.

## Goals / Non-Goals

**Goals:**

- Replace tier predicates with machine-readable capabilities and deterministic,
  pre-check input source resolution.
- Make one immutable `CapabilityResolutionReport` the source for assurance,
  quality-axis adaptation, script reporting, summary persistence, and assess.
- Bind every input that could have influenced fallback selection into evidence
  freshness, including absent attempts through the terminating source.
- Preserve the existing quality, phase-advance, closure, and release lattice while
  making capability `blocked` states impossible to close as PASS.
- Keep static declaration consistency and runtime report-to-check consumption
  validation deterministic, local, and testable.

**Non-Goals:**

- No generic `when` replacement, source-string DSL, interactive `ask` source, or
  runtime user prompting.
- No reuse or modification of `harness/capability-registry.ts`; it remains the
  profile/toolchain execution registry.
- No change to testing's build→install→run runtime DAG or its holder semantics.
- No new public `PRUNED` CheckResult, quality-axis, or summary verdict value.
- No goal-level release or closure waiver through `minimum_assurance`.

## Decisions

### 1. A capability has explicit applicability before its inputs resolve

A capability declaration contains `id`, `axis`, `inputs`, `tracks`, optional
`applicability_provider_id`, and `on_missing`. A pure named applicability provider and
the declared tracks run before any input source.

- If applicability is false, the capability is `not_applicable` and no referenced
  input source is attempted.
- If applicability is true, input source outcomes may only resolve, be absent, or be
  invalid. An `not_applicable` input outcome is a contract violation and blocks that
  capability.

This gives multi-input capabilities an order-independent result without reintroducing
a conditional DSL. It also keeps non-UI visual work as an explicit, fingerprinted
applicability decision instead of an empty-check heuristic.

Alternative rejected: aggregate input `not_applicable` values after source evaluation.
That makes `invalid` versus N/A depend on traversal order and makes audit evidence
ambiguous.

### 2. Contracts distinguish input and capability outcomes

`InputResolution.state` is `resolved | absent | invalid | not_applicable`.
`CapabilityResolution.state` is `resolved | pruned | blocked | not_applicable`.

For an applicable capability, each source chain proceeds in declaration order:

1. `absent` tries the next source;
2. `resolved` selects the source and stops;
3. `invalid` stops immediately and blocks the capability;
4. a reported `not_applicable` is a contract error and blocks the capability.

After all applicable inputs resolve, absent input(s) become `pruned` for
`on_missing: prune` and `blocked` for `on_missing: fail`. Any invalid input blocks.
`not_applicable` capabilities are excluded from aggregation. Derive sources name their
provider exactly; no “most specific provider” lookup occurs.

### 3. One pre-check report is immutable and persisted

The phase runner performs applicability preflight and produces one
`CapabilityResolutionReport` before phase checkers execute. The report represents
only artifact/derive input availability. Build, install, device run, trace, and other
facts produced inside checkers remain runtime `CheckResult`/holder facts and MUST NOT
mutate the report.

Summary 1.2 persists `capability_resolutions[]` plus
`capability_resolution_contract_fingerprint`. Each report entry records capability
identity, axis, state, input states, attempts, selected source/provider and source
fingerprint, reason code, and optional upstream producer. The report also records a
contract fingerprint and normalized derive-input fingerprints.

Checkers, quality-axis derivation, script reports, summary generation, and assess
receive this same report. They do not independently re-resolve inputs.

### 4. Closure freshness binds all attempts that could affect source selection

For every capability, evidence binds the applicability-provider inputs and all actual
source-attempt dependencies from the first attempt through the `resolved` or `invalid`
terminating attempt. This includes an absent higher-priority artifact path recorded as
`exists:false`/`sha256:null`, absent/invalid derive-provider inputs, and the selected
source. It excludes sources never attempted after termination.

Only project-local attempt dependencies are passed as phase evidence manifest
`extraInputs`. The contract fingerprint remains persisted in the report, summary, and
closure identity, but the framework contract file path MUST NOT become feature evidence:
a framework upgrade must not stale historical consumer feature closures. A project-local
provider input or absent high-priority artifact becoming present therefore makes the old
closure stale without re-running a resolver during finalization.

### 5. Assurance is mechanical and does not waive the quality lattice

`AssuranceLevel` is globally ordered `blocked < degraded < full`:

- `full`: every applicable capability is resolved;
- `degraded`: no applicable capability is blocked and at least one is pruned;
- `blocked`: any applicable capability is blocked.

`goal-manifest.minimum_assurance` is optional and sparse:
`Partial<Record<phaseId, 'degraded' | 'full'>>`. It only adds
`insufficient_assurance` when actual assurance is below an explicit floor. An absent
phase key adds no goal-level floor.

A floor-satisfying pruned capability is reported in
`assess.observed.degradations` rather than becoming an extra assess gap. It does not
alter existing quality-axis, phase-advance, top-level PASS closure, or release
readiness behavior.

### 6. Quality-axis adaptation projects blocked capabilities only

The report adapter preserves the existing quality-axis facts unless a capability is
`blocked`:

- `pruned` remains explicit in `assurance`, `capability_resolutions`, report disclosure,
  and `assess.observed.degradations`; it MUST NOT alter an axis, its resolution, phase
  advance, closure, or release readiness. An explicit `minimum_assurance` floor remains
  the goal-level gate for a pruned degradation.
- `blocked` forces its mapped axis to `UNVERIFIED`, release readiness to `BLOCKED`,
  and a `needs_fix/agent/current_phase` resolution. Any blocked capability clamps the
  top-level projected verdict to at least `INCOMPLETE`, including visual/asset axes
  otherwise exempt from advance blocking.

Assess consumes the existing non-PASS/unclosed paths for blocked states; it does not
add a new assess gap kind. Neither outcome introduces a `PRUNED` public status.
### 7. Static and runtime declaration consumption have separate owners

`check-contract-consistency` remains a static BLOCKER gate. It validates referenced
input IDs, track subsets, axis/on-missing/applicability/derive-provider values,
artifact registration, reachable producers, and active-track capability-ID uniqueness.

A small pure `assertCapabilityConsumption(report, checks)` runs at phase
runner/checker finalization, where both report and `CheckResult[]` exist. It enforces
an exact active mapping: each resolved capability has exactly one same-ID check;
pruned, blocked, and not-applicable capabilities have none; duplicates fail; and every
capability-backed check resolves back to an active resolved capability and its contract
axis. This is not a new subsystem.

### 8. Testing keeps runtime pipeline facts outside preflight

`checkDeviceTestRunGate` is split only along static independently executable boundaries
(SSOT/lint/selector/navigation checks). The final device evidence path remains
build→install→run using the existing profile registry and `DeviceTestPipelineHolder`.
This preserves real command ordering and prevents an immutable preflight report from
claiming runtime device facts.

## Risks / Trade-offs

- [A new high-priority source changes fallback after closure] → bind every actual
  attempt through termination, including missing artifact paths.
- [A core missing input is hidden by PASS checks on the same axis] → blocked
  capability clamps both release and projected verdict.
- [Resolver/checker facts drift] → immutable report plus exact runtime consumption
  assertion and negative fixtures.
- [Goal floor accidentally waives quality gates] → floor is scoped only to assess
  `insufficient_assurance`; quality and closure projections remain independent.
- [Migration leaves depth fields or missing-input mirrors behind] → direct 3.0.0
  replacement across schemas, types, reports, manifests, assess, docs, and tests.
- [Applicability becomes a second DSL] → allow only tracks plus named pure providers.

## Migration Plan

1. Add capability/input-source schema, applicability providers, static consistency
   checks, pre-check resolution report, and fixtures without deleting old behavior.
2. Adapt quality axes, summary 1.2, evidence freshness, closure, script reporting,
   and runtime consumption checks to the report; prove stale and PASS-closure
   counterexamples in tests.
3. Directly replace depth protocol names with assurance throughout summary, goal
   manifest identity, script reports, assess, and documentation; delete dual fields.
4. Migrate all seven contracts; remove tiers/when/satisfies and their enumeration;
   pilot business UT before completing review/testing policies and static testing split.
5. Update `MIGRATION.md`, run the full harness suite and release plan checks, then
   archive only after all OpenSpec tasks and the 3.0.0 release gate are complete.

Rollback before release is a source rollback of the unreleased 3.0.0 branch. No
consumer compatibility shim is retained because depth and assurance are never
published together.

## Open Questions

None. The plan freezes applicability, source attempt freshness, assurance ordering,
quality-lattice projection, and two-stage declaration consumption.