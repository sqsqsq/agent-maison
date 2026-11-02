## MODIFIED Requirements

### Requirement: Goal runner orchestrates feature phases deterministically

The system SHALL coordinate the original request through work units and one current-disposition loop in `GoalPhaseRuntime`. Each unit SHALL retain its dedicated author context and exact native session identity. Spec, plan, coding, review, UT and testing select applicable methods or check families; they SHALL NOT create a cold author queue or establish dispatch eligibility by phase closure. The same current disposition SHALL select authorized repair, executable checks, independent verification, concrete waiting or the satisfied endpoint.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: A unit repairs and verifies its current gap
- **WHEN** current evidence identifies an authorized product repair
- **THEN** the original unit author receives all currently decidable findings, affected verification follows, and only the satisfied requested endpoint permits completion

#### Scenario: Required evidence is unavailable
- **WHEN** current required evidence is unknown and no independent repair or executable producer is available
- **THEN** the run waits with the concrete missing producer or object condition and does not manufacture PASS or no-progress

### Requirement: Headless cross-phase progression consumes assess

Attended and detached entry SHALL consume the same current-disposition reader and evaluation. Assess SHALL project that result without a second dispatcher, phase retry/backtrack selector or author queue. Actual dispatch SHALL retain the original request, owner/epoch, write boundary and current provider authorization.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: Current repair appears during waiting
- **WHEN** a real producer or object condition changes and the public view now contains an authorized repair
- **THEN** public continuation rejoins the original run and unit author through the shared decision without resetting completion history or inventing a phase author

### Requirement: Process-level safety guards remain enforced by the driver

Explicit user deadlines and cancellation, concrete tool timeouts, native output-silence protection, bounded child cleanup, owner/fence validation, device gates, source-write protection, usage capture and detached survival SHALL remain enforced. Default total turns, per-phase content retries, default process wall limits and timeout-count escalation SHALL NOT control new execution. A timeout or interrupted invocation SHALL retain unknown work and originals rather than sign product completion.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: A concrete tool exceeds its actual grant
- **WHEN** a tool exceeds its explicitly granted timeout
- **THEN** existing bounded cleanup applies and the observed failure or unknown result reaches the shared current view without a synthetic successful tool end

### Requirement: Loop and process fuses remain distinct

Business convergence SHALL use the existing completed comparable acceptance evaluation. Unknown evidence, an unended invocation, identical cached results or repeated metadata SHALL NOT manufacture a comparison or no-progress. Actual process safety guards and read-only monitor polling limits SHALL remain separate from business completion.

#### Scenario: Monitor polling limit ends
- **WHEN** a monitor reaches its read-only polling limit
- **THEN** it stops polling without terminating an otherwise active detached run

### Requirement: Dead runs never project as RUNNING

Liveness SHALL use actual invocation/tool events, their recorded grants and current owner/process observations. An unended harness exceeding its actual grant may be stalled; missing grants SHALL NOT be replaced by old default phase timeouts. Event-only history SHALL remain readable for liveness and elapsed time even if completion originals are missing. Liveness SHALL NOT establish business completion or seal a missing native/tool end.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: An actually granted tool is dangling
- **WHEN** an unended harness has exceeded its recorded timeout and activity is stale
- **THEN** the projection reports the applicable liveness fault while business evidence remains unsatisfied

#### Scenario: A partial history has no timeout grant
- **WHEN** only historical activity events are available and no actual grant was recorded
- **THEN** elapsed activity remains readable, the deadline remains unknown, and no default manifest timeout is borrowed

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Repair candidates SHALL retain actual signal-level `item_fingerprint`, source, object and input identity. Those identities SHALL NOT be a per-item attempted quota or a one-shot author entitlement. The shared current disposition and existing completed-comparable evaluation SHALL determine repair, verification, waiting and semantic no-progress. New invoke IDs, timestamps, subjects or unchanged refusal text SHALL NOT manufacture progress or reset the comparison. A real corrective change still requires affected verification before completion.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: An unchanged unknown identity cannot buy another invocation
- **WHEN** the same required object remains unknown and its producer/input condition is unchanged
- **THEN** the run remains waiting without another author/tool call and without an invented no-progress conclusion

### Requirement: Candidate round repetition requires unchanged comparable repair inputs

