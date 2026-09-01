## MODIFIED Requirements

### Requirement: Current integrity blockers halt without reviving framework Git adjudication

Current, machine-produced integrity blockers such as process preload injection SHALL continue to classify through the existing `framework_integrity_block` / framework-fault safety path and halt without asking an agent to tamper with framework or gate artifacts. `phase_write_violation` owner invalidation/backtrack semantics SHALL remain unchanged.

Framework Git state SHALL NOT produce an integrity blocker in a new run. New runs SHALL NOT produce `framework_integrity`, `framework_control_plane_dirty`, or any retired manifest/hash subtype. Historical summaries containing old `framework_integrity`, `framework_drift`, `framework_foreign_file`, manifest subtypes, or `integrity_subtypes` SHALL remain readable provenance and SHALL NOT be rewritten or used as current classification, halt, retry, continuation-prompt, or recovery input.

Current integrity classification SHALL recognize only the current producer `node_options_injection` with `process_injection` (including its top-level summary projection). Before a continuation reads a stored summary, retired framework integrity blockers SHALL be removed from the current-decision view. If nothing current remains, no prior failure context SHALL be injected; the phase SHALL revalidate with the current release. A stale/fresh historical framework summary SHALL never classify as `framework_integrity_block` and SHALL not fall through to code-regression guidance.

For every current attempt, the runner SHALL derive exactly one filtered `decisionSummary` from the raw summary. Classification, blocking meta, affected files, effective blocker signature, no-progress/actionability, repair candidates, reconcile observation, and newly emitted phase event fields SHALL consume `decisionSummary` only. The raw summary MAY be retained for verdict/closure/visual receipt and historical rendering, but retired framework integrity rows SHALL NOT appear in a current signature, meta, repair/reconcile input, event field, or no-progress halt. Mixed historical+content summaries SHALL retain only the content decision inputs.

Guidance and goal reports SHALL be source-sensitive: current process integrity guidance SHALL describe the current blocker; historical subtype text MAY be shown as legacy provenance. Generic guidance SHALL NOT claim that a framework file list exists, require a host commit, or advertise allowlist/restore/redeploy as a universal resolution.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/await-confirm-guidance.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: Process injection still halts

- **WHEN** a new summary contains `node_options_injection` with `blocking_class=integrity` and `classification=process_injection`
- **THEN** goal-runner SHALL preserve the existing integrity halt semantics

#### Scenario: Framework Git state creates no blocker

- **WHEN** the installed release is dirty, staged, committed, untracked, or non-Git
- **THEN** goal-runner SHALL receive no framework-Git integrity result and SHALL NOT halt for that state

#### Scenario: Historical framework integrity is readable

- **WHEN** a stored historical summary contains retired framework integrity classifications
- **THEN** parser/renderer MAY display them as legacy provenance, but classifier/continuation SHALL ignore them and revalidate the phase without halt or code-regression guidance

#### Scenario: Historical framework integrity cannot leak downstream

- **WHEN** a current attempt reads a legacy-only or legacy-plus-content summary
- **THEN** legacy integrity SHALL contribute no blocker signature, blocking meta, affected file, repair/reconcile input, phase event field, or no-progress halt; a mixed summary SHALL retain only the content contribution

#### Scenario: Downstream feature write recovers

- **WHEN** a phase changes an owner-resolvable feature artifact once and bytes are stable/readable
- **THEN** the runner SHALL invalidate trust and backtrack to the owner rather than treating it as a permanent framework-integrity halt
