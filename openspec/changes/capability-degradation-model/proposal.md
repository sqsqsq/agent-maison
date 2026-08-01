## Why

The current input-sensitive tier model distributes fallback, depth, and missing-input
semantics across contracts and checkers. It can leave fallback selection, summary
freshness, quality-axis projection, and assess reconciliation without one auditable
source of truth. The unreleased 3.0.0 window permits a direct migration before those
interfaces become consumer compatibility obligations.

## What Changes

- Replace contract `tiers`/`when`/`satisfies` and input-level missing policies with
  capability declarations, structured artifact/derive source chains, explicit
  applicability preflight, and deterministic capability resolution.
- Add one immutable pre-check `CapabilityResolutionReport` per phase, persist its
  normalized results and source-attempt freshness bindings in summary 1.2, and make
  all consumers reuse it.
- Derive globally ordered `assurance` (`blocked < degraded < full`) mechanically
  from applicable capability outcomes; rename depth protocol fields to assurance.
- Keep `pruned` as explicit assurance/report/assess degradation provenance outside
  quality-axis projection, and project only `blocked` capabilities into the existing
  quality-axis and verdict lattice without adding a public `PRUNED` status.
- Extend static contract consistency validation and add phase-final runtime
  capability-to-check consumption assertions.
- **BREAKING** Replace `summary.depth`, contract-local quality tiers, and related
  script-report/assess fields with assurance and capability-resolution protocol
  fields. Legacy 3.0.0 development summaries must be regenerated; no dual field is
  retained.

## Capabilities

### New Capabilities

- `capability-degradation`: Deterministic applicability, source resolution,
  assurance derivation, freshness, and quality-lattice projection for declared
  phase capabilities.

### Modified Capabilities

- `skill-contracts`: Contracts change from tier predicates and input policy lists to
  capability/input-source declarations with producer-consumer validation.
- `skill-quality-tiers`: Per-skill full/basic/adhoc tier behavior is replaced by
  mechanical capability degradation without weakening truth semantics.
- `reconcile-assessment`: Assessment observes assurance, authorized degradations,
  blocked capability effects, and renamed minimum-assurance constraints.
- `harness-gates`: Summary, evidence freshness, closure, quality-axis, and runtime
  gate behavior consume the capability-resolution protocol.

## Impact

- Affects all seven `skills/feature/*/contract.yaml` files, the contract schema and
  loader, `check-contract-consistency`, quality axes, phase evidence/closure,
  report generation, assess, goal manifests, and summary/script-report schemas.
- Preserves the profile/toolchain capability registry and testing's runtime
  build→install→run holder; the new resolver only handles pre-check artifact/derive
  inputs.
- Requires harness unit/fixture regressions, a new CORE_SUITE, consumer migration
  notes, and release validation before archive.