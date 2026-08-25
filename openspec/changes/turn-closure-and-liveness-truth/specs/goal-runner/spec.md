# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Adapter terminal contracts close FAIL turns; absent contracts fall back to timeout honestly

When an adapter declares a machine-readable terminal event contract, the invoke layer SHALL consume
it and recognize **exactly two terminal states**. A `completed` terminal event SHALL set
`completion_observed` and enter the existing grace/kill settlement (mutually exclusive with the hard
timeout: hitting completion SHALL cancel the hard timeout). A `failed` terminal event SHALL set a
distinct `terminal_failure_observed` fact, SHALL NOT set `completion_observed`, SHALL NOT cancel the
hard wall-clock backstop, and SHALL normalize a zero exit code to non-zero so that
`agentFailed = exitCode !== 0 && completionObserved !== true` still reports failure.
Terminal failure SHALL take precedence over a completion probe in either arrival order: after a
failure, the probe cannot establish completion; if failure arrives after the probe canceled the hard
timeout, the invoke layer SHALL revoke completion and restore the backstop at its original deadline.
The final invoke result SHALL never report both closure facts as true.

Any other event — including a top-level `error` event — is **diagnostic only**: it SHALL be recorded
as an excerpt on `agent_invoke_end` and SHALL NOT set `completion_observed`, SHALL NOT trigger
settlement or kill, and SHALL NOT feed the API-disconnect sentinel, the failure classifier, or retry
adjudication. Adapters without a terminal contract SHALL rely on natural exit plus the hard timeout;
no substitute signal SHALL be synthesized from receipts, silence, or output volume.

Enforcement: `harness/scripts/utils/codex-terminal-events.ts`, `harness/scripts/utils/agent-invoke.ts`,
`harness/scripts/goal-runner.ts`

#### Scenario: failure terminal event followed by a zero exit code

- **WHEN** the adapter emits its `failed` terminal event and the process then exits with code 0
- **THEN** the invoke result SHALL report `terminal_failure_observed`, SHALL NOT report
  `completion_observed`, SHALL NOT report `timed_out`, and SHALL surface a non-zero exit code

#### Scenario: a mid-turn error event is followed by a successful completion

- **WHEN** a top-level `error` event is emitted and the same turn later emits its `completed`
  terminal event
- **THEN** the run SHALL NOT kill the process on the `error`, SHALL close the invocation on the
  `completed` event with `completion_observed`, and SHALL record the error only as an
  `agent_invoke_end` diagnostic excerpt

#### Scenario: completion probe fires before the failure terminal event

- **WHEN** the completion probe first establishes completion and the same invocation later emits
  its `failed` terminal event
- **THEN** terminal failure SHALL revoke probe completion, restore the hard timeout at its original
  deadline, and the phase verdict SHALL report `agent_failed=true`

#### Scenario: failure terminal event arrives before a completion probe match

- **WHEN** the invocation emits its `failed` terminal event and the completion probe later matches
  during settlement grace
- **THEN** the probe SHALL NOT establish completion, and the phase verdict SHALL report
  `agent_failed=true`

#### Scenario: an adapter with no terminal contract produces the same stream

- **WHEN** an adapter that declares no terminal contract emits output resembling another adapter's
  terminal events
- **THEN** the run SHALL NOT derive any closure fact from it and SHALL fall back to natural exit plus
  hard timeout

### Requirement: Terminal event evidence does not upgrade tool-call provenance

Consuming an adapter's terminal event stream SHALL NOT change that adapter's
`tool_event_provenance`. A structured terminal/usage stream on stdout is evidence that a turn ended
and how many tokens it consumed — it is **not** evidence that a tool call happened or that an image
input was injected. The adapter SHALL remain absent from the critic image-read parser registry and
SHALL NOT be issued a verified critic receipt on the strength of terminal events, and no new adapter
capability field SHALL be introduced for terminal parsing (per-adapter argv plus parser suffices).

Enforcement: `agents/codex/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`,
`harness/scripts/utils/critic-receipt-producer.ts`, `docs/operations/adapter-tool-event-provenance.md`

#### Scenario: terminal flag added without provenance upgrade

- **WHEN** the adapter's argv gains its terminal-event flag
- **THEN** `tool_event_provenance` SHALL remain `none`, the critic parser registry SHALL NOT gain the
  adapter, and no verified receipt SHALL be produced for it

### Requirement: The completion probe is a PASS-shaped closure accelerator, not a FAIL closer

