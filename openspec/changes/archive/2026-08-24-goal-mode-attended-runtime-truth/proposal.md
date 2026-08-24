## Why

An attended goal run currently loses its goal identity before the spec-owned fidelity SSOT is written, while the unattended supervisor can mistake a live or recoverable session owner for a dead process. The same host incident also exposed adapter-specific skill bridges and provenance declarations that can disagree with the local adapter SSOT, so the runtime boundary must be made explicit before another consumer run is trusted.

## What Changes

- Bind each attended `phase_execute_request` to its exact run, phase attempt, and fenced session owner/epoch. Require the initializer, harness, and closure sync entry to validate that same context before writing or injecting the existing goal/gate environment.
- Make the existing fidelity initializer write attended goal identity and manifest-backed requirement provenance at the spec entry point, while preserving the single-writer and downstream read-only rules.
- Restrict automatic supervision to process owners; all session-owner states remain event-free and unspawned, with mailbox handoff as the normal owner transition and explicit orphan takeover as the only exception.
- Resolve detached runtime preload paths independently of the consumer working directory.
- Make generated skill bridges adapter-neutral, make personal setup resolution local-first, and record adapter provenance from its real source.
- Require `--run-mode attended` before the attended bridge acquires ownership without persisting a parallel run-mode field or event.
- Reject an attach adapter that differs from the persisted manifest before owner CAS, and reuse the manifest adapter thereafter.
- Treat a handoff as conclusively complete only after the supervisor parses it with the canonical handoff validator; malformed or mismatched mailboxes fail closed.
- No consumer migration is required; existing manifests and `unattended` contracts remain valid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: Supervision, attended ownership, orphan takeover, and detached runtime behavior become owner-aware and fail-closed.
- `goal-mode-skill`: Attended entry, run-mode selection, mailbox/orphan recovery, and local-first setup instructions become explicit and consistent.
- `agent-adapters`: Materialized skill bridges become identity-neutral and coexist safely across shared adapter roots.
- `harness-gates`: The spec fidelity initializer and harness entry consume an explicitly validated attended goal context without downstream SSOT rewrites.

## Impact

- Runtime: `harness/scripts/goal-supervise.ts`, `goal-runner.ts`, `goal-mode-entry.ts`, `fidelity-intent-init.ts`, `harness-runner.ts`, and shared goal-context/handoff utilities.
- Skills and adapters: goal-mode/spec skill instructions, personal-setup operations, bridge materialization, and Chrys coexistence notes.
- Tests: targeted owner-state, attended identity, bridge coexistence, personal-setup, provenance, and project-root detach regressions, followed by the repository harness and OpenSpec gates.
- Phases affected: goal-mode entry and the spec-through-testing phase chain; `MIGRATION.md` remains unchanged because no persisted schema or consumer invocation contract is removed.
