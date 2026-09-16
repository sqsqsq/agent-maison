## ADDED Requirements

### Requirement: Assess observes the frozen execution scope

For a scoped Goal, assess SHALL observe executed/reused phases and unresolved duties from its validated birth scope. Current track/default goal end SHALL NOT expand or truncate it. Existing recommendations SHALL retain driver authorization and budget boundaries; sourced scope revision SHALL use revise_scope, distinguishable from successful completion or unknown blocking. next.json remains a disposable projection bound to the frozen scope.

Only a finding the existing attribution layer already owns as spec or plan MAY produce a `scope_revision_input`: the candidate's `category` SHALL be `spec` or `plan` and its `source_phase` SHALL be `coding` or `review`. That input SHALL be generated from the candidate's own verifiable file bindings as a required `design-decision` (plan) or `acceptance-definition` (spec) fact, with the remaining obligations inherited unchanged, and SHALL be carried on disk in `script-report.json` — the only place the runtime reads it. The write-set violations the requirement names (`diff_within_scope`, unauthorized contract references) SHALL stay with coding; they are not registered for machine attribution, so they cannot produce such a candidate. The proposal SHALL NOT presuppose the responsible phase's decision: its reason SHALL itself state that the responsible phase must adjudicate the finding, never that the extension is justified. The responsible phase SHALL be derived from the run's own effective scope rather than from the currently active workflow. When the carrier cannot be written, the caller SHALL fail closed — the phase stays open rather than committing a state whose revision the runtime will never see. No new check id, no new attribution field and no intent classifier SHALL be introduced.

Both assembly points SHALL carry it: the summary writer (reachable on PASS and on FAIL rounds alike) and the closure recompute (late, verifier-confirmed candidates, including the `--sync-closure` exit). The same candidate appearing at both SHALL produce exactly one revision — the runtime deduplicates by revision-input fingerprint.

A correction routed to a phase outside the effective scope SHALL NOT be turned into a scope revision: such a proposal carries no new sourced fact and the runtime's "a revision must be driven by a new fact" rule would reject it. It SHALL instead report that the responsible phase is outside the effective scope and name the two legal routes — a real checker finding that revises inside this run, or an explicit requirement change signed off as a new run.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/correction-commands.ts`, `harness/schemas/assess.schema.json`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-phase-runtime.ts`.

#### Scenario: Current workflow changes after birth
- **WHEN** a run resumes after candidate/track/default order changes
- **THEN** assess SHALL retain the frozen phase range and reasons instead of demanding new out-of-scope summaries

#### Scenario: Unknown work is not successful completion
- **WHEN** existing phases are closed but a required later responsibility remains unresolved
- **THEN** assess SHALL return the remaining gap or a valid scope revision, not Feature completion

#### Scenario: A plan-owned finding becomes a design decision for plan to adjudicate
- **WHEN** coding produces a `ui_scope_violation` that the existing registry attributes to plan
- **THEN** a required `design-decision` fact SHALL be generated from that candidate's own files and the responsible phase SHALL re-enter the chain in this run, with the reason stating that plan must adjudicate

#### Scenario: A named write-set violation stays with coding
- **WHEN** coding fails `diff_within_scope` or an unauthorized contract reference check
- **THEN** no spec/plan candidate and no revision input SHALL be produced, and the repair SHALL remain with coding

#### Scenario: A correction outside the effective scope explains instead of proposing
- **WHEN** the correction three-question routing lands on a phase that is not in the effective scope
- **THEN** the command SHALL report the out-of-scope responsibility and the two legal routes, and SHALL NOT write a revision input or a `backtrack_target_absent` halt
