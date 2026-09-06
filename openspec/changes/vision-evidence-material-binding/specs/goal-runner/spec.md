# goal-runner Spec Delta

## MODIFIED Requirements

### Requirement: Spec closure-only prompts mandate read-only visual re-evidencing

For spec closure-only attempts the runner prompt SHALL state that FROZEN applies to artifacts, not to read-only evidencing, and SHALL list every authoritative reference image derived from the spec visual handoff. It SHALL state that an image already read earlier in **this run** still counts while its content is unchanged, and that a changed image must be re-read. It SHALL NOT order a per-image re-read of every listed image, SHALL NOT describe the `vl_multimodal` sign-off as invocation-bound, and SHALL NOT threaten a partial receipt or a gate failure for not re-reading. Modifying artifacts remains forbidden.

The honest-`unverified` variant — issued when this invocation lacks working vision or per-image Read auditing — is unchanged.

Enforcement: `harness/scripts/goal-runner.ts`（`buildClosureVisualEvidenceBlock`）, `harness/scripts/check-spec.ts`（gate 判定不变）

#### Scenario: a closure-only attempt passes the sign-off without re-reading

- **WHEN** a spec closure-only attempt starts, an earlier invocation of the same run already read all authoritative reference images, and none of them changed
- **THEN** the prompt lists the images without a mandatory re-read instruction, the receipt carries the earlier reads forward, and `ui_spec_fidelity_gate` does not fail structurally on the closure attempt

#### Scenario: the prompt no longer contradicts FROZEN

- **WHEN** the closure prompt is assembled for a structured-events adapter
- **THEN** the assembled prompt SHALL contain none of `Mandatory`, `REQUIRED`, `only accepts reference images actually read during THIS invocation`, `read EVERY authoritative`, `Skipping any image`

## REMOVED Requirements

### Requirement: Inline canary signing consumes the shared canary decision SSOT on this invoke's stdout boundary

**Reason**: The per-invocation inline canary is deleted. It competed with the product output for the end of the same final message: when the completion probe observed closure and killed the process within the grace window, the answer was never emitted, the round was marked "non-zero exit — not adjudicated", no capability receipt was issued, and the sign-off was refused even though every reference image had been read (host run `20260905T103028Z-79d3fd`, spec-i4). Capability truth falls back to the run-level preflight probe canary, whose question, rendering, TTL and admissibility predicates are unchanged.

**Migration**: `vision/capability-receipt.json` stops being produced and has no readers left; a stale file is inert. The capability/auditability split this requirement also carried is preserved in `harness-gates`: an adapter with `tool_event_provenance=none` still cannot sign per-image reference receipts or `vl_multimodal`, keeps working with images, and records `verified: unverified`.
