# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Windows headless agent invokes run inside a kill-on-close Job under a single-owner guardian

On Windows, a real (non-dry-run) headless agent invoke SHALL be launched by the PowerShell guardian
(`agent-guardian.ps1`, P/Invoke; zero added binaries) in this order: create the Job object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set, create the agent process suspended, assign it to the Job,
and only then resume it — there SHALL be no window in which the agent can execute user code outside
the Job. The guardian SHALL be the only long-lived holder of the Job handle (no handle copy to the
runner or the agent), SHALL wait on both the runner (SYNCHRONIZE) and the agent: a vanished runner
triggers `TerminateJobObject`, a killed guardian lets the OS close its handle (the last one → whole-
tree kill), and a normal finish closes the Job after the agent exits (residual descendants killed).
Agent stdout/stderr/stdin SHALL be inherited handle-wise so the runner's existing consumption pipes
keep working; the guardian SHALL never write to the agent's stdout. On Windows unattended the
failure to establish containment SHALL fail the invoke closed (no WARN-and-continue), and an
invoke whose guardian identity cannot be fully verified (process identity, executable, argv token)
SHALL also fail closed. Non-Windows / attended / dry-run behavior stays unchanged.

Enforcement: `harness/scripts/utils/agent-guardian.ps1`, `harness/scripts/utils/agent-containment.ts`,
`harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: a hard-killed runner cannot leave an uncontained agent tree

- **WHEN** the runner process is hard-killed while the agent is running
- **THEN** the agent tree SHALL be terminated (guardian closes the Job; OS kill-on-close covers a
  killed guardian), leaving no surviving shell or CLI descendants

#### Scenario: containment setup failure on Windows unattended stops the invoke

- **WHEN** the guardian cannot create the Job, assign the suspended process, or resolve the agent
  binary
- **THEN** the invoke SHALL fail closed (non-zero exit, no agent resume, diagnostic on stderr), and
  the runner SHALL NOT continue as if the agent was contained

### Requirement: Controlled guardian takeover is identity-bound, event-sourced, and never guessed

Each Windows invoke SHALL record `agent_process_bound` (the guardian's ManagedProcessIdentity tuple:
pid, OS start time for strict equality, absolute executable path, and the explicit `run_id/invoke_id`
token carried in the guardian argv) and a closing `agent_process_settled` event. Resuming a run SHALL
reconcile unclosed bounds against a read-only process probe: a vanished guardian SHALL be treated as
Job-already-closed (no reclamation needed); a strictly matching live guardian SHALL be reclaimed only
after the old owner is confirmed dead and a new epoch is in effect, by terminating the guardian alone
so the Job closes and kills all descendants (no per-process tree kill), emitting `orphan_reclaimed`;
an identity mismatch or unverifiable command line SHALL be warned about without killing or blocking;
a matching guardian that cannot be terminated SHALL block the resume. A run with invoke history but
no `agent_process_bound` events at all (pre-3.0 legacy run) SHALL fail closed with a manual-cleanup
prompt. `goal-status` SHALL remain read-only: it may report unclosed invokes and guardian liveness
but SHALL never reclaim. `goal-supervise` SHALL keep backing off while the old owner (guardian) is
alive, SHALL refuse to raise legacy runs, and SHALL append `--force-resume` only after confirming the
old owner is dead (guardian gone), preserving the runner-side cooldown semantics.

Enforcement: `harness/scripts/utils/goal-containment-reconcile.ts`, `harness/scripts/goal-runner.ts`,
`harness/scripts/goal-supervise.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: resume on a legacy run without any bind events refuses safely

- **WHEN** a resume is attempted on a run whose events contain `agent_invoke_start` rows but no
  `agent_process_bound`
- **THEN** the runner SHALL refuse with a manual-cleanup BLOCKER (no guessing, no auto-reclaim) and
  the supervisor SHALL NOT auto-raise it

#### Scenario: a strictly matching leftover guardian is reclaimed as a unit

- **WHEN** a resume finds an unclosed bound whose guardian probe matches pid/start-time/executable
  and whose command line contains the recorded token, while the old owner is dead
- **THEN** the runner SHALL terminate that guardian only, rely on the Job close to kill the whole
  tree, confirm the guardian vanished, and record `orphan_reclaimed`

#### Scenario: status stays read-only

- **WHEN** a run has an unclosed bound and the operator runs `goal-status`
- **THEN** the snapshot SHALL report the unclosed invoke and guardian liveness and SHALL perform no
  reclamation side effect