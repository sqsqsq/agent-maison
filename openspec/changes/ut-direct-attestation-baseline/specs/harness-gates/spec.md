# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Direct-mode UT source-mutation gating is attestation-first and never accepts partial closure evidence as a downgrade licence

Outside the goal orchestration environment, the UT source-mutation gate SHALL select its baseline by **baseline availability**, not by orchestration identity. It SHALL first determine whether the review phase is **formally closed** — the review `summary.json` satisfying `schema_version == "1.2"` AND `closure_status == "closed"` AND `closure_commit.schema_version == "1.0"` — and only then consult the review closure attestation. This order MUST NOT be inverted: the attestation is written before the final summary rename, so a crashed closure can leave an orphan attestation whose presence proves nothing about closure, and the orphan's **contents** MUST NOT be read or trusted.

When review is formally closed and the attestation is readable, the gate SHALL adjudicate post-review drift by per-file content hash reconciliation and SHALL NOT depend on git commit state: coding-phase changes that the closed review already covered are outside the adjudication domain regardless of whether they were ever committed, and committing a post-review source edit SHALL NOT remove it from the drift set.

The gate SHALL fail closed with `review_closure_baseline_unavailable`, without falling back to any git diff and without consulting gap-notes, user replies or any authorization list, whenever the closure evidence is **partial**: review formally closed but the attestation missing or unreadable; the closure state unreadable or unparseable; or a review closure attestation present on disk while the summary is missing, `open`, or legacy. The presence of the attestation file is evidence that this feature has already run the review closure machinery, so a summary that is subsequently absent or downgraded MUST NOT be interpreted as "this project never closed review". Without this rule, deleting `review/reports/summary.json` after a post-review source edit is committed silently downgrades the gate to the commit-blind working diff and passes, and the upstream verdict gate skips absent summaries as well, so nothing downstream catches it.

Presence probes for these artifacts MUST distinguish "absent" from "could not be determined". `fs.existsSync` returns `false` for `EACCES`/`ENOTDIR`, and Windows reports both a file in the middle of a path and a dangling junction as `ENOENT`, so a probe SHALL resolve the absolute path top-down from the filesystem root — the report and receipt directory patterns may resolve outside the project root, so no in-project/out-of-project split may reintroduce single-shot probing — SHALL `lstat` each segment before following any link, and SHALL classify a non-directory path segment, a non-file target, an unresolvable link target, or any non-`ENOENT` error as unverifiable rather than absent. A review closure attestation that parses as JSON but whose `inventory.roots`/`inventory.files` are not well formed SHALL also be reported as an unavailable baseline rather than reaching reconciliation and surfacing as a generic framework fault.

The git-diff fallback SHALL be reserved for the case where **no review closure evidence is observable on disk** — no attestation together with a summary that is absent, `open`, or legacy — and for profiles that explicitly disable the review phase. An `open` summary without an attestation is a normal state, not an error: the default workflow lets review and UT proceed in parallel. In that domain the gate SHALL retain the pre-existing behavior and SHALL state the baseline-degradation reason in its failure details.

This requirement is scoped to *partial* evidence. Observability is the honest limit: deleting **every** review closure artifact leaves nothing to observe and still reaches the fallback, and the default workflow deliberately allows review and UT to proceed in parallel, so the absence of a summary cannot be treated as an error on its own. Defending against wholesale deletion of all evidence requires a DAG change or a trust anchor outside the workspace and is explicitly out of scope here.

Post-review drift SHALL be reported under the existing `ut_no_src_mutation` id with `failure_kind` `post_review_source_drift` and MUST attribute the finding as post-review source drift rather than as authorship by the UT phase. Its guidance SHALL offer exactly two routes — return the change to coding and re-close review (which refreshes the baseline), or restore the reviewed file content from local history/backup and **verify** it against the attested sha256 — and SHALL NOT present the attestation as a source of file content, nor instruct anyone to commit coding artifacts, widen the diff base, or obtain an approval. The attestation stores `{path, sha256}` only, so it can confirm a restored file but cannot reconstruct one.

Enforcement: `harness/scripts/check-ut.ts`, `harness/scripts/utils/source-drift-facts.ts`, `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/utils/git-diff.ts`

#### Scenario: Uncommitted coding artifacts do not block a UT run that only wrote tests

- **WHEN** review is formally closed over a workspace holding never-committed coding artifacts and the UT phase only added files under the test subtree
- **THEN** the gate SHALL PASS against the attestation baseline without requiring any commit, and SHALL report the attestation as the baseline instead of a git `baseRef`

#### Scenario: Committing a post-review source edit does not wash it out

- **WHEN** the UT phase modifies a protected product source file after review closure and then commits it
- **THEN** the gate SHALL still FAIL with `post_review_source_drift` and list the file, because the content-hash baseline does not read git state

#### Scenario: Deleting the review summary does not downgrade the gate

- **WHEN** review closed, a post-review source edit was committed, and `review/reports/summary.json` is then deleted while the attestation remains on disk
- **THEN** the gate SHALL FAIL with `review_closure_baseline_unavailable` instead of computing a working diff that cannot see the committed edit

#### Scenario: A deleted attestation under a closed review fails closed

- **WHEN** review is formally closed but `review-closure-attestation.json` is missing or unreadable
- **THEN** the gate SHALL FAIL with `review_closure_baseline_unavailable` and SHALL NOT compute a run-start/working diff or consult gap-notes

#### Scenario: An orphan attestation from a crashed closure is neither trusted nor treated as a downgrade licence

- **WHEN** `review-closure-attestation.json` exists while the review summary is still `open` or has a legacy schema
- **THEN** the gate SHALL NOT read the orphan's inventory and SHALL NOT fall back to git either; it SHALL fail closed and point at re-running the review closure

#### Scenario: An unverifiable closure state is not resolved by guessing

- **WHEN** the review summary cannot be read or parsed
- **THEN** the gate SHALL fail closed rather than either trusting the attestation or falling back to the git baseline

#### Scenario: A broken closure-artifact path is not read as "never closed"

- **WHEN** the review reports directory is replaced by a file, or is otherwise unreadable, so a naive existence check reports both artifacts as absent
- **THEN** the gate SHALL classify the probe as unverifiable and fail closed instead of computing a git diff

#### Scenario: A structurally invalid attestation reports an unavailable baseline

- **WHEN** review is formally closed and the attestation parses as JSON but its inventory entries lack `path`/`sha256`
- **THEN** the gate SHALL FAIL with `review_closure_baseline_unavailable` and its guidance, not with a generic framework fault raised from reconciliation

#### Scenario: Features with no observable closure evidence keep their existing behavior

- **WHEN** neither a review summary nor a closure attestation is observable on disk and protected source differs from the diff base
- **THEN** the gate SHALL FAIL exactly as before with `unauthorized_src_mutation`, the same affected files, and the same remediation wording
