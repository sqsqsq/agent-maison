## Context

`contracts.yaml` is the plan phase's machine contract and its top-level `files` list is consumed later as the coding/UI scope authorization set. The current loader validates shapes but does not close file references embedded in other fields. A plan can therefore close while `resource_keys[*].media`, route/page registrations or export/build references point at paths outside `files`, deferring a deterministic authorization failure until coding.

The fix must reuse the production contracts loader and schema, preserve `contracts.files` as the sole authorization source, and add no persistent graph, manifest or content-equality exception.

## Goals / Non-Goals

**Goals:**

- Derive every contracts-owned file reference into one normalized in-memory set during plan closure.
- Require that set to be a subset of normalized `contracts.files`.
- Produce path-specific, actionable plan-phase failures and prove the twenty-logo incident shape through production APIs.

**Non-Goals:**

- No automatic file authorization based on matching bytes, spec assets, existing files or route discovery.
- No persisted reference graph, second allowlist, test-only facts table or host-project mutation.
- No changes to coding UI-scope verdict semantics.

## Decisions

### 1. Extend the production contracts parser with a normalized view

The contracts loader returns its existing parsed contract plus an in-memory `referenceClosure` view produced by `resolveContractFileReferences`. Each item records normalized repository-relative path, source field kind and source location/key for diagnostics. Path normalization uses the same canonical repository-path rules as `contracts.files`; absolute paths, traversal, empty values and non-file shapes fail through existing schema/parser diagnostics.

A generic recursive “every string that looks like a path” scan was rejected because it would treat prose and non-file identifiers as authorization. Instead, the resolver enumerates file-bearing fields defined by the contracts schema: `resource_keys[*].path`, media values, page/route registration file fields, HAR index/builder/export fields and any other schema-declared materialized-file references. The production resolver is the single enumeration consumed by tests and closure.

### 2. contracts.files is the only authorization set

Closure builds a normalized set from `contracts.files` and checks every resolved reference for membership. Existing file presence, byte equality with spec/assets, generated-source status or a second field cannot grant membership. Duplicates normalize deterministically but still preserve diagnostic sources.

This check answers authorization, not content integrity. Existing schema checks and content/hash gates remain independent.

### 3. Enforce at plan closure and reuse the same result

`check-plan` runs the closure check before a PASS-compatible closure is emitted. Missing memberships produce one BLOCKER check with all bounded path/source diagnostics and the sole recovery: edit the plan's `contracts.files`, regenerate/close contracts, and rerun plan closure. Later consumers may reuse the normalized `files` set but do not maintain another reference graph.

### 4. Model the host incident minimally

The fixture contains only the directories/files required by the real contracts loader and plan checker plus twenty `resource_keys.media` paths. The red version omits them from `files`; the green version adds them. Tests load YAML through the production parser and invoke the production closure API. No copy of the host repository, host execution or direct hand-built parsed object is permitted.

## Risks / Trade-offs

- [A schema file-bearing field is missed] → Keep enumeration adjacent to typed/schema parsing and add structural coverage asserting every declared file-reference kind has a resolver branch.
- [Path normalization differs from coding scope] → Reuse the existing repository-relative normalizer and compare normalized values only.
- [Existing consumers close invalid contracts after upgrade] → Fail at plan closure with exact paths and migration guidance; do not silently broaden authorization.
- [A generic scan causes false positives] → Enumerate only schema-defined file-bearing fields and cover representative legal non-path strings.

## Migration Plan

1. Add the production reference resolver and tests for each schema-defined file-bearing field.
2. Wire the subset check into `check-plan` closure and expose bounded diagnostics.
3. Add the twenty-logo red/green fixture through the real loader/closure path.
4. Update contracts schema/template, plan skill and migration guidance.

Rollback removes the new closure check before release; no persistent data conversion is needed because no graph or new artifact is written.

## Open Questions

None. Expansion and exception policy are fixed by the master plan.