Comparable repair inputs SHALL come from the existing actual request, accepted reports, effective evidence, authorization, acceptance and related-input snapshots. A changed source or newly verified material is not completion by itself. Only completed relevant verification after real feedback and a real author opportunity may establish progress or semantic no-progress through the existing evaluation. Cached replay, missing input sets, unknown results and unended native/tool calls SHALL NOT create a new comparable evaluation. No round-set exit, attempted-item quota or separate comparison ledger is introduced.

Original input sets and hashes SHALL remain original; current bytes, mtime, HEAD, report prose or repeated IDs/timestamps SHALL NOT replace missing baselines. Independently established repairs SHALL remain visible beside read faults or environmental gaps. Actual refusal originals remain fully bound for independent reading; repeated semantically identical refusal rows do not create new opportunity.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: An actual repair receives affected verification
- **WHEN** the author received current feedback and changed a relevant product input
- **THEN** the coordinator runs only affected applicable checks or independent verification, retaining current valid results and the original comparison facts

#### Scenario: Unknown evidence cannot prove no-progress
- **WHEN** required related inputs or completed verification are unavailable
- **THEN** the specific verification gap remains unknown rather than being converted to success or no-progress by a repeated fingerprint

### Requirement: Earlier-phase gaps have a total executable disposition

Missing, failed, legacy-unverified, unclosed, assurance-insufficient and stale applicable evidence SHALL enter the same current-disposition reader/resolver as repair, verify or concrete wait conditions. Actual available inputs SHALL permit checks without a preceding closed phase. Authorized repairs SHALL return to the original responsible work-unit context; a phase-order queue, summary closed word or historical PASS SHALL NOT establish author eligibility or completion. Proven partial formal publication SHALL use the existing finalizer; arbitrary current bytes SHALL NOT be rebound as executed evidence.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/check-disposition.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A missing current proof has an actual owner or producer
- **WHEN** an applicable current result is missing or stale
- **THEN** the shared view names its real repair/verification duty or concrete missing condition, preserves other actionable findings and never falls through to a fabricated upstream PASS

### Requirement: Closure recovery precedes generic freshness rejection

The real formal producer SHALL recognize a staged summary and published closure components only when they prove the same finalization, expected canonical path/hash, actual run/request and manifest binding. It SHALL finish only missing transaction steps idempotently before normal consumption. A closed-summary mismatch without existing runner-owned equivalence proof SHALL remain untrusted and require current authorized repair or verification; it MUST NOT publish a new executed-input binding for arbitrary current bytes. Summary closed words and mtime SHALL NOT synthesize a native end, phase PASS or lifecycle advancement.

Enforcement: `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/harness-runner.ts`

#### Scenario: Pointer published but canonical rename is missing
- **WHEN** the staged transaction and all existing identity/hash proofs verify but canonical summary rename did not occur
- **THEN** the formal producer completes that rename once while preserving executed inputs and returns the actual producer result

### Requirement: Goal phases advance through one shared runtime