The phase completion probe SHALL keep its four evidence conditions (receipt structure, summary
identity, receipt status passed, closure closed) **unchanged**. Because a genuine FAIL receipt is by
design a skeleton, the probe is structurally unable to fire on FAIL turns; this is correct behavior
and SHALL NOT be relaxed — relaxing it would both close out half-finished work and kill agents that
are still self-correcting within the attempt. Closure for FAIL turns is the responsibility of the
adapter terminal contract. The probe SHALL continue to answer two separate questions that SHALL NOT
be merged: whether the evidence is complete, and whether that complete evidence belongs to the
current invocation.

Enforcement: `harness/scripts/utils/phase-completion-probe.ts`

#### Scenario: a FAIL turn finishes with a skeleton receipt

- **WHEN** an attempt ends with a genuine FAIL and the phase receipt is still the runner-written
  skeleton
- **THEN** the probe SHALL NOT fire, and closure SHALL come from the adapter terminal contract or
  the hard timeout — not from a loosened evidence condition

### Requirement: Liveness separates the work plane from the control plane

Liveness SHALL NOT let runner-authored heartbeats mask an agent that has stopped producing output.
When (a) an unclosed agent invocation exists, (b) the agent output log has not changed within the
soft-stall window, and (c) **this run's own** `adapter_probe` event declares `output_delivery` as
streaming, the run SHALL project the existing `SUSPECTED_STALL` liveness state. The declaration
SHALL be read from the run's recorded events, never re-interpreted from the current adapter
manifest, and a missing or unrecognized value SHALL be treated as unknown. Buffered and unknown
delivery SHALL NOT be downgraded, because their logs may legitimately stay silent. The progress
projection SHALL report the work-plane stall duration, in both the default status text and Markdown,
only while all three conditions hold; otherwise `agent_output_stalled_ms` SHALL be null and no stall
line SHALL be rendered. The duration is computed as now minus the agent output log mtime — it SHALL
NOT reuse the control-plane activity age, which includes heartbeats. This
projection is observation only: it SHALL NOT kill, recover, or retry, and SHALL NOT introduce a new
liveness state or a second reducer.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: streaming adapter goes silent while heartbeats continue

- **WHEN** the agent output log has been unchanged past the soft-stall window, heartbeats are still
  being written, and the run's `adapter_probe` declared streaming delivery
- **THEN** liveness SHALL be `SUSPECTED_STALL` and the progress projection SHALL state how many
  minutes the agent output has been stalled

#### Scenario: buffered or undeclared delivery

- **WHEN** the same silence occurs but the run's `adapter_probe` declared buffered delivery, or
  declared nothing at all
- **THEN** liveness SHALL NOT be downgraded on that basis, `agent_output_stalled_ms` SHALL be null,
  and the status renderers SHALL NOT describe the agent output as stalled

#### Scenario: the invocation has already closed

- **WHEN** an old agent output log exceeds the soft-stall window but no unclosed invocation exists
- **THEN** `agent_output_stalled_ms` SHALL be null and the status renderers SHALL NOT describe the
  agent output as stalled

### Requirement: Timeout guidance states the transport and quality axes side by side

Retry guidance SHALL NOT assert that a timed-out attempt was "not a content failure" when the
harness for that **same invocation** already recorded a `FAIL` or `INCOMPLETE` verdict. The two axes
are orthogonal and both SHALL be stated: the transport fact (wall-clock timeout, partial artifacts on
disk, do not redo exploration) and the quality fact (the recorded verdict and its failure kind, whose
blocker evidence is real content feedback). The quality fact SHALL be scoped to the latest invocation
window only, so that an earlier attempt's stale failure is never presented as current. When the same
invocation produced no such verdict, the existing pure-timeout wording SHALL be preserved unchanged.
This requirement changes prompt wording only — no classifier, verdict, or retry-budget semantics.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: timed-out attempt whose harness recorded a content FAIL

- **WHEN** one invocation window contains `agent_invoke_end.timed_out=true` and a subsequent
  `phase_verdict` with `FAIL`/`INCOMPLETE` plus a harness failure kind
- **THEN** the retry prompt SHALL present both axes and SHALL NOT claim the attempt was not a content
  failure

#### Scenario: pure timeout with no verdict for that invocation

- **WHEN** the previous attempt timed out and no `FAIL`/`INCOMPLETE` verdict exists for that
  invocation window
- **THEN** the existing pure-timeout wording SHALL be used verbatim
