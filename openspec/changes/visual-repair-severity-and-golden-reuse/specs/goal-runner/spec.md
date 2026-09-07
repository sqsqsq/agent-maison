# goal-runner Spec Delta

## MODIFIED Requirements

### Requirement: Visual signals are adjudicated before candidate materialization

Visual signals SHALL be classified and validated before candidate materialization. A deterministic producer signal whose applicability/evidence contract passes SHALL materialize directly as a trusted machine repair candidate even when the primary agent disputes or omits it. A current delegated-provider payload that passes identity/hash/schema validation SHALL materialize through its existing provider path. Producer uncertainty or invalid/unreliable provider evidence SHALL not create a candidate: required quality stays FAIL/UNVERIFIED or capability-deferred and optional quality may remain advisory. The runner MUST NOT write `repair_adjudication_pending`, await `visual-confirm`, consume `confirmed_by`, or use human judgment as a third authority. Visual-round integrity and convergence events SHALL still be recorded before disposition.

Structured visual defects SHALL additionally be routed by their machine `severity` before materialization. A structured defect with `severity: minor` — whether attributed to a T8 producer, to a delegated visual provider, or to no producer — SHALL NOT produce a coding repair candidate; it SHALL remain in the report WARN and in the visual debt ledger, and the runner SHALL log one per-screen count of minor signals withheld. Defects with `severity: major` or `blocker` SHALL materialize exactly as before, with unchanged signal identity, fingerprint and instruction assembly. The collector MUST NOT parse defect notes or must_fix prose (including an `[owner=…]` prefix) to derive ownership, and MUST NOT add a defect field for it. Plain-text must_fix items with no structured defect SHALL keep the legacy whole-screen fallback, and screens whose screenshot or build identity cannot be verified SHALL keep the unverified route.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: deterministic signal survives agent dispute

- **WHEN** a current deterministic layout invariant produces an applicable FAIL and the agent disputes it without independent machine counterevidence
- **THEN** the signal SHALL materialize a repair candidate and no human adjudication halt SHALL occur

#### Scenario: uncertain required evidence remains unclosed

- **WHEN** a producer cannot reliably compare a required signal
- **THEN** the required axis SHALL remain unclosed or capability-deferred without finalizing PASS or entering WAITING(human)

#### Scenario: minor visual signals do not spend the backtrack budget

- **WHEN** every structured defect on the warn screens of a fresh, identity-bound `visual-diff.json` is `severity: minor` (host testing-i13: 12 such defects, must_fix prefixed `[owner=spec]`)
- **THEN** `collectActionableDefects` SHALL produce zero visual actionable items and zero unverified items, the phase summary SHALL carry no visual repair candidate, and assess SHALL NOT recommend `rerun_phase` / `backtrack_to_phase` for them
- **AND** the `visual_diff` WARN and the visual debt entry SHALL remain

#### Scenario: a major defect still materializes unchanged

- **WHEN** one of those T8 defects is recorded with `severity: major`
- **THEN** exactly that defect SHALL become an actionable item with `signal_identity=true`, a fingerprint byte-identical to `computeDefectFingerprint(screen, defect)`, and a `coding` candidate
