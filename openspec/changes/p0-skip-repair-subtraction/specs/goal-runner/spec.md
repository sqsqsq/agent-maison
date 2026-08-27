# goal-runner Spec Delta

## ADDED Requirements

### Requirement: The runner has no dedicated P0-skip halt; P0 repair facts route through the candidate ladder

The goal runner SHALL NOT halt on P0 skips with a dedicated `await_human_p0_skip` branch, guidance, or failure kind, and the classifier SHALL NOT classify P0-skip blockers into a human-only family or the cumulative-halt family. The decision ladder SHALL be: safety/terminal conditions first (framework integrity, external prerequisites, operator interrupt, hard budgets); then trusted `repair_candidates` routed by assess to the responsible phase via the single `backtrack_to_phase` branch (reusing the existing backtrack budget, round fingerprint fuse, invalidation transaction, and `backtrack_target_absent`); then capability-missing defer where supported by real external evidence; otherwise ordinary content/evidence retry and fuse semantics. Quality blockers SHALL NOT fall through to `await_human_gate_deferral`. Historical events carrying `halt_reason=await_human_p0_skip` remain interpretable for diagnostics only and SHALL never influence driver decisions. No new resume/supersede/supervisor behavior and no second driver; the c6 process-control contracts remain untouched.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: an unwaived P0 explicit skip backtracks to coding instead of halting for a human

- **WHEN** testing fails with `p0_coverage_integrity` FAIL + `code_regression` (and possibly visual candidates) in the summary and no integrity/budget condition is present
- **THEN** the runner SHALL emit `phase_backtrack_requested(reason=repair_candidates, target=coding)` and SHALL NOT emit `phase_halt(halt_reason=await_human_p0_skip)` nor a WAITING/human disposition

#### Scenario: capability blockers defer without a quality signature

- **WHEN** a round has zero repair candidates and the remaining blocker is a machine-proven unavailable external capability
- **THEN** the runner SHALL use the existing capability/external defer path rather than a human quality gate
