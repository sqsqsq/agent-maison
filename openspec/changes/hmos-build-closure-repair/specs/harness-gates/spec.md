## ADDED Requirements

### Requirement: HMOS installation artifacts are product-bound and paired

HMOS formal testing, install-current-build and UT installation SHALL adopt only a signed HAP belonging to the explicitly resolved product. Main application discovery SHALL support build/<product>/outputs/default and outputs/<target>; UT SHALL use outputs/ohosTest. Another product SHALL NOT be a fallback. The selected signed file SHALL be checked against the same module/output directory/basename unsigned file. An older signed file SHALL be rejected as stale; missing/unreadable pairing SHALL retain an unknown validation gap and SHALL NOT become an installation path. Diagnostic unsigned enumeration SHALL NOT act as the selected signed file's input. Process failure/timeout SHALL NOT be overridden by disk artifacts; nonfatal ERROR text SHALL NOT alone negate process success. Pure coding/compile/HAR checks SHALL NOT acquire a signed HAP requirement.

#### Scenario: Silent signing failure leaves an old signed file
- **WHEN** Hvigor exits zero with its required success marker but the paired unsigned is newer
- **THEN** formal testing, current-build adhoc and UT SHALL refuse adoption/installation and retain the candidate, paired paths/mtimes and original build log
- **AND** unknown pairing SHALL also refuse adoption without claiming signing-service failure or mandatory operator action

#### Scenario: Product and target are different dimensions
- **WHEN** selected product demo has outputs/default or outputs/customTarget, or only another product has a signed file
- **THEN** valid demo layouts SHALL be supported and the other product SHALL NOT be adopted

#### Scenario: Legal incremental output remains unchanged
- **WHEN** source mtime changed but the real successful incremental build leaves an older valid signed/unsigned pair unchanged
- **THEN** the pair MAY be adopted without requiring either file to be newer than build start

> **Enforced by:** `profiles/hmos-app/harness/hvigor-runner.ts`, `profiles/hmos-app/harness/hdc-runner.ts`, `profiles/hmos-app/harness/providers/device-test-build.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/adhoc-repair-diagnosis.ts`

### Requirement: HMOS package reuse binds the current package and dimensions

Main application direct reuse SHALL read only the existing device-test-build.result.json in the current invocation's report directory before replacing it. A reusable successful build/result SHALL bind actual product/buildMode, current candidate path and full SHA256 from computeHapSha256Full, with source freshness and current pairing valid. Missing/legacy/unreadable/mismatched records SHALL trigger normal build, never a new wait gate or guessed dimensions. The installation build SHALL enforce its frozen product/buildMode after configurable extraArgs so an actual release/other-product invocation cannot be recorded as debug/the requested product; ordinary coding configuration overrides SHALL remain available. Build completion SHALL rediscover and validate artifacts without falling back to a prebuild path. Failed/unvalidated output SHALL NOT become a reusable success. UT same-call build reuse SHALL remain buildMode=test and bind its existing collector result to module/product/task/target and current signed path/digest; it SHALL NOT consume main application reports or debug/release semantics.

#### Scenario: IDE replaces the same path or release follows debug
- **WHEN** the current HAP content differs from the old digest or the requested buildMode differs from its record
- **THEN** direct reuse SHALL be refused and normal Hvigor build SHALL run

#### Scenario: Current evidence is valid
- **WHEN** successful record, dimensions, path/content, source freshness and pairing agree
- **THEN** the current HAP MAY be reused without a new build merely for report generation

> **Enforced by:** `profiles/hmos-app/harness/device-test-build-reuse.ts`, `profiles/hmos-app/harness/providers/device-test-build.ts`, `profiles/hmos-app/harness/hvigor-runner.ts`, `profiles/hmos-app/harness/providers/ut-run.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`

### Requirement: HMOS invocation records actual environment without changing Java priority

The CLI version probe and actual build SHALL use the same existing spawn-plan selection, environment construction and Windows quoting under the same configuration. Explicit wrapper/Node driver selection SHALL be respected. Effective JAVA_HOME selection and DevEco JBR PATH precedence SHALL remain unchanged. Invocation facts SHALL distinguish JAVA_HOME from the first Java resolved under the child PATH (or unknown), without claiming observed signing subprocess execution or compatibility. SDK paths, entry/cwd/args, daemon flags, exit/timeout/startup errors and log paths SHALL be retained without whole-environment or secret disclosure. Main application packaging for installation SHALL use no-daemon while retaining normal parallel/incremental settings and SHALL NOT claim a preceding daemon stop succeeded. UT and pure compile SHALL retain existing config/goal/recovery daemon policy.

#### Scenario: Valid old JAVA_HOME and JBR PATH differ
- **WHEN** the retained JAVA_HOME resolves a valid older installation while JBR/bin is first in the child PATH
- **THEN** both facts SHALL be reported separately without overriding either selection or inferring a signing-service root cause

#### Scenario: Space-containing installation and daemon policy
- **WHEN** Node or an explicit wrapper is installed under a path with spaces
- **THEN** probe and build SHALL start using their shared quoting/driver; main application installation packaging SHALL retain incremental with no-daemon while UT policy remains unchanged

> **Enforced by:** `profiles/hmos-app/harness/hvigor-runner.ts`, `harness/scripts/utils/personal-setup-gate.ts`, `profiles/hmos-app/harness/providers/device-test-build.ts`
