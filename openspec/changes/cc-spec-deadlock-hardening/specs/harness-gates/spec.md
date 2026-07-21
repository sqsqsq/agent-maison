# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Summary blockers carry scalar actionability from a single registry

`CheckResult`/summary blockers SHALL support a scalar `actionability` field limited to `agent_fixable | human_only | toolchain_blocked` (no mixed value — mixed gate output is expressed by the existing separate blocker ids along the gate lifecycle). Resolution SHALL follow a single shared registry pure function (colocated with the failure classifier, reusing the existing toolchain id/blocking-class predicates — no third taxonomy) with the priority chain: explicit `actionability` on the check result → failure-kind/blocking-class compatibility mapping → default `agent_fixable`. The initial migration table SHALL at least map: `capture_completeness_external` → agent_fixable; `fidelity_deferrals_human_sign` and the awaiting-human-confirmation family (including `fidelity_capability_pregate`, `capability_missing_strong_intent`, `await_human_fidelity_tier`) → human_only; `capture_completeness_external_ocr_unavailable` and `blocking_class=device_toolchain` → toolchain_blocked. Summary mapping, runner retry-prompt projection, and reports SHALL consume the same registry; a drift test SHALL bind registry ↔ classifier ↔ schema.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/summary-blockers.ts`, `harness/scripts/utils/types.ts`, `harness/schemas/summary.schema.json`

#### Scenario: an unregistered blocker keeps today's behavior

- **WHEN** a blocker id appears in no registry entry and carries no explicit actionability
- **THEN** it SHALL resolve to `agent_fixable` and the retry flow SHALL behave exactly as before this change

### Requirement: ui-spec schema rejects unknown screen and component keys with a rename hint

`ui-spec.schema.json` SHALL set `additionalProperties:false` on both the screen and componentNode definitions (after a one-time inventory registers all legitimate existing keys), and the runtime validator SHALL derive its allowed-key sets from the schema (JSON Schema stays the single source of truth). Unknown-key errors SHALL include a did-you-mean hint when the unknown key is within edit distance 3 of (or a prefix-stripped match for) a legal key. A three-way drift test SHALL bind schema ↔ validator ↔ TypeScript types.

Enforcement: `harness/schemas/ui-spec.schema.json`, `profiles/hmos-app/harness/ui-spec-schema-validate.ts`

#### Scenario: the incident's wrong key is caught with the correct name

- **WHEN** a screen carries `must_have:` instead of `must_have_elements:`
- **THEN** validation SHALL FAIL naming the illegal key and suggesting `must_have_elements`, instead of silently dropping the coverage list

### Requirement: Capture-completeness messaging names real fields and real paths

The capture-completeness gates SHALL reference the field name `must_have_elements` verbatim in failure details, and their `affected_files`/details SHALL use the same `spec/`-relative path the gate actually reads (`spec/ref-elements.yaml` via the fidelity path helpers), never the feature-root projection that misled the incident agent into copying files to the wrong location.

Enforcement: `profiles/hmos-app/harness/capture-completeness-check.ts`

#### Scenario: the error message no longer teaches the wrong field name

- **WHEN** must-have coverage fails
- **THEN** the details SHALL say `must_have_elements` and point at `doc/features/<f>/spec/ref-elements.yaml`

### Requirement: Gate guidance separates agent and operator audiences

Generic auto-guidance and per-gate suggestions delivered to the retrying agent SHALL contain only artifact-level actions; framework-internal mechanics (implementation lookups, memory-manifest injection routes) SHALL move to an `operator_note` field rendered in goal reports but excluded from the agent retry-prompt failure feedback. The retry feedback block SHALL end with an explicit red line against reading or modifying framework internals to pass gates. When the previous failure contained an unknown-schema-key BLOCKER, the next retry prompt SHALL append the legal key list generated from the schema SSOT (model-agnostic trigger).

Enforcement: `harness/scripts/utils/report-generator.ts`, `harness/schemas/summary.schema.json`, `harness/scripts/goal-runner.ts`

#### Scenario: the agent no longer gets sent into framework source

- **WHEN** a gate fails whose remediation note mentions the structured-ref-elements memory manifest
- **THEN** the retry prompt SHALL show only the artifact-level fix while the goal report carries the operator_note
