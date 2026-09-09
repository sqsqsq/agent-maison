# feature-artifact-layout Spec Delta

## MODIFIED Requirements

### Requirement: Visual debt lives in a harness-derived JSON ledger with a markdown projection

`doc/features/<feature>/visual-debt.json` SHALL be the machine truth for visual debt, derived by the harness from current asset, ui-spec, deterministic visual, provider, materialization, and render-visibility evidence — never agent-authored. Entries carry stable identity, source check, optional asset/screen identity, severity, status `open|closed`, and a machine resolution class. `closed` means the source check settled in the current round: PASS (fixed and reverified) or WARN (the finding is now disclosure, not debt — plan a3f7c1d9 D3(b)); a FAIL or a non-`MINOR` SKIP of the source keeps or opens the entry, and a round with only `MINOR` SKIP hits or no hit for the source leaves history unchanged. There is no `accepted` quality-bypass state and new entries MUST NOT carry `accepted_by` or `acceptance_receipt`. `visual-debt.md` is a human projection only. Open required debt maps to the existing quality axes and blocks release at the testing release point; optional unverified debt remains advisory only where existing release policy permits it.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`, `harness/scripts/check-testing.ts`

#### Scenario: a user name cannot close visual debt

- **WHEN** an open visual debt entry has legacy acceptance metadata but its source check has not settled under the four-state rule in the current round (no PASS or WARN; only FAIL, non-`MINOR` SKIP, or absence)
- **THEN** the entry SHALL remain open for current projection and release SHALL remain blocked when the axis is required
- **AND** the legacy acceptance metadata (a user name or receipt) SHALL NOT by itself close the entry

#### Scenario: a WARN settles the entry, a non-MINOR SKIP does not

- **WHEN** an open entry's source check reports WARN in the current round
- **THEN** the entry SHALL be `closed` and SHALL NOT count toward blocking debt
- **AND** when the same source instead reports SKIP with severity `BLOCKER`, the entry SHALL stay or become `open` with `needs_fix`
