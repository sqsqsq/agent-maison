# goal-runner Spec Delta

## ADDED Requirements

### Requirement: WAITING-projected halts revalidate before re-invoking the agent

On `--resume`, for a run whose latest `phase_halt` carries a `run_disposition` projection of `WAITING`, the runner SHALL derive a validation-only eligibility from the existing event stream — and when eligible, SHALL skip re-invoking the agent for that phase and proceed directly to the gate harness (performing the same verification that normally follows an agent attempt), reusing the phase's last settled invocation identity. The eligibility derivation SHALL consume only the existing `run_disposition` projection and event shapes, never re-classify by `halt_reason`, and SHALL NOT use `INCIDENT_REGISTRY.class` as a criterion (class expresses responsibility, not whether the agent completed; the operator class includes 8 structurally terminal incidents). Eligibility SHALL require all of: the latest `phase_halt` has `run_disposition === 'WAITING'`; the phase's latest execution event (`agent_invoke_start` / `agent_process_settled` / `phase_verdict`) is a valid `agent_process_settled` (non-empty `invoke_id`, not `timed_out`, not `kill_reason === 'agent_timeout'`); a `harness_end` for the same `invoke_id` exists after that settled and before the halt; and no newer `agent_invoke_start` / `agent_process_settled` / `phase_verdict` exists for that phase after the settled; and no newer `phase_backtrack_requested` or `phase_invalidated` exists after that halt (a newer backtrack/invalidation window takes priority — eligibility then belongs solely to the existing invalidation replay, so a stale halt must not override it). When any requirement fails — non-`WAITING` projection, missing projection, or incomplete event window — the runner SHALL NOT derive validation-only eligibility from that halt; subsequent behavior SHALL be left entirely to the existing resume/invalidation path (which may independently derive validation-only eligibility from a newer window's settled). This change SHALL NOT derive validation-only eligibility for non-`WAITING` projections, and SHALL NOT modify terminal semantics or the manual resume contract (`checkTerminalResumeGuard` cooldown and `--force-resume`); no new event types, state machines, ledgers, or receipts are introduced. Enforcement: `harness/scripts/goal-runner.ts`

#### Scenario: a waited halt whose agent already finished revalidates without re-invoking

- **WHEN** a run halted with `run_disposition: WAITING` (e.g. `repair_adjudication_pending`) after
  its phase's agent process settled with a valid `invoke_id`, a `harness_end` for the same invoke
  followed, and no newer execution event exists
- **THEN** resuming skips the agent invoke for that phase, runs the gate harness exactly once with
  the original invoke identity, and either PASSes through the existing closure owner or halts again
  without burning agent time

#### Scenario: a FAIL verdict or newer invoke after settled denies eligibility

- **WHEN** a `phase_verdict` with `FAIL`, a newer `agent_invoke_start`, a timed-out/killed settled,
  a settled without `invoke_id`, a halt without a `WAITING` projection, a `TERMINAL` /
  `RECOVERY_PENDING` projection appears in the window, or a newer `phase_backtrack_requested` /
  `phase_invalidated` appears after the halt
- **THEN** the runner does not derive validation-only eligibility from that halt; the outcome is
  left entirely to the existing resume/invalidation path (which may still independently derive
  validation-only eligibility from a newer window)