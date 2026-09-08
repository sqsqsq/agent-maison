# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: On-device rendered visibility is a debt-gated observation

A device-side check SHALL compare rendered regions against the screenshot using its calibrated deterministic observations and write machine-derived visual debt. A hit ("node present, pixels invisible") SHALL be expressed as a `MAJOR` `FAIL` — a defect, not a disclosure (plan a3f7c1d9 D3(e): defects FAIL, disclosures WARN): it MUST NOT be raised to `BLOCKER`, so it is not counted by the phase verdict or the summary blockers (both count only `BLOCKER` FAIL) and the phase still advances; its findings enter the visual-debt ledger, and an open required debt SHALL keep the testing visual axis unclosed and release blocked; it SHALL close only after source/binding/render evidence verifies the fix. New debt MUST NOT enter an accepted-by-human state, and no receipt SHALL clear it. Optional low-confidence observations (`unknown` regions) remain advisory according to the existing calibrated policy and SHALL NOT be reported as hits.

Enforcement: `profiles/hmos-app/harness/render-visibility.ts`, `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: accepted metadata cannot clear an invisible asset

- **WHEN** a current rendered-visibility finding remains open but legacy accepted-by metadata exists
- **THEN** current projection SHALL keep the required visual axis unclosed

#### Scenario: an invisible region is a MAJOR FAIL that blocks release through the ledger, not the phase verdict

- **WHEN** `render_visibility_calibrate` finds an Image node whose region is invisible in the screenshot
- **THEN** the check result SHALL be `MAJOR` / `FAIL`, the phase verdict SHALL still be `PASS` with no summary blocker for it, the ledger SHALL hold an open `debt:render_visibility_calibrate:<screen>` entry, and the testing visual axis SHALL be `UNVERIFIED` with release `BLOCKED`
