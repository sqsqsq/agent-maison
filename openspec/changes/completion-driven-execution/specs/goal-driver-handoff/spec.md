## ADDED Requirements

### Requirement: Work-unit requests preserve invocation identity across transports

Session handoff and process execution SHALL consume the same work-unit request, current authorization, original invocation stream and write snapshots. Existing owner epoch, invoke_id and immutable request references SHALL prevent duplicate execution and stale reports. Enforcement: goal-phase-executor.ts, session-execution-handoff.ts and goal-run-control.ts.

The existing goal-mode-entry CLI SHALL expose --execute-request, --observe and --interrupt for the saved --request. The returned execute_command/observe_command/interrupt_command are transport projections, not additional authority or state. Execute SHALL use the common native executor and existing run lock/process binding; observe SHALL return original tool events, current snapshot/writes and invocation facts in the same shape for both transports. Interrupt SHALL stop only an exact existing binding and preserve the real incomplete result. The main conversation MUST NOT substitute business editing for execute_command. No new run directory, coordinator, event kind or state file is introduced.

#### Scenario: A result is reported twice
- **WHEN** the same settled request and identical result are reported again
- **THEN** the runtime reuses the accepted result without executing again or recording another business write

#### Scenario: A previous owner returns late
- **WHEN** a report belongs to an obsolete owner or another signed request
- **THEN** it cannot replace the current result or start another author

#### Scenario: A lease expires while the old execution may still run
- **WHEN** an operator requests takeover of an unreported request
- **THEN** the transport confirms the exact old binding stopped before re-signing; no binding or unverifiable identity remains a truthful recovery gap and does not authorize another author

### Requirement: Running observations and interruption preserve recoverable work

The transport SHALL expose in-progress invocation/tool facts and current artifact changes to the coordinator without deciding business progress. A coordinator interruption SHALL stop only the current owner-bound execution and preserve its actual incomplete result, original stream, provider identity and writes. Enforcement: session-execution-handoff.ts, goal-phase-executor.ts and agent-invoke.ts.

#### Scenario: A running author is interrupted
- **WHEN** the coordinator requests interruption of the current request and stopping is confirmed
- **THEN** the result remains incomplete and recoverable, existing artifacts remain and a later continuation can use the exact native identity or current-fact reconstruction

#### Scenario: The same observation is reread
- **WHEN** no artifact/check input or result changed between reads
- **THEN** the transport returns the same underlying facts and does not create a new progress decision or quota
