## ADDED Requirements

### Requirement: Shared responsibility resolves actual repair objects independently of the remaining queue

The harness SHALL use `harness/scripts/utils/repair-responsibility.ts::resolveRepairResponsibility` to derive the repair object, owner, introducer, legal modifier, verifier, action and reason from verified findings, Skill produces/verifies, artifact inventory, profile roots, bound inputs, original request, effective obligations and available workflow capabilities. Unknown roles SHALL remain unknown. Queue membership MUST NOT confer ownership or authorization. Consumers SHALL reuse existing current-phase repair, reopen, scope revision and design-authority continuation; no persistent responsibility registry or new recovery protocol SHALL be introduced.

#### Scenario: A missing UT queue node remains responsible
- **WHEN** a confirmed test-design defect targets a real UT output while UT is reused or absent from the remaining queue
- **THEN** the harness resolves the actual owner and the authorized existing reopen/revision action, or reports the real authorization/capability gap without assigning coding

#### Scenario: A review request does not authorize repairs
- **WHEN** the original request authorizes review only and a product defect is found
- **THEN** the result reports the owner and limitation without adding implementation or test writes

### Requirement: Coding preserves existing tests during finite compatibility repair

`harness/scripts/check-coding.ts` SHALL run one `coding_existing_test_preserved` check for coding-modified test source located by the active profile. Coding MAY repair existing imports, types, data and doubles directly broken by this implementation only while existing case definitions and assertions remain byte-identical and no test, assertion or skip/disable declaration is added. The check SHALL use real pre-repair bytes from existing Git or invocation materials; it MUST NOT replace a newer legitimate UT version with an older run baseline. Missing original bytes or uncertain parsing SHALL hand the issue to the real UT owner or disclose a capability gap. New/changed tests and assertions remain UT responsibility; true test execution signs validation independently. Contracts and guidance SHALL reside in `skills/feature/coding/contract.yaml` and `skills/feature/business-ut/contract.yaml`; coding reports disclose actual changed data/doubles and reasons without an extra gate.

#### Scenario: The 179a73 double adds required fields
- **WHEN** coding adds the newly required fields to the existing SpyBankRepository without changing or adding cases/assertions
- **THEN** preservation passes and the write is accepted as finite coding compatibility work without requiring UT to rewrite the same file

#### Scenario: A case is deleted or assertions weaken
- **WHEN** coding deletes, renames or changes an existing case/assertion, adds a new case/assertion/skip, or cannot establish the actual pre-repair source
- **THEN** preservation does not grant the finite exemption and the existing responsibility path transfers the issue to UT without converting the failure to PASS

### Requirement: Repair reentry preserves valid source provenance and the original facts owner

`harness/scripts/utils/capability-resolution-entry-input.ts` and `harness/scripts/utils/phase-write-boundary.ts` SHALL preserve legal historical observed writes through reopened obligations and carry the original establishing facts baseline whenever current byte/hash causality remains valid. Lack of new owned changes SHALL NOT erase a valid baseline. Downstream stages SHALL add only their own delta; real baseline reconstruction SHALL return to its original owner. Cross-role test bytes outside the finite allowance require a later valid UT manifest/current hash, which MAY adopt existing bytes; later unauthorized writes SHALL void that adoption through existing freshness semantics.

#### Scenario: i6 reentry has no new owned source writes
- **WHEN** the actual i6 entry state retains coding-i3 legal source hashes and i5's valid original baseline
- **THEN** baseline resolution preserves the original owner and history rather than requiring coding to recreate facts

#### Scenario: UT adopts bytes without rewriting
- **WHEN** a valid UT closure later verifies and manifests the current test hash after a wrong-role write
- **THEN** coding consumes that adoption until a later unauthorized write invalidates it; absence of adoption never grants PASS

#### Scenario: An audited successor genuinely establishes a new input baseline
- **WHEN** existing successor_of and audited supersede identify the direct predecessor that owns the facts, its baseline cannot be validly reused, and the current phase equals the new run's immutable birth first phase
- **THEN** the new birth MAY establish its own facts from actual sources while preserving predecessor records and budgets; same-run queue changes, unrelated origins and non-birth phases MUST NOT use this exception

### Requirement: Actual dependencies permit repair work without erasing negative verdicts

`harness/scripts/utils/upstream-verdict-gate.ts`, `harness/scripts/utils/execution-scope.ts` and `harness/scripts/goal-phase-runtime.ts` SHALL derive execution dependencies and invalidation from actual requires/control_edges/bindings, rather than order prefixes. UT SHALL be able to repair review findings that await UT while real production failures still return to coding. Testing and Feature completion MUST retain unresolved review/UT negatives. Refusal SHALL return with its existing evidence and unchanged accumulated budgets.

#### Scenario: Review awaits UT
- **WHEN** review has a confirmed test-design issue and coding inputs are valid
- **THEN** executable UT work receives it before repeating the waiting review, while testing/completion remain blocked until both conclusions close
