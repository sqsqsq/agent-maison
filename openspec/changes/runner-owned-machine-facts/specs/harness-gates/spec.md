## MODIFIED Requirements

### Requirement: P0 device acceptance criteria are proven as structured state transitions

check-spec SHALL require, for every P0 device/both interactive AC: a structured checkpoint (`pre_checkpoint{screen_id} → action{type,target_element_id[,value_class]} → post_checkpoint{screen_id,required_element_ids,forbidden_element_ids}`) referencing the ui-spec screen registry — missing structure SHALL FAIL (non-P0: WARN). Flows integrity: every flow node/edge SHALL be owned by ≥1 P0 AC checkpoint; every P0 AC SHALL carry `requirement_ref{source_path,snippet}` whose snippet verifiably exists verbatim in the source document — the gate SHALL read the source document and verify the snippet itself; any content hash the gate needs SHALL be derived internally and MUST NOT be required from the agent (a legacy `snippet_sha256` field in existing YAML is ignored; no migration required); each flow SHALL equal the ordered composition of its owning checkpoints' edges (unsupported jump edges FAIL). check-testing (`p0_semantic_coverage_integrity`, BLOCKER) SHALL verify per mapped TC: pre-screen evidence, an action resolved to the target element (by_id directly, or coordinate touch resolved via pre-action layout dump hit-test — unresolvable or non-unique hits FAIL), post-screen evidence with required present and forbidden absent, and — across each linked_flow — the declared screen sequence appearing in order in the trace (missing intermediate screens FAIL). Normalized page signatures serve anti-replay only and never substitute for checkpoint assertions; P0 checkpoints SHALL persist screenshot/layout-dump evidence bound to trace steps. Pass-rate reporting SHALL recompute execution coverage (skips in the denominator) and pass rate separately; a report conclusion contradicting the recomputation SHALL FAIL.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, acceptance/ui-spec schema, layout-dump 链复用 layout-oracle-geometry-gates

#### Scenario: an agent without shell access completes requirement_ref

- **WHEN** a headless agent has no shell permission and fills `requirement_ref{source_path,snippet}` with a verbatim snippet
- **THEN** the gate PASSes by verifying the snippet against the source document itself, without requiring any agent-computed hash

#### Scenario: a legacy snippet_sha256 field is inert

- **WHEN** an existing acceptance.yaml carries `snippet_sha256` values that do not match their snippets
- **THEN** the gate ignores the field entirely and judges only source-path existence and verbatim snippet presence

#### Scenario: a fabricated snippet still fails

- **WHEN** a P0 AC's `requirement_ref.snippet` does not exist verbatim in the referenced source document
- **THEN** the gate SHALL FAIL naming the AC (引文伪造/漂移)

## REMOVED Requirements

### Requirement: Headless assumption ledgers are schema-validated and registry-complete

**Reason**: The ledger is a feature-level, cross-run append-only record that by its own charter "leaves a trace, grants no authorization" — it must not hold closure veto power either. In production (host run `20260815T083127Z-edfe38`) the run-id binding declared 58 prior-run lines "illegal" and the registry-coverage check demanded re-registration of decisions already materialized in artifacts (`spec.feature_path`, `spec.terminology`), permanently failing a complete, identity-matching receipt. Gate-level facts those entries once notarized are enforced by their own deterministic gates; the ledger remains for observability (goal-report auto-decision summary) and human review only. When receipt validation fails, the goal runner SHALL surface the validator's actual error output in its log (detach.log) instead of a bare `receipt_status=failed`.
