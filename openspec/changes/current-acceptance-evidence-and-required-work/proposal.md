# Current acceptance evidence and required work

## Why

The fe4512 S2 recovery retained a settled author and a passing raw plan gate, but an old confirmed finding was dispatched before current UT counterevidence was available. The author guidance said only BLOCKER findings required work, while runtime later treated the unresolved acceptance finding as mandatory. Verification-only work consumed content retries and the remaining total-call budget could not close the request.

## What Changes

- Assemble current related acceptance evidence before choosing author work, using the existing disposition/material and original verifier paths.
- Deliver the same complete current task to authors, diagnostics, public next steps and closure consumers; replace the independent BLOCKER-only guidance without changing raw report severity.
- Reuse a settled invocation only when its own raw gate and negative source prove verification-only eligibility; preserve bounded retries, total calls, wall clock and authorization.
- Keep the selected relevant verifier evidence stable during verification and closure, refreshing only for real related input or binding changes.

## Impact

Affected capabilities: goal-runner, runtime-policy and harness-gates. Existing request/material, evidence, responsibility and recovery carriers remain authoritative. No new persistent state, incident reason, registration table, approval or budget pool is introduced. Host continuation remains a separate post-release observation; development replay does not establish host delivery.
