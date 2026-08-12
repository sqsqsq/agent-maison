## MODIFIED Requirements

### Requirement: Business UT supports full and basic depth
The business-UT contract and `harness/scripts/check-ut.ts` SHALL resolve declared
pre-check capabilities rather than select full/basic tiers. Required UT truth checks,
acceptance coverage, and applicable toolchain gates SHALL remain governed by existing
check and phase-rule semantics. Missing artifact/derive inputs SHALL become resolved,
pruned, or blocked only through the shared capability-resolution report.

#### Scenario: Plan is absent but declared UT derivation resolves
- **WHEN** business UT has source and acceptance context but a plan artifact source is absent
- **AND** its declared derive provider resolves test scope from diff scope and module catalog
- **THEN** the report SHALL record the attempted artifact and selected derivation, and UT truth gates SHALL retain their existing PASS criteria

### Requirement: Device testing supports artifact and adhoc case inputs
The device-testing contract SHALL declare artifact/derive inputs for normalized test
cases and static testing gates. `harness/scripts/adhoc-device-test.ts` and the
feature-phase testing path SHALL continue to share case normalization. Build, install,
device run, trace, and evidence facts SHALL remain in the existing runtime pipeline,
not in the pre-check capability report.

#### Scenario: Explicit adhoc cases resolve before device execution
- **WHEN** device testing receives explicit adhoc case text instead of an acceptance artifact
- **THEN** a goal requirement SHALL NOT be coerced into that input, and a normalized empty
  input or one-case input with fewer than two steps and no expected result SHALL remain
  absent rather than resolve
- **AND** supported explicit adhoc cases SHALL record the selected derive source while
  device build/install/run continues through the existing runtime holder and truth gates

### Requirement: Code review supports explicit basic depth
The code-review contract and checker SHALL use declared source resolution for its
pre-check inputs. A non-UI visual capability SHALL be not applicable only through
capability applicability preflight; absent optional review inputs SHALL be disclosed
through the shared resolution report and assess degradation output rather than a
review-local depth label or quality-axis mutation.

#### Scenario: Review lacks an optional input
- **WHEN** a declared prune-policy review capability cannot resolve an optional input
- **THEN** the report SHALL record a pruned outcome for assurance and assess disclosure
- **AND** the mapped quality axis SHALL remain determined solely by the checker results
### Requirement: Degradation never weakens truth semantics
Capability resolution SHALL alter assurance and observed degradations only; it MUST
NOT turn FAIL, INCOMPLETE, external blocking, device policy, toolchain outcomes, or
applicable phase truth gates into PASS. A blocked capability MUST additionally clamp
the projected verdict to at least `INCOMPLETE` and release readiness to `BLOCKED`.

#### Scenario: External device condition blocks testing after capability resolution
- **WHEN** device testing resolves all pre-check capabilities but cannot establish a required device condition at runtime
- **THEN** it MUST retain the existing external-block verdict regardless of assurance

#### Scenario: Blocked capability shares an otherwise passing visual axis
- **WHEN** other visual checks pass but an applicable fail-policy visual capability is blocked
- **THEN** the phase MUST NOT produce a PASS closure
