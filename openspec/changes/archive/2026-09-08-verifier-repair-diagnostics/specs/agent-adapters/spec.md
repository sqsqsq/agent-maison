# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: The verifier subagent dispatches on an issued request, not on a passing script gate

The dispatch precondition carried by the verifier subagent template, the phase-executor template, the Stop hook guidance and the six feature Skills SHALL be "the harness issued a verifier request for this round", not "the script gate passed". The two coincide on every ordinary round; they differ exactly on the two diagnosable product failures the harness deliberately releases, and a precondition written as "script FAIL means never dispatch" makes the framework's own request undispatchable.

The verifier's default handling of a failing script gate SHALL be unchanged: it collapses to the compile/run gate FAIL and does not grade the remaining items. That default SHALL be overridden only by the diagnosis section present in the assembled prompt, which the harness writes only when it issued the request itself. A round with no such section and no passing script gate SHALL still be treated as a protocol violation by the caller.

Absence of a request SHALL keep its three existing meanings — capability not enabled, adapter without a reviewer, script not yet passing — and the dispatcher SHALL consult `summary.next_action` rather than inferring from the absence alone.

No adapter capability declaration changes. `verifier_subagent` remains the single boolean, and the adapters that share `agents/claude/templates/agents` inherit the amended templates unchanged.

Enforcement: `agents/claude/templates/agents/verifier.md`, `agents/claude/templates/agents/phase-executor.md`, `agents/claude/templates/hooks/check-phase-completion.mjs`, `agents/codeagent/adapter.yaml`, `skills/feature/*/SKILL.md`

#### Scenario: A diagnosis request is dispatched despite the failing gate

- **WHEN** `summary.next_action` is `run_verifier_for_repair` and `summary.verifier_request` is present
- **THEN** the dispatcher SHALL deliver the request verbatim, write the reply verbatim to `summary.verifier_report`, and SHALL NOT edit product source before reading the per-issue conclusions

#### Scenario: A failing gate with no request is still not dispatchable

- **WHEN** the script gate fails and no request was issued
- **THEN** the dispatcher SHALL fix the blockers and re-run, and SHALL NOT hand-write a request to reach the verifier

#### Scenario: A shared-template adapter inherits the amended precondition

- **WHEN** an adapter declares `template_dir: ../claude/templates/agents`
- **THEN** its materialized verifier and phase-executor templates SHALL carry the same dispatch precondition with no adapter-specific text
