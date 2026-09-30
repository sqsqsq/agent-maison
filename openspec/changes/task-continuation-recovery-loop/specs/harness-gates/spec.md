## MODIFIED Requirements

### Requirement: Gate internal errors are attributed as framework_bug, not agent content failures

When a phase checker throws a programmer error (TypeError/RangeError/SyntaxError), the `safeRun` wrapper SHALL keep the fail-closed BLOCKER FAIL and additionally set `failure_kind: 'framework_bug'` and `blocking_class: 'framework_internal'` on the result (reusing existing CheckResult/summary-blocker fields — no schema change). Downstream goal-runner classification SHALL, in rounds that did not time out, treat a fresh blocker set that contains any framework blocker (judged by the shared blocker actionability registry, including `blocking_class: framework_internal`) as `framework_bug` and halt on first touch without consuming a content retry, keeping any content blockers of the same round listed for repair after the framework defect is resolved; timed-out rounds SHALL keep the all-framework_bug freshness decision table. It SHALL halt with guidance to upstream the defect (agent must not modify framework release files nor keep mutating its own artifacts to work around the gate).

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-review.ts`, `harness/scripts/check-ut.ts` (safeRun), `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Gate crash stops feeding the agent retry loop

- **WHEN** a checker crashes with a TypeError while parsing an agent-authored YAML and the summary is fresh
- **THEN** the goal run SHALL halt with `framework_bug` guidance naming the checker id and stack head, instead of retrying the agent against an unfixable blocker

#### Scenario: A checker crash next to a content blocker still halts as framework_bug

- **WHEN** a non-timed-out round's fresh summary has one crashed-checker blocker and one ordinary content blocker
- **THEN** the run SHALL halt with `framework_bug` guidance naming both, SHALL NOT classify the round as `code_regression`, and SHALL keep the content blocker in the summary
