## ADDED Requirements

### Requirement: Harness-derived records and phase notes live outside the artifact inventory by design

`specs/artifact-schemas/inventory.yaml` describes skill-authored narrative artifacts and explicitly excludes harness summaries, receipts, traces and evidence manifests. The feature tree therefore legitimately contains output that the inventory does not and SHALL NOT describe, including the harness-derived `visual-debt.json` / `visual-debt.md` ledger, the `revalidation.json` execution record, and each phase's `notes.md`. Absence from the inventory SHALL NOT restrict writing these paths, SHALL NOT be interpreted as a permission failure, and SHALL NOT be compensated for by registering them as phase-owned artifacts or by adding a file-name exclusion list to the write boundary. Their correctness remains governed by their own consumers: a corrupt visual debt ledger still fails closed on read, and gates still recompute every authoritative artifact rather than checking existence.

Enforcement: `specs/artifact-schemas/inventory.yaml`, `harness/scripts/utils/visual-debt.ts`, `harness/scripts/utils/revalidate.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: the harness writes its debt ledger during a phase

- **WHEN** a phase skill runs the harness in-process and the harness derives and writes the feature-root visual debt ledger
- **THEN** the write SHALL be permitted and recorded as an unattributed observation, and the run SHALL NOT halt for missing ownership

#### Scenario: an agent writes phase notes as instructed

- **WHEN** a phase skill instructs the agent to record WARN/UNKNOWN observations in `<phase>/notes.md`
- **THEN** the write SHALL be permitted despite the file being outside the inventory, and no gate, closure or write boundary SHALL block it

#### Scenario: a corrupt ledger is still rejected

- **WHEN** `visual-debt.json` exists but cannot be parsed
- **THEN** the reader SHALL fail closed on the corrupt content rather than treating the ledger as absent, independently of any write-boundary decision
