## ADDED Requirements

### Requirement: Facts source ownership follows the runtime write boundary

When the entry bridge assigns the implementation owner to non-test files in `contracts.files ∪ source paths`, a file SHALL receive that owner, regardless of its suffix, when the runtime write boundary (`resolvePhaseWriteBoundary`, resolved with the same inputs as the existing owned-source check: effective scope chain, full track, run id, profile) resolves it to the implementation owner with a `source` role. Files outside that boundary SHALL keep the existing rule: only profile-declared source suffixes receive the owner. The boundary SHALL be resolved at most once per entry; when it cannot be resolved (no frozen construction binding, a legal state before spec / plan complete) or lists the implementation owner as unresolved, ownership SHALL NOT be widened and the error SHALL NOT escape the entry. Historical / admitted ownership closure and the test-owner branch SHALL be unchanged. No field, halt reason or gate SHALL be added.

Enforcement: `harness/scripts/utils/capability-resolution-entry-input.ts`

#### Scenario: an in-boundary resource edited by coding is disclosed, not blocked

- **WHEN** coding changes `src/<module>/resources/base/element/string.json`, which lies in the coding write boundary and is a declared facts source, under a profile whose source suffix is not `.json`
- **THEN** the file SHALL carry owner `coding` and the facts check SHALL report only the `context_exploration_facts_source_stale` WARN for the missing exact delta, with no FAIL for that check id

#### Scenario: specification files listed in contracts.files stay strict

- **WHEN** `acceptance.yaml`, `contracts.yaml` or `context/facts.md` are listed in `contracts.files`, or a research source outside the boundary such as `build-profile.json5` is declared, and one of them changes during coding
- **THEN** none of them SHALL carry an owner and the change SHALL keep the `context_exploration_facts_source_stale` FAIL

#### Scenario: no construction binding leaves ownership unchanged

- **WHEN** a plan-first run has no frozen construction contract and its Research declares the same resource file
- **THEN** the entry SHALL NOT throw and its source owners SHALL equal the suffix-only result

### Requirement: Capability absence is projected once through the testing verdict chain

A visual provider round projected as unavailable SHALL carry `evidence_block_owner: 'capability'` on its existing `structured` object (an `invalid` outcome SHALL NOT), so the existing evidence-binding reader gives the unbound visual binding `repair_owner: 'capability'`. One shared projection (`blocking_class: 'externalBlocked'`, `failure_kind: 'capability_missing'`, details stating the visual capability is absent and this is not a product failure) SHALL be reused by:

- `testing_channel_evidence_obligation`, when its blocking bindings are non-empty and all have `repair_owner === 'capability'`;
- `p0_coverage_integrity` and `p0_semantic_coverage_integrity`, decided before failure text is assembled, only when the trace outcome is success with no failed or blocked case, every unpassed P0 evaluation is a capability-owned visual absence, and every unpassed P0 AC has a non-empty related evaluation set that is entirely capability-owned (an empty related set SHALL NOT pass vacuously);
- `testing_run_status`, which SHALL degrade to MINOR / WARN with `partial_readiness: capability_missing` when every blocker failure carries the projection, in the same branch as the existing install external block.

Any coding- or spec-owned binding, binding without owner, invalid provider evidence, trace assertion or execution failure SHALL keep the existing FAIL. The report writer SHALL keep a P0 visual case left unverified by a capability-owned binding in the denominator, with execution status 「跳过」 and remark "未验证（能力缺席）", SHALL NOT count it as a functional-axis failure or list it as a product defect, SHALL put capability-absence visual blockers only into gaps without setting `overall=FAILED`, and SHALL replace the "feature complete, advance" suggestion with restoring the capability and re-issuing the same request; so a round whose only blockers are capability absence declares 「有条件达标」 with `COMPLETE_WITH_GAPS`. Report status values, verdict words, `negative_verdict_closure` and `resolveVerdictFromChecks` SHALL be unchanged; the shared rule SHALL give `INCOMPLETE`. A capability gap reaching the same bindings by another route (for example a missing OCR execution capability) SHALL take the same projection. No check id, field protocol or verdict word SHALL be added, and no decision SHALL match on details text.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `profiles/hmos-app/harness/test-report-writer.ts`

#### Scenario: product failures and provider absence together stay FAIL

- **WHEN** the host round has failing TC-004 / TC-005 and an unavailable visual provider for TC-007
- **THEN** the derived checks SHALL stay ordinary FAIL, the report SHALL declare 不达标, the candidates SHALL route to coding and the verdict SHALL be FAIL

#### Scenario: only provider absence remains

- **WHEN** the same round has TC-004 / TC-005 passing and the provider still unavailable
- **THEN** `visual_diff`, the evidence obligation, both P0 coverage checks and `testing_run_status` SHALL carry `externalBlocked` / `capability_missing`, the report SHALL declare 有条件达标 with the capability-absence gap and TC-007 recorded as 跳过 / 未验证（能力缺席）, `negative_verdict_closure` SHALL pass and the verdict SHALL be INCOMPLETE with no repair candidate

#### Scenario: invalid evidence, a broken plan binding or an unrelated P0 AC stays FAIL

- **WHEN** the provider returns invalid evidence, or the visual binding breaks on the plan side with no owner, or a P0 AC has no related case
- **THEN** the corresponding checks SHALL stay FAIL and the verdict SHALL be FAIL
