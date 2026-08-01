## MODIFIED Requirements

### Requirement: Summary 1.2 distinguishes verified closure, assurance, and capability provenance
`harness/schemas/summary.schema.json` and mirrored TypeScript readers SHALL support
summary 1.2 with `assurance`, normalized `capability_resolutions`, and a
capability-resolution contract fingerprint in addition to versioned
`closure_commit@1`. Each resolution SHALL preserve source-attempt provenance needed to
verify freshness. Full-track closure SHALL require the commit marker, valid manifest,
PASS-compatible projected verdict, and the existing blocker constraints.

`summary.depth` and quality-depth protocol fields SHALL NOT coexist with assurance in
3.0.0 persisted output. Legacy summaries without the new protocol SHALL be
non-qualifying until regenerated or explicitly validating-migrated.

#### Scenario: Summary contains a derive fallback after absent artifact
- **WHEN** a phase resolves a derive source after an earlier artifact attempt is absent
- **THEN** summary capability resolution data SHALL retain the absent attempt and selected derive provenance

#### Scenario: Summary has blocked capability
- **WHEN** an applicable fail-policy capability is blocked
- **THEN** summary projection SHALL be at least INCOMPLETE and closure finalization SHALL reject PASS closure

## ADDED Requirements

### Requirement: Capability-resolution freshness participates in evidence closure
The closure finalizer SHALL add only project-local applicability-provider and every
actual source-attempt dependency through the resolving or invalid terminating attempt
to phase evidence manifest inputs. The existing missing-file representation SHALL be
used for absent paths. The contract fingerprint SHALL remain in the report, summary,
and closure identity, but a framework contract file path MUST NOT enter a consumer
feature manifest or make historical feature closure stale.

> **Enforced by:** `harness/scripts/utils/phase-evidence-manifest.ts`,
> `harness/scripts/utils/gate-fingerprint.ts`,
> `harness/scripts/utils/phase-closure-finalizer.ts`, and fixtures.

#### Scenario: Missing high-priority source appears after closure
- **WHEN** a project-local source recorded missing before a selected fallback becomes present
- **THEN** evidence validation SHALL fail freshness and closure SHALL become stale

#### Scenario: Framework contract is upgraded after consumer closure
- **WHEN** a consumer feature has a closed phase and its framework contract file changes
- **THEN** the feature manifest SHALL remain fresh; the recorded contract fingerprint remains historical closure provenance

### Requirement: Capability outcomes project only blocked states into the quality lattice
Quality-axis derivation SHALL consume the pre-check capability report. Pruned states
SHALL remain explicit only in assurance, resolution provenance, report disclosure, and
assess observed degradations; they SHALL NOT alter a mapped axis, its resolution, phase
advance, closure, release readiness, or completion status. Blocked states SHALL force
mapped-axis UNVERIFIED, release BLOCKED, and projected verdict INCOMPLETE regardless
of visual/asset advance exemptions. An explicit minimum assurance floor MAY produce an
assess gap for a pruned degradation but MUST NOT weaken blocked projections.

#### Scenario: Pruned asset capability leaves quality axes unchanged
- **WHEN** an applicable asset capability is pruned
- **THEN** its quality axes, projected verdict, release readiness, and completion status
  SHALL equal the same check set with no pruned capability report
#### Scenario: Blocked capability cannot use visual advance exemption
- **WHEN** a blocked visual capability is otherwise in an advance-exempt axis
- **THEN** projected verdict SHALL still be INCOMPLETE

### Requirement: Runtime capability consumption is checked after phase execution
After a checker produces its results, the phase runner or checker finalization SHALL
invoke a pure capability-consumption assertion. It SHALL require exactly one same-ID
check for each active resolved capability, zero for all other capability states, and
contract-owned axis mapping for every capability-backed check.

#### Scenario: Duplicate check IDs for a resolved capability
- **WHEN** a resolved capability produces two same-ID check results
- **THEN** phase finalization SHALL fail the runtime consumption assertion