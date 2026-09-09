# goal-runner Spec Delta

## MODIFIED Requirements

### Requirement: Headless auto-decisions are recorded in a schema-validated JSONL ledger

The unattended prompt block SHALL be injected only for the **detached** execution shape. Its mode segment — the headless declaration, the effective approval mode, "MUST NOT stop to ask", the override of every phase SKILL stop-and-ask instruction, and the per-gate auto-resolution with its ledger instruction — SHALL NOT be injected for an attended run. The gate-integrity red lines and the deterministic-detector segment SHALL be injected in both shapes, with their text unchanged. An attended run SHALL instead be told plainly that a session owner is present and that the phase SKILL's stop-and-ask confirmations execute as written and are relayed by the executor bridge; it SHALL NOT be given any wording that widens scope or invites asking in place of doing the work. The injection SHALL be driven by the runtime's existing executor mode, which is already constrained so that an attended executor implies a session owner; no new environment variable, driver or run-control read SHALL be introduced for it.

The unattended prompt MAY record deterministic/default decisions in `<phase>/headless-assumptions.jsonl` for audit, with markdown as a human projection. The prompt SHALL describe that ledger as an audit trail that is not authorization, and SHALL NOT claim that a gate without a ledger line fails phase closure — that veto is retired and its only remaining consumer is an advisory, non-gating check. Ledger `must_review` and user-like source strings SHALL be legacy/report-only and MUST NOT cap run status, advance a phase, authorize a gate change, or block completion. A decision requiring genuine external authority SHALL be represented by the existing external prerequisite state, while a quality uncertainty SHALL remain repair, UNVERIFIED/FAIL, optional advisory, or capability defer.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: historical must-review does not pause a run

- **WHEN** a legacy assumptions ledger has unresolved `must_review=true` rows
- **THEN** they SHALL appear in diagnostics only and current machine gates SHALL determine the run outcome

#### Scenario: an attended phase prompt does not forbid asking

- **WHEN** a phase prompt is built for an attended run
- **THEN** it SHALL NOT contain the unattended mode segment
- **AND** it SHALL still contain the gate-integrity red lines and the deterministic-detector segment

#### Scenario: a detached phase prompt is unchanged apart from the ledger wording

- **WHEN** a phase prompt is built for a detached run
- **THEN** it SHALL contain the unattended mode segment as before
- **AND** its ledger line SHALL describe an audit trail rather than a phase-closure veto
