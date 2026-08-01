## Context

AgentMaison currently distributes feature-skill contracts across `SKILL.md` prose, workflow edges, phase artifact loaders, phase rules, summary writers, and hard-coded “next skill” labels. A phase can PASS while its receipt closure remains open, existing summaries have no quality-depth field, and the same progression decision is repeated by skills, the harness, and goal orchestration.

The change spans all seven feature skills, workflow metadata, harness summaries, receipt finalization, phase evidence manifests, and consumer-facing output. Runtime SSOT remains in `specs/`, `workflows/`, and `harness/`; OpenSpec records the behavior but does not become a runtime source.

Two compatibility constraints dominate the design:

- `summary.json` is protected by `phase-evidence-manifest`, so publishing a final summary after hashing the old bytes makes the manifest stale.
- Existing summary 1.0/1.1 files may say `closed` even when the old `--sync-closure` path skipped evidence-manifest generation.

## Goals / Non-Goals

**Goals:**

- Make each feature skill's inputs, outputs, verifier, and quality tiers machine-readable and versioned.
- Detect hidden producer/consumer coupling and non-deterministic tier selection in framework regression tests.
- Produce one deterministic assessment of current gaps and the next qualified action.
- Make closure and quality depth part of completion rather than presentation-only metadata.
- Publish closure crash-consistently without invalidating its own evidence manifest.
- Preserve progression authorization in the driver while centralizing qualification and recommendation in `assess`.
- Provide degradations for business UT, device testing, and code review without weakening PASS truth criteria.

**Non-Goals:**

- No LLM decisions inside assess v1.
- No Stop-hook loop, skip/waiver authorization, Android profile, or degradation tier for spec/plan.
- No new SSOT for workflow, phase rules, summary, receipt, or goal manifests.
- No goal-runner rewrite in this change; `goal-reconcile-loop` consumes the frozen contracts later.

## Decisions

### 1. Separate narrative artifact schemas from control-plane schemas

`specs/artifact-schemas/` covers only skill-authored feature artifacts. The inventory is generated before freeze from:

- `REQUIRED_FEATURE_FILES_BY_PHASE` and `OPTIONAL_FEATURE_FILES_BY_PHASE`;
- phase-evidence-manifest output tables;
- the output tables in all seven feature `SKILL.md` files.

Control-plane schemas remain at their existing paths, including `harness/schemas/summary.schema.json`, `assess@1`, receipts, `feature.yaml`, and goal manifests. Contract files reference those schemas but do not copy them.

Alternative rejected: one universal schema registry. It would duplicate existing control-plane SSOTs and create a third source beside JSON Schema and TypeScript types.

### 2. Use one contract per skill with phase sections

Each `skills/feature/<skill>/contract.yaml` declares:

- required and optional inputs, including `absent_effect`;
- produced source or versioned artifacts;
- verifier/check provider and the summary depth field;
- tiers with `when` and `satisfies`.

`change` and `exit` remain phase sections of the `change-lite` contract rather than becoming artificial skills.

The tier predicate language is deliberately finite in v1:

- `present(id)`
- `alternative(id,value)`
- `all(...)`
- `any(...)`
- `not(...)`
- one `otherwise`

The consistency gate enumerates the finite combinations of declared inputs and alternatives. Zero matches and multiple matches fail. Overlap and priority are not supported in v1.

### 3. Validate a producer/consumer graph, not unlike namespaces

Workflow `requires` values are phase IDs while contract inputs are artifact IDs or input kinds. The consistency gate therefore:

1. derives phase-to-artifact edges from contract `produces`;
2. requires every artifact input to have a producer reachable through the consumer's `effectiveRequires(track)` closure;
3. marks workflow edges without an artifact transfer as explicit control dependencies;
4. rejects hidden artifact dependencies;
5. validates `skill_doc`/contract linkage and track/tier compatibility.

The design document for each contract records the authority boundary between artifact schemas, `specs/phase-rules/*.yaml`, and imperative check scripts.

### 4. Assess is deterministic and level-triggered

`harness/scripts/assess.ts` performs:

- **observe**: read feature artifacts and phase summaries using the actual summary writer schema;
- **diff**: compare them with the active workflow, track, goal end, closure, provenance, and required depth;
- **recommend**: select the first closable gap in DAG order and expose alternatives.

