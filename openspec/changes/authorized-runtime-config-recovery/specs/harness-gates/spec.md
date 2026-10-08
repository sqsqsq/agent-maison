## ADDED Requirements

### Requirement: Content evidence excludes automatically collected runtime manifest bytes

Phase closure SHALL bind the current authoritative requirement through the existing requirement content hash and retain actual business source, scope/input, source-code, test and visual bindings. The requirement evidence collector SHALL use the current authoritative requirement context and SHALL NOT automatically add every historical run manifest or the union of every historical run's references as current content evidence. The existing runtime identity authorization, scope and budget checks MUST remain authoritative for control changes. A file explicitly declared as a business input MUST keep its actual binding; a basename or JSON suffix SHALL NOT grant a blanket exemption.

The collector SHALL retain the current requirement's dereferenced files, original requirement_source_files and existing reference-image dependencies. Existing requirement hash algorithms and previously issued hashes SHALL NOT be changed. Resolved inputs and independent inline/file/blueprint inputs SHALL use their existing actual requirement and bindings without consulting an arbitrary historical run. The legacy/no-scope completion aggregate fallback SHALL retain a current inline requirement after control paths are removed; original completion records SHALL remain unchanged and use their existing validation/recovery contract.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: A new closure does not accumulate historical control manifests

- **WHEN** a feature has multiple historical runs and a phase closes under a current run
- **THEN** the new evidence SHALL retain current business input bindings and the requirement hash without automatically recording historical run manifest file hashes

#### Scenario: Real business changes remain observable

- **WHEN** the inline requirement, an actual requirement source, acceptance/contracts, product source, test input, reference image or build changes
- **THEN** its existing responsible validation or recovery SHALL apply and previous business PASS evidence SHALL NOT be accepted solely because runtime manifest bytes have been retired

#### Scenario: A legacy completion still binds an inline requirement

- **WHEN** a run has no execution scope and its current requirement is inline without dereferenced business files
- **THEN** generating or evaluating current completion evidence SHALL retain that requirement's content identity after the collector stops returning runtime manifest paths
- **AND** no old requirement hash or completion aggregate SHALL be rewritten to manufacture equivalence

### Requirement: Legacy control dependencies use one content-evidence interpretation

After original schema and aggregate integrity checks succeed, readers SHALL interpret obsolete automatically collected same-feature run-manifest input entries as runtime control references rather than content byte bindings. They SHALL retain the current authoritative requirement/scope and business-input checks; missing semantic authority MUST NOT be treated as equivalence. The same interpretation SHALL reach phase freshness, staged closure verification, facts admission and inheritance, facts dependency verification and finalizer output, so a retired dependency cannot be reintroduced through a baseline. Original evidence, receipt, facts text, completion records and events SHALL NOT be rewritten to manufacture matching hashes. Explicit business file inputs and outputs SHALL retain their existing treatment. No new persistent schema, exception registry or parallel content fingerprint SHALL be introduced.

Retirement SHALL match canonical paths under the configured features directory and exact feature path, with run identities from the existing authoritative-run inventory. The original entry SHALL be input-only without facts, identity-neutral or source-owner semantics. Dry/bootstrap, corrupt/missing, other-feature and output/both entries SHALL NOT be retired. Existing explicit requirement/source-file, facts-source, effective-scope or resolved-input business declarations SHALL exclude their paths from retirement, including an explicitly declared canonical runtime manifest. Legacy entries have no automatic-source provenance; readers SHALL apply this bounded interpretation of the former collector's fixed control surface without inventing provenance.

Retirement SHALL require the existing current requirement algorithm to produce a value equal to the original evidence's non-null requirement_sha256, and SHALL retain existing environment, effective-scope and business-binding validation. Context SHALL come from the caller's current run/requirement or existing independent feature authority; a consumer of a specified existing artifact without another current execution identity MAY use that artifact's exact canonical summary/completion run identity. A retired path, latest historical run or null/missing argument SHALL NOT establish semantic authority. Ordinary legacy/independent paths without retired entries SHALL keep their existing contract. Facts baseline consumption SHALL retire only path/exists/hash-matching entries reconnected to the original establishing evidence, preserving recorded baseline dependencies, fingerprint, subject and invocation-window/write-chain checks. New baselines and writer/candidate-path input views SHALL not reintroduce retired entries.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`, `harness/scripts/utils/context-facts.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/upstream-verdict-gate.ts`, `harness/scripts/utils/upstream-closure.ts`, `harness/scripts/utils/revalidate.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/feature-assessment.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/component-closure-evidence.ts`, `harness/scripts/utils/scope-replan.ts`

#### Scenario: Authorized provider change resumes an existing legacy run

- **WHEN** valid legacy coding evidence contains automatically collected run-manifest byte dependencies and the sole authorized change is its visual provider
- **THEN** unchanged coding/review/ut business evidence SHALL remain reusable and testing SHALL reach visual re-evaluation without manual evidence edits or a facts rebuild caused solely by the control change

#### Scenario: Integrity failure and explicit business sources are not hidden

- **WHEN** original evidence integrity fails, current semantic authority is unavailable, or a changed manifest-like JSON file is an explicitly declared business input
- **THEN** the existing validation and responsible recovery SHALL remain effective instead of accepting a path-based exemption

#### Scenario: Missing semantic evidence leads to real recovery

- **WHEN** a changed legacy control entry cannot be retired because its recorded requirement is unbound or current semantic authority cannot be established, and a responsible earlier phase is executable in the current chain
- **THEN** the existing stale/unbound/facts check SHALL remain observable and the first recovery decision SHALL grant that phase an actual reconstruction or validation opportunity
- **AND** a damaged/transferred authority or an absent target SHALL use its existing explicit stop/continuation outcome without inventing authority or rewriting old hashes

#### Scenario: All consumers interpret the same legacy input

- **WHEN** read-only assessment, upstream gates, closure/facts verification and runtime inspect valid legacy evidence under the same current run/feature authority
- **THEN** they SHALL use the same retirement view and current requirement/scope basis, including recursive owner freshness
- **AND** an explicit business manifest, output/both entry, another feature or a missing/corrupt run SHALL retain its existing byte checks

### Requirement: A changed visual provider produces current evaluation evidence

After an authorized visual provider switch, testing SHALL use the newly frozen provider through the existing invocation and review pipeline. Existing verdict clearing, payload validation and run/attempt/image/build/reference bindings MUST remain in force. Configuration persistence SHALL NOT count as provider execution or successful visual acceptance. Functional traces and capture artifacts SHALL be reused only when their existing freshness and execution-key rules permit it. Unavailable capability, invalid output and actual product failure SHALL retain their distinct existing dispositions.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: The old provider result cannot stand in for the new evaluation

- **WHEN** the provider is changed while visual acceptance remains unfinished and old visual records are present
- **THEN** the new provider SHALL actually be invoked and only currently bound validated output SHALL support completion
- **AND** the continuous replay SHALL capture the newly resolved adapter/model and actual invocation payload at the existing provider-review external-call seam, rather than prove execution by directly writing a restored verdict

#### Scenario: New provider cannot execute or returns invalid output

- **WHEN** the new provider is unavailable or produces an invalid payload
- **THEN** the existing capability-missing or invalid-evidence result SHALL be reported without claiming completion or converting it into an unrelated coding regression
