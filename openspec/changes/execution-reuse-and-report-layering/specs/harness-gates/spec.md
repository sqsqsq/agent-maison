# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: Device execution is keyed by real execution inputs

Testing SHALL compute `execution_key = sha256(HAP full digest, run-copy derived plan digest, device identity and available display environment, reset mode, Hylyre/profile/provider/tool-config versions, normalized execution flags)` and record it in the run metadata. Full mode SHALL inspect only the newest real attempt carrying an execution key and reuse it only when that attempt has the current key, succeeded, and has complete execution-fact evidence. A newer different-key attempt or a newest same-key failure SHALL force a real run; temporary directories without an execution-key record SHALL not participate. It SHALL NOT reuse when the user asked for a fresh run or for N stability rounds. Document wording, report text and version numbers SHALL NOT trigger device operation. `--force-device` SHALL be the only explicit escape, and it SHALL cover every keyed leg. Derived-plan freshness SHALL compare every execution/adjudication-relevant TC field (id, precondition, steps, expected result, AC links, priority and channel) while ignoring prose outside the canonical TC table; an uncomparable required column SHALL be stale.

The key SHALL also govern **UT device execution**, on the same decision formula and with a leg-scoped run directory (`<reports>/<stamp>/<leg>/`). The UT key SHALL be composed of the ohosTest HAP full digest, the selected-case set digest, the hvigor invocation fingerprint, the device and display identity, the profile name and the explicit skip flags in effect; the three per-module digests SHALL be concatenated in module-name order and hashed into one **whole-round** key, so that a change in any module forces the whole round to execute for real. Partial reuse — some modules reused, others executed — SHALL NOT be produced, because the suite ratchet's "all modules executed" and "modules with valid results" predicates must observe one and the same round. Frozen artifacts SHALL nevertheless be named per module so that restoration is per module.

Reuse SHALL additionally require that **this harness call itself produced the package**: the module SHALL have a successful build result in the current call's build collector, and that result's signed HAP digest SHALL equal the digest aggregated into the key. When either does not hold, reuse SHALL NOT be consulted at all and the round SHALL build and execute for real, so that changed test sources with a stale HAP on disk cannot skip both compilation and execution.

Because the decision inspects only records that exist, a round SHALL record a non-success attempt under the current key **before** it dispatches execution, and overwrite it with the round's real outcome afterwards. A round that fails, is killed, or throws therefore leaves a non-success record as the newest one, and an earlier success SHALL NOT be reachable as "the newest attempt". A partial failure (some modules failed) SHALL be recorded as a whole-round failure. When the pre-dispatch record cannot be written, the round SHALL NOT consult reuse and SHALL disclose that in the check details.

"Complete evidence" SHALL be defined per leg and SHALL be split into two groups. **Execution-fact** artifacts (the trace and run metadata for the testing leg; the per-module result and device log for the UT leg) SHALL be required: a missing one refuses reuse and forces a real run. **Derived** artifacts (timing projections) SHALL NOT by themselves refuse reuse: they SHALL take the rebuild channel, and only a rebuild that still fails to close SHALL fall back to a real run, fail-closed. The `timing_complete` field SHALL carry "derived evidence complete" with a leg-specific meaning, documented in the record's schema and in the migration notes.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/utils/native-trace-binding.ts`, `profiles/hmos-app/harness/execution-key.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`, `profiles/hmos-app/harness/hdc-runner.ts`, `profiles/hmos-app/harness/device-test-evidence.ts`, `profiles/hmos-app/harness/build-fingerprint.ts`

#### Scenario: Only the latest real attempt can be reused

- **WHEN** attempts are A(key-1 success), B(key-2 success), and the current key is key-1
- **THEN** testing SHALL run the device instead of reaching back past B to reuse A

#### Scenario: A later failure is never hidden by an earlier pass

- **WHEN** two attempts share a key and the later one failed
- **THEN** the earlier pass SHALL NOT be reused

#### Scenario: A crashed round does not leave an earlier success as newest

- **WHEN** a UT round writes its pre-dispatch non-success record and then throws before writing a result
- **THEN** the next round SHALL read that non-success record as the newest same-key attempt and SHALL execute for real

#### Scenario: One changed module forces the whole round

- **WHEN** two ohosTest modules were reused before and only the second module's selected cases changed
- **THEN** the whole-round key SHALL differ and both modules SHALL be executed for real

#### Scenario: A stale package on disk cannot skip compilation

- **WHEN** test sources changed, no build ran in this call, and the previously signed HAP is still on disk with an unchanged digest
- **THEN** reuse SHALL NOT be consulted and the round SHALL build and execute for real

#### Scenario: A missing derived copy does not force a device rerun

- **WHEN** the newest same-key attempt succeeded and only its frozen timing copy is missing
- **THEN** the run SHALL be reused with a rebuild requirement, and only a rebuild that cannot close SHALL fall back to a real run

### Requirement: Report-only reconciliation fully recomputes testing projections without a device