Attended and detached execution SHALL share `GoalPhaseRuntime` as one work-unit completion coordinator. It SHALL retain owner/epoch validation, actual author/independent invocation boundaries, runtime preparation, real tool requests and fences, formal producer writes, current disposition/evaluation, native recovery, handoff and terminal projection. Phase names SHALL describe check families and historical event labels, not a second author queue or lifecycle authority. No runner, driver, supervisor or executor MAY maintain a competing dispatcher or completion state.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-phase-runtime.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-supervisor.ts`

#### Scenario: Both presentations reuse the same work unit
- **WHEN** attended and detached presentation continue the same original request
- **THEN** each unit retains its own dedicated author context and the same completion coordinator while each actual check uses the original request/owner/fence

#### Scenario: A stale executor result cannot mutate evidence
- **WHEN** the owner epoch changes while an executor is running
- **THEN** the stale result cannot publish accepted reports, formal closure or lifecycle mutations

### Requirement: Goal birth freezes the normalized actual phase chain

Fresh runs SHALL persist the normalized birth chain and immutable scope identity in the original manifest and `run_created` event. These are original scope/check metadata, not an author queue or permanent upper bound on current required work. Current active obligations and valid `scope_revised` facts SHALL determine applicable check families. Reused results remain valid only through their actual bindings; an invalidated or newly active authorized obligation SHALL be reconsidered through the same reader. Workflow edits alone SHALL NOT expand the original authorization or rewrite birth identity.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Definition work exposes an already required construction duty
- **WHEN** a birth chain omitted a check temporarily while the original authorized obligation remained active
- **THEN** the current shared view includes that duty when its real inputs become available without rewriting the birth chain or creating a same-named phase author

### Requirement: Fresh goal runs have one immutable birth contract

Attended and detached fresh runs SHALL use `createGoalRun` after actual scope resolution. A real active construction duty with a source grant in the shared write boundary SHALL freeze the exact 40-hex Git HEAD before publication, even when definition gaps temporarily shorten the birth check chain. Future owner names without actual source authorization SHALL NOT require a construction baseline. Creation SHALL publish manifest then exactly one `run_created` binding original identity and the baseline digest. Resume and attach SHALL validate those original facts and MUST NOT invent a missing birth event or silently replace the original baseline.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: A construction grant exists behind an unfinished definition
- **WHEN** the original authorized scope includes an active implementation duty and actual source write domain while the birth chain currently contains only definition checks
- **THEN** creation freezes the actual HEAD before the unit author is invoked

#### Scenario: A genuinely documentation-only request has no source grant
- **WHEN** the actual original scope has no active construction source grant
- **THEN** creation may omit the Git baseline while still publishing its one immutable birth identity


## REMOVED Requirements

### Requirement: Wall-clock budget is a hard deadline across all paths

**Reason**: P3 retires default runtime wall quotas and finalize-reserve budget control. Explicit UTC user deadlines, actual tool grants and bounded process cleanup remain effective.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.

### Requirement: Consecutive timeouts escalate once then halt

**Reason**: P3 removes consecutive-timeout counting and automatic phase-timeout escalation as dispatch or stop policy; actual invocation controls and unknown evidence remain visible.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.

### Requirement: Closure-only attempts are classified by a receipt-probe total function and budgeted by closure kind

**Reason**: P3 removes the closure-role author loop and receipt-probe dispatch ladder. Current missing evidence uses the original producer and formal finalizer, not another phase author.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.

### Requirement: Timeout budget ratchets on granted high-water and observed completions

**Reason**: P3 removes phase timeout ratchets, high-water quota inheritance and timeout-count policy. Real grants and completion originals remain observable without author deadlines inferred from historical defaults.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.

### Requirement: Budget-only authorization preserves completed upstream evidence

**Reason**: P3 ignores retired default budget input rather than authorizing quota overrides or rebasing identity. Current valid evidence is reused through its actual bindings; explicit user deadlines retain their own authority.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.

### Requirement: Wall-clock budget accumulates active runtime across resume sessions

**Reason**: P3 retains active runtime and call statistics as read-only activity, not an inherited execution quota or reason to create a successor. Explicit deadlines remain absolute and do not reset on continuation.

**Migration**: Use the existing current disposition, formal producer and explicit user deadline; historical originals remain read-only.


## ADDED Requirements

### Requirement: Explicit user deadlines and actual grants govern execution controls

Only an explicit `--user-deadline-at` / `user_deadline_at` UTC input SHALL establish a request deadline. Unfinished continuation SHALL inherit that deadline; old default wall/turn/retry fields SHALL NOT become a human deadline. The runtime SHALL refuse new native calls after that deadline or cancellation and preserve existing work, native identity and unsatisfied evidence. Concrete tools retain their actual timeouts and native calls retain output-silence protection; active authors have no default total runtime limit.

Progress and status SHALL prefer the actual invocation/tool grant recorded in events. Missing grants SHALL remain unknown, without falling back to a historical manifest's default phase timeout. Kill helpers and forced settlement SHALL keep their existing bounded cleanup contract. Call count and active runtime SHALL remain statistics, not new dispatch budgets.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: An expired explicit deadline prevents dispatch
- **WHEN** the original UTC user deadline has passed
- **THEN** no new author or independent native invocation is recorded or dispatched, the original deadline is retained, and unfinished evidence does not become completion

#### Scenario: A live author exceeds a retired default wall limit
- **WHEN** an author is active, the explicit user deadline has not passed and no cancellation or native safety condition applies
- **THEN** old wall, turn, retry and phase-timeout defaults do not stop that author

#### Scenario: Cleanup remains bounded
- **WHEN** a process-tree termination helper fails to settle
- **THEN** the existing bounded kill and force-settlement path records the failure and preserves unknown work without inventing successful native completion
