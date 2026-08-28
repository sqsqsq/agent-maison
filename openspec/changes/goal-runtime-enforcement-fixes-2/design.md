## Context

The canonical runtime now owns normal phase progression, but four compatibility surfaces still bypass the intended closure: legacy fidelity recovery expands a local chain after birth; attended preflight throws instead of returning the documented manual route; a compatibility helper performs an entire handoff transition; and two stdio request constructors expose the same protocol. Separately, goal scope gates still read a live diff-base variable, contract closure silently ignores unknown path-bearing keys, and structural/OpenSpec reference checks prove only narrow literals.

The implementation must preserve existing manifests, events, mailbox files, schemas and authorization policy. Existing consumer adapters remain valid; unsupported attended adapters return to the already documented manual harness+assess route.

## Goals / Non-Goals

**Goals:**

- Make the ordered birth chain exactly equal to every phase a modern run may execute.
- Keep the canonical runtime as the only lifecycle/handoff writer and the host entry as the only attended stdio endpoint.
- Make goal diff and contract file authorization fail closed against live or unregistered inputs.
- Turn the master plan's uniqueness/reference claims into mechanical repository checks.

**Non-Goals:**

- No new run status, manifest, ledger, mailbox, owner, authorization or adjudication mechanism.
- No redesign of interactive vision canary routing.
- No physical removal of the era-isolated legacy baseline reader scheduled for 3.1.0.
- No consumer project mutation or host-device execution.

## Decisions

1. **Resolve legacy fidelity recovery before birth.** Fresh creation computes the recovery prefix before calling `createGoalRun` and passes the expanded normalized chain to that existing transaction. Modern resume/attach loads only `run_created.phase_chain`; a pending recovery request whose target is absent from that chain is framework corruption and halts rather than mutating the chain. This preserves the safety recovery without a post-birth exception.

2. **Route unsupported attended adapters before autonomous runtime entry.** The host bridge consumes the existing capability router and returns `manual_fallback` without acquiring/progressing an autonomous session. `runGoalPreflight` remains fail-closed for callers that nevertheless request an invalid autonomous mode. The attended prepare entry also uses the detached entry's existing `unattended.max_turns` default so equivalent fresh inputs produce the same birth identity.

3. **Requests are external intent; transitions remain runtime-owned.** Replace `handoffSessionToDetached` with a request-only compatibility function. It writes the existing mailbox under the current fence but does not consume, emit lifecycle events, quiesce or release. Tests inject the request while the real runtime is active and observe the runtime consume/project it.

4. **One attended stdio adapter.** `goal-mode-entry` owns request construction, stdout/stdin and response validation. `GoalPhaseRuntime` requires an injected attended executor and no longer provides a second implicit CLI transport.

5. **Goal signals dominate live diff env.** `check-coding` and `check-exit` reuse `hasGoalExecutionSignal`; a live `HARNESS_DIFF_BASE_REF` is accepted only outside goal execution. No new signal list is introduced.

6. **Reject unconsumed file-like contract fields.** Keep the explicit reference inventory as the positive parser, then scan contract objects for non-inventory keys whose names/values identify materialized files. Such entries become `invalid_paths` and block plan closure. This preserves top-level compatibility better than globally setting `additionalProperties:false`, while typos such as `navigation.route_map` fail with their source path.

7. **Validate authority, not loop spelling.** Structural tests count definitions/call edges for lifecycle advancement, handoff transition writers and gate calls rather than the literal `while (!phaseDone)`. A repository script validates exact path-like tokens in canonical `Enforcement:` lines; glob/symbol shorthand is either expanded explicitly or left outside the exact-path class.

## Risks / Trade-offs

- **[Risk] Pre-birth legacy inspection can depend on feature artifacts that change immediately after creation.** → Freeze only the resulting chain; later artifact edits cannot alter it and normal drift/closure gates handle the artifact itself.
- **[Risk] Request-only handoff changes synchronous helper expectations.** → Keep the compatibility export name only if needed, but change tests and documentation to treat it as intent publication; the runtime remains responsible for completion.
- **[Risk] File-like detection can flag legitimate opaque strings.** → Restrict it to structured contract sections and path-bearing key/value shapes, with focused positive fixtures.
- **[Risk] Enforcement validation can expose older stale references.** → Repair all exact missing canonical paths in the same change; do not treat functions or human prose as filesystem paths.

## Migration Plan

1. Land runtime and gate changes with focused negative tests.
2. Repair canonical enforcement anchors and enable the exact-path validator.
3. Run typecheck, targeted unit groups, full harness tests and strict OpenSpec validation.
4. Existing modern runs whose frozen chain already contains all recovery phases resume normally. A buggy-window run that requires an absent recovery phase stops and must be superseded/recreated; its birth facts are never rewritten.

## Open Questions

None. Interactive canary observability remains a non-blocking follow-up outside this correction.
