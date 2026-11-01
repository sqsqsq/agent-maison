## ADDED Requirements

### Requirement: Work-unit native sessions resume by exact provider identity

Adapters SHALL transport one dedicated author context for an existing root/CU/request and MUST recover the provider session identity from that invocation's structured agent-events stream. Codex SHALL use exec resume with the exact ID, Claude SHALL use --resume with the exact ID, and DSH SHALL use --session-id with the exact ID. They MUST NOT guess the latest session. Enforcement: harness/scripts/utils/agent-invoke.ts, codex-terminal-events.ts and goal-phase-executor.ts.

#### Scenario: Another session is newer
- **WHEN** an unrelated provider session was created after the work-unit author session
- **THEN** the next invocation resumes the original exact ID and retains its artifacts and new feedback

#### Scenario: Permission changes or native identity is missing
- **WHEN** the current trusted authorization differs or the invocation stream contains no recoverable ID
- **THEN** execution uses the current authorization and reconstructs a dedicated context from current facts, without reusing obsolete permissions or claiming lossless continuation

#### Scenario: A verifier runs independently
- **WHEN** the coordinator requests independent questioning or verification
- **THEN** it uses another context without inheriting the author session identity; questioning/canary calls request native read-only permissions and disclose actual enforcement, while formal review/format repair retain their existing bounded report/tool abilities and cannot change product source

### Requirement: Execution deadlines represent explicit user constraints

The common executor SHALL accept an optional absolute UTC user_deadline_at and cancellation. It MUST NOT derive a default author deadline or native max-turns/max-budget from phase or cumulative quotas. Operation-specific tool cleanup SHALL remain bounded. Enforcement: goal-manifest.ts, goal-phase-executor.ts and agent-invoke.ts.

The shared native transport SHALL interrupt an unsettled invocation without real child stdout/stderr growth or an observed terminal after an output-idle window equal to the larger of 90 minutes and the largest existing public Hvigor build or device-UT tool timeout plus 45 minutes of check overhead. Default tool settings SHALL retain the 90-minute window; a two-hour configured tool timeout SHALL produce a 165-minute window and a six-hour timeout SHALL produce a 405-minute window. Framework heartbeats and lease renewal MUST NOT extend this window. This hang protection is separate from a user deadline and P2 acceptance-progress evaluation: it SHALL preserve partial work, original output and the verified provider identity and report interrupted/unknown, not product failure or completion. Continuous real output SHALL impose no total author duration limit through this protection. Opaque tools may still be interrupted when their silence exceeds the window; unlimited silent-tool execution is not guaranteed. Observed terminal results SHALL retain their existing bounded cleanup behavior.

#### Scenario: Resume after the user deadline
- **WHEN** an explicit deadline has elapsed before continuation
- **THEN** no new author work starts and the existing deadline is not reset

#### Scenario: An active author exceeds an old phase duration
- **WHEN** no user deadline or cancellation exists and the author remains active
- **THEN** the common executor does not terminate it because of an old phase timeout

#### Scenario: Native output stops while framework heartbeats continue
- **WHEN** the native invocation has no terminal and no stdout/stderr growth throughout the output-idle window
- **THEN** existing process-tree interruption and bounded cleanup preserve recoverable work and native identity with an unknown result, even if framework heartbeats continue

#### Scenario: Real output continues beyond the idle window
- **WHEN** native output keeps growing and the total invocation duration exceeds one output-idle window
- **THEN** output-idle protection does not terminate it, while explicit user deadlines and cancellation remain effective