`--report-reconcile-only` SHALL read the existing authoritative trace, plan, timing, metadata and current inputs, regenerate the machine report, and recompute report/static gates, summary, quality axes and repair candidates without invoking hvigor, hdc, Hylyre, device or provider execution, visual capture or lifecycle hooks. The verifier subject SHALL follow the reviewed material only; a regenerated report changes the subject only when its machine content changed.

Reconciliation SHALL distinguish **execution-fact** gaps from **derived-statistic** gaps. An execution-fact gap — anything that unsettles which package, which device, which run or which cases really executed, including source metadata that is itself missing or malformed — SHALL remain a BLOCKER FAIL. A derived-statistic gap — a timing file that is missing or stale, a pipeline duration projection, a case duration row, a report body that disagrees with timing — SHALL first be **rebuilt** from the trace and the source metadata using the existing timing collector and report generator; only a gap that still fails to close after the rebuild SHALL be reported with `status` WARN at unchanged BLOCKER severity, `failure_kind` naming an unavailable derived statistic, and details stating explicitly that the statistic is UNKNOWN and does not constitute an execution-fact conclusion. Neither branch SHALL trigger any device, hvigor, hdc or Hylyre invocation, and no new check id, status member or severity SHALL be introduced.

A gap in the raw result protocol SHALL NOT be treated as a derived-statistic gap: a v1 result missing a schema-required field, including a step duration, SHALL continue to be refused by the frozen-schema gate as an unsupported result protocol.

Unmeasured derived values SHALL be represented as `null` in data and as the report's existing empty-value placeholder in report cells; the literal `UNKNOWN` SHALL appear only in check details and in report note columns, never in a cell the duration parser reads. A value that was genuinely measured as zero SHALL keep its numeric form. Duration reconciliation SHALL accept an empty-value placeholder exactly when the reconciled value is `null`, and SHALL compare numerically only when it is not.

Performance acceptance criteria SHALL NOT have their durations supplied by the rebuild path. A test case whose plan row links an `NFR-*` identifier that is declared in the feature spec's performance acceptance list SHALL keep its duration gaps in the execution-fact bucket, recognised before any rebuild runs. When either side is absent the performance set is empty and no case is promoted.

Enforcement: `harness/scripts/check-testing.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/testing-trace-gates.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `profiles/hmos-app/harness/test-report-writer.ts`, `profiles/hmos-app/harness/device-test-timings.ts`

#### Scenario: Notes do not rotate the subject

- **WHEN** only `testing/notes.md` changed since the last full run
- **THEN** report-only reconciliation SHALL leave the verifier subject unchanged

#### Scenario: A stale timing projection is rebuilt, not failed

- **WHEN** the source metadata is present and valid but the timing projection disagrees with it
- **THEN** reconciliation SHALL rebuild the timing and report PASS, without any device call

#### Scenario: An unrebuildable pipeline duration is UNKNOWN, not FAIL

- **WHEN** the run metadata has no run duration and the trace cannot supply one
- **THEN** reconciliation SHALL report WARN with an unavailable-derived-statistic failure kind, state UNKNOWN in details, and make no device call

#### Scenario: A raw protocol gap stays a BLOCKER FAIL

- **WHEN** a v1 trace step is missing its schema-required duration
- **THEN** reconciliation SHALL fail on the unsupported result protocol and SHALL NOT route the gap to the derived-statistic channel

#### Scenario: A performance case is never signed off by a rebuild

- **WHEN** a test case links a performance acceptance id and its report duration disagrees with the trace
- **THEN** the gap SHALL remain a BLOCKER FAIL naming that the performance duration must be really measured

## ADDED Requirements

### Requirement: One UT gate produces one ohosTest package per module

A single UT gate invocation SHALL build at most one ohosTest package for the same module, product and task. The build stage's successful results SHALL be handed to the test stage within the same invocation, and the test stage SHALL NOT re-invoke the build for a result it was handed. Only a build that passes the shared build-success predicate SHALL be handed over; a skipped or failed build SHALL NOT be presented as a produced package.

The compile log and metadata written by the build stage SHALL NOT be overwritten by a later stage of the same gate, and the device log of one ohosTest module SHALL NOT be overwritten by another module of the same round.

A caller that invokes the test helper directly without the build stage's results SHALL keep the previous behaviour, including its own internal build, and SHALL NOT take part in execution-key reuse.

Enforcement: `harness/scripts/check-ut.ts`, `harness/profile-host-loader.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`, `profiles/hmos-app/harness/hvigor-runner.ts`, `profiles/hmos-app/harness/hdc-runner.ts`

#### Scenario: Two modules produce two builds, not four

- **WHEN** a UT gate compiles and then executes two ohosTest modules in one invocation
- **THEN** the gate SHALL spawn the ohosTest build task exactly once per module

#### Scenario: The build stage's log survives the test stage

- **WHEN** the test stage has finished for a module
- **THEN** that module's compile log and metadata SHALL still be the ones the build stage wrote

#### Scenario: A direct test-helper call is unchanged

- **WHEN** the test helper is called without the build stage's results
- **THEN** it SHALL run its own internal build as before and SHALL NOT reuse a same-key run
