## Context

Infrastructure from `define-code-graph-concepts` (types, drift, anchor-hash, hmos extractor, bootstrap script) exists but was not wired to user workflows. `catalog-bootstrap` established the pattern: public Skill SSOT + profile addendum + global harness phase.

## Goals / Non-Goals

**Goals**
- Single-module Code Graph maintenance via `/code-graph` Skill.
- Global `--phase module-graph` drift gate (profile-neutral).
- GraphExtractor loaded via `profile-host-loader` (same as UT host impl).
- generic profile placeholder assets so `profile-skill-assets` validation passes.

**Non-Goals**
- Repo Map, skill navigation integration, batch `--all` bootstrap.
- Derived-layer freshness enforcement in v1 gate.
- flow DAG continuity validation (stays in business-ut).

## Decisions

1. **Zero graphs → PASS**: avoid blocking all legacy projects when the phase is first enabled.
2. **Severity mapping**: reuse `evaluateCodeGraphDrift()` — core body hash change = `core_anchor_drift` BLOCKER; non-core = `noncore_body_drift` WARN.
3. **GraphExtractor placement**: profile host impl only; not in `harness/providers` capability registry.
4. **Workflow deps**: `module-graph` is first global phase with `requires: [catalog]` (topological only).
5. **Trace**: global phase; no feature trace schema extension.

## Risks / Trade-offs

- Users may ignore WARN-level non-core drift → mitigated by Skill self-check step and docs.
- generic users see generation unsupported → explicit addendum + bootstrap error message.

## Migration Plan

No migration required. Optional: run `/code-graph` per module, then `--phase module-graph` in CI.

## Open Questions

- CI-scheduled drift job (deferred).
- Non-hmos GraphExtractor providers (per-profile future work).
