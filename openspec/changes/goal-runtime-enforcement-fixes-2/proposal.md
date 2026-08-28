## Why

The first enforcement correction closed the main birth, attended authorization and handoff-projection defects, but a second production review found one remaining modern-run phase-chain escape plus several deterministic single-runtime and structural-acceptance gaps. These defects can execute a phase outside the facts recorded at birth, turn the documented attended fallback into an unprojected exception, or let file and diff authorization depend on live/unregistered inputs despite green tests.

## What Changes

- Compute legacy fidelity recovery before fresh creation so every phase that can execute is present in the manifest and `run_created`; modern attach/resume never expands the frozen chain.
- Return the documented attended manual fallback when in-session isolation is unavailable, without entering the autonomous runtime or leaving an unprojected exception.
- Keep equivalent attended and detached fresh-run defaults byte-semantically equal in the birth identity.
- Remove the compatibility handoff lifecycle writer and drive both handoff directions through the production mailbox plus the sole `GoalPhaseRuntime` boundary consumer.
- Keep one `phase_execute_request` constructor/stdio endpoint and one response validator for attended execution.
- Ignore `HARNESS_DIFF_BASE_REF` whenever any goal execution signal is present, including agent-side self-invoked harnesses and formal gate harnesses.
- Reject unknown file-like contract fields that are not consumed by the explicit reference inventory; keep `contracts.files` as the only authorization set.
- Replace literal-loop grep with lifecycle-owner/call-edge structural assertions, repair stale canonical `Enforcement:` anchors, and fail validation when an exact enforcement path does not exist.
- No new run state, manifest, ledger, owner model, authorization layer or consumer migration is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: Freeze legacy fidelity recovery in the actual birth chain, prohibit modern post-birth expansion, ignore live diff-base overrides in goal gates, and mechanically enforce one lifecycle owner.
- `goal-mode-skill`: Preserve documented manual fallback and a single attended phase request transport.
- `goal-driver-handoff`: Require handoff requests to be consumed and projected only by the canonical runtime boundary.
- `harness-gates`: Fail plan closure on unconsumed file-like contract fields instead of silently omitting them from the authorization closure.
- `framework-integrity`: Validate exact OpenSpec `Enforcement:` file references as part of repository validation.

## Impact

- Runtime and compatibility surfaces under `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts` and `harness/scripts/utils/`.
- Coding/exit scope gates, contract reference closure, focused fixtures and structural acceptance tests.
- Canonical OpenSpec enforcement anchors and the pinned `openspec:validate` wrapper.
- Phases affected: plan closure, coding/exit scope checks, and attended/detached goal orchestration.
- `MIGRATION.md`: no consumer migration; buggy-window modern runs whose recorded chain omitted a required legacy recovery phase must stop and be recreated/superseded rather than mutate their birth facts.