`assess@1` is level-triggered and idempotent. Repeated calls over identical authoritative inputs produce the same observed fingerprint, gap set, and recommendation.

Assess decides qualification and recommendation only. Drivers retain `manual`, `batch_authorized`, and `goal_mode` authorization context, including `through_phase`. A recommendation never grants permission to execute.

### 5. Quality depth is per phase and contract-local

The canonical goal representation is `minimum_depth_by_phase`. A named quality profile is only input sugar resolved into that mapping when a goal manifest is created.

Tier names are open and have no global ordering. `actual.satisfies(required)` is evaluated only inside the contract for that phase. `adhoc` and `basic` are not globally comparable.

### 6. Closure uses a staged summary 1.2 commit

The finalizer uses this order:

1. validate harness, verifier, receipt, and trace;
2. construct the final summary 1.2 bytes in memory/a temporary file, including `depth`, `closure_status=closed`, and `closure_commit@1`;
3. generate attestation, evidence manifest, and receipt pointer using a precomputed hash for the staged summary while recording the canonical `summary.json` path;
4. write `.current-phase.json` strictly; failure aborts rather than warning and continuing;
5. atomically rename the staged summary to canonical `summary.json`; this is the final commit;
6. run assess after commit.

`closure_commit@1` does not contain the phase-evidence-manifest hash, avoiding a summary↔manifest hash cycle. Full-track closure requires summary 1.2, `closure_commit@1`, and successful manifest verification.

Legacy 1.0/1.1 `closed` summaries are `legacy_unverified` and cannot qualify downstream work. Missing legacy depth is `unknown`; consumers must rerun the harness or an explicit validating migration.

Assess failure after the summary commit does not roll back closure. The caller reports that closure committed but recommendation generation must be retried.

### 7. Rendering is outside the state transaction

The finalizer returns `{ transitioned, closure_fingerprint, assess }`. The outermost CLI renders at most once per invocation. A nested `--sync-closure` call reuses the finalizer without adding another renderer, while an explicit later command may intentionally display the same fingerprint again.

There are two render hooks:

- feature-phase harness exit;
- successful closure finalizer exit.

The three entry routes are direct harness, direct receipt check, and `--sync-closure`.

### 8. `next.json` is a disposable projection

`<features_dir>/<feature>/next.json` contains `assess@1` plus workflow, track, goal, run-attempt, summary, and evidence fingerprints. It is never authoritative. “Continue” verifies the fingerprint and recomputes on mismatch, corruption, or absence.

### 9. Degradation changes depth, not truth

- Business UT: absent plan/contracts can select `basic`; acceptance coverage and toolchain truth remain required.
- Device testing: acceptance artifacts select `full`; normalized natural-language cases select `adhoc`; device policy remains blocking.
- Code review: absent spec/contracts can select `basic`; the report declares missing inputs.

External-block and FAIL/INCOMPLETE semantics remain unchanged.

## Risks / Trade-offs

- [Contract prose and check behavior drift] → consistency gates plus fixtures exercise both declarations and verifier behavior.
- [Tier predicate explosion] → v1 uses a small finite DSL and bounded declared-input enumeration.
- [Legacy closed summaries advance work] → summary 1.2 and manifest verification are mandatory for full-track closure.
- [Staged summary path leaks into manifest] → the manifest records the canonical path and receives only staged bytes/precomputed hash.
- [Duplicate next-step output] → only outer entrypoints render; nested finalization returns structured data.
- [Low-depth PASS masquerades as full completion] → `minimum_depth_by_phase` creates an `insufficient_depth` gap.
- [New stdout breaks consumers] → the block stays outside `HARNESS_SUMMARY`, is documented as breaking, and remains size-bounded.

## Migration Plan

1. Add artifact and contract schemas plus consistency checks without changing phase behavior.
2. Introduce summary 1.2 readers/writers and staged closure finalization.
3. Add assess and `next.json`, then switch harness epilogues and next-step lookup.
4. Enable skill degradations one skill at a time: business UT, device testing, code review.
5. Update `MIGRATION.md`: rerun `--sync-closure` for legacy full-track closed summaries and rerun harness for unknown depth.
6. Rollback by disabling assess rendering and tier selection while retaining readable 1.2 summaries; never reinterpret a 1.2 low-depth result as full.

## Open Questions

None. `assess@1`, the contract schema, summary 1.2, and the closure-commit sequence must be frozen before the dependent goal-loop change is implemented.
