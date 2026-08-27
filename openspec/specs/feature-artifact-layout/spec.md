# feature-artifact-layout Specification

## Purpose
TBD - created by archiving change feature-artifact-archival. Update Purpose after archive.
## Requirements
### Requirement: Phase-scoped feature artifacts use canonical nested paths

The framework SHALL resolve phase-scoped feature artifacts under
`doc/features/<feature>/<phase>/<basename>` as the canonical write path, where
`<phase>` is determined by `PHASE_SCOPED_ARTIFACTS` in `harness/config.ts`.

Global cross-phase contracts (`acceptance.yaml`, `contracts.yaml`,
`use-cases.yaml`, `boundaries.yaml`, `compat.yaml`) SHALL remain at the feature
root directory.

#### Scenario: Spec written under spec subdirectory
- **WHEN** an agent writes `spec.md` for feature `demo`
- **THEN** the canonical path SHALL be `doc/features/demo/spec/spec.md`

#### Scenario: Plan written under plan subdirectory
- **WHEN** an agent writes `plan.md` for feature `demo`
- **THEN** the canonical path SHALL be `doc/features/demo/plan/plan.md`

#### Scenario: Global contract stays at feature root
- **WHEN** harness loads `contracts.yaml` for feature `demo`
- **THEN** the canonical path SHALL be `doc/features/demo/contracts.yaml`

### Requirement: Dual-read legacy flat paths on read

On read, the framework SHALL prefer the canonical nested path when it exists.
When only legacy paths exist (`prd/spec.md`, flat `spec.md`, `design/design.md`,
flat `design.md`), the framework SHALL return the legacy file as `actualPath`
with `usedLegacy=true`.

#### Scenario: Legacy nested PRD still readable
- **WHEN** `doc/features/demo/spec/spec.md` exists and `doc/features/demo/spec/spec.md` does not
- **THEN** `resolveFeatureArtifact` for `spec.md` SHALL set `exists=true`, `usedLegacy=true`

#### Scenario: Legacy flat PRD still readable
- **WHEN** `doc/features/demo/spec.md` exists and canonical spec path does not
- **THEN** `resolveFeatureArtifact` for `spec.md` SHALL set `exists=true`, `usedLegacy=true`

### Requirement: Legacy duplicate warning

The framework SHALL set `legacyDuplicate=true` when both canonical and legacy
paths exist for the same artifact, and harness checks SHALL emit a WARN
suggesting removal of the legacy copy.

#### Scenario: Both paths present triggers duplicate flag
- **WHEN** both `doc/features/demo/spec/spec.md` and `doc/features/demo/spec.md` exist
- **THEN** `legacyDuplicate` SHALL be true and `actualPath` SHALL be the canonical path

### Requirement: Artifact input normalization

The framework SHALL normalize artifact keys that already include a phase prefix
(e.g. `ut/mock-plan.yaml`) to the same canonical path as the basename alone
(`mock-plan.yaml`), without producing double-nested paths such as `ut/ut/`.

#### Scenario: Prefixed ut mock-plan resolves correctly
- **WHEN** resolving `ut/mock-plan.yaml` or `mock-plan.yaml` for feature `demo`
- **THEN** canonical path SHALL be `doc/features/demo/ut/mock-plan.yaml`

### Requirement: Feature root may contain a disposable next-step projection
The canonical feature root resolved by `harness/config.ts` MAY contain `next.json`. The file SHALL be treated as a recomputable projection rather than a feature artifact, receipt, or completion authority.

#### Scenario: next.json is removed
- **WHEN** a valid projection is deleted before continue
- **THEN** the framework SHALL reconstruct it from artifacts, summaries, workflow, goal, and evidence without losing authoritative state

### Requirement: Artifact compatibility is identified by schema name and version
Skill-authored artifacts SHALL be referenced from contracts by their registered artifact schema identifier and version under `specs/artifact-schemas/`. Existing canonical consumer paths defined by `harness/spec-loader.ts` SHALL remain unchanged unless separately migrated.

#### Scenario: Skill implementation changes without schema break
- **WHEN** a skill changes internal prose or implementation while preserving all produced and consumed schema versions
- **THEN** downstream skills SHALL remain compatible without a path migration

### Requirement: fidelity-intent.json is the single SSOT for the three routing axes

`<feature>/spec/reports/fidelity-intent.json` SHALL record `inferred_fidelity`/`selected_fidelity`/`effective_fidelity`, `acceptance_strictness`, `asset_acquisition_mode`, clamp state, decision metadata, execution identity and a stable requirement hash. `<feature>/spec/reports/capability-snapshot.json` SHALL record only the current execution probe/canary verdict and source. spec.md/ui-spec `fidelity_target` SHALL project selected fidelity; effective fidelity is execution metadata and SHALL NOT overwrite that projection. Artifact attestation and historical policy state MUST NOT enter either record.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`, `harness/harness-runner.ts`

#### Scenario: Existing visual artifacts do not alter snapshot capability

- **WHEN** initialization runs with an existing unverified ui-spec and the current model probe succeeds
- **THEN** capability-snapshot records vision=true from the probe and fidelity routing uses that current capability

### Requirement: facts.md is the single exploration artifact per feature

feature 级探索事实 MUST 落盘于 `<features_dir>/<feature>/context/facts.md`，由该 track 的首个 feature phase 建立（full=spec、lite=change）；后续每个 active feature phase MUST 以 `phase_delta` 增量节追加（无新事实须显式写 "none"），MUST NOT 重做全量探索或另建 per-phase 探索文件。路径 MUST 经 `paths.features_dir` 解析。

#### Scenario: coding 阶段复用 spec 的探索
- **WHEN** full track 的 coding phase 开始且 facts.md 已由 spec 建立
- **THEN** coding 只追加 `phase_delta: coding` 节，探索校验通过，不要求新建 context-exploration.md

#### Scenario: review/ut/testing 不留断层
- **WHEN** full track 的 review phase 校验探索凭证
- **THEN** 校验对象为 facts.md 的 `phase_delta: review` 节（receipt 凭证同源）

> **Enforced by:** `specs/phase-rules/*-rules.yaml`, `harness/scripts/check-receipt.ts`

### Requirement: Legacy per-phase exploration remains readable

旧 per-phase `context-exploration.md` 布局 MUST 保持可读可校验（WARN 提示可 backfill）；`backfill-context-exploration.ts` MUST 提供幂等的旧布局→facts.md 归并。

#### Scenario: 存量 feature 零迁移
- **WHEN** 存量 feature 只有旧 per-phase 探索文件
- **THEN** 各 phase 校验按旧契约通过，仅出 WARN 建议 backfill

> **Enforced by:** `harness/scripts/backfill-context-exploration.ts`, `specs/phase-rules/*-rules.yaml`

### Requirement: Feature lifecycle artifact retention

After a feature workflow completes, the framework SHALL retain `contracts.yaml`,
`use-cases.yaml`, and `acceptance.yaml` permanently at the feature root.
The framework MAY allow `plan/plan.md` narrative to be archived or downgraded.

#### Scenario: Plan ephemeral after feature close
- **WHEN** a feature reaches testing PASS and is marked closed
- **THEN** harness SHALL still resolve `contracts.yaml` at the feature root indefinitely

### Requirement: Process checklist items excluded from main templates

The framework SHALL NOT require operational process sections (admin console
scheduling, analytics/SVN, translation, TA coordination, demo scheduling) in
core `spec` or `plan` templates. Hosts MAY supply them via extension checklists
or lifecycle hooks.

#### Scenario: Core spec template has no SVN section
- **WHEN** harness validates a generic profile spec against phase-rules
- **THEN** absence of an SVN archival section SHALL NOT fail structure checks

### Requirement: Phase completion receipt template (slim, schema 2.0)

phase-completion-receipt.md 模板 MUST 以 frontmatter `receipt_schema: "2.0"` 标识新格式；字段集 MUST 为：feature/phase、agent_model/agent_runtime、claimed_completion_at、claimed_completion_commit_sha、verifier_subagent（invoked_via + verdict 摘录）、反假设三 checkbox、testing_run_artifacts（仅 testing）、evidence_manifest 指针（机器回写）。缺 `receipt_schema` 键的存量回执 MUST 按旧格式（1.x）全量校验规则处理。

#### Scenario: 双格式共存
- **WHEN** 实例中同时存在旧格式回执（无 receipt_schema）与新模板产出的 2.0 回执
- **THEN** check-receipt 按各自格式分派校验，旧格式行为零变化

> **Enforced by:** `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`

### Requirement: Phase closures carry acyclic evidence manifests derived from the loader SSOT

Each phase closure SHALL produce `phase-evidence-manifest.json` recording inputs, outputs, environment (framework_version, profile, workflow_hash, framework_config_hash) and an aggregate hash. The file set SHALL be resolved by `resolvePhaseEvidenceManifest()` reusing/extending the spec-loader REQUIRED/OPTIONAL tables plus per-phase outputs and the source inventory reference — no second hand-written table. Encapsulation order is fixed and acyclic: reports and receipt body first; receipt canonicalized excluding fingerprint/manifest-pointer fields, then hashed; manifest generated (never hashing itself); receipt/summary store only the manifest path + sha256; verifiers recompute listed evidence hashes before checking the manifest hash. Staleness SHALL be recomputed at the two consumption points (truncated-chain preflight, verify-feature-completion): any changed input or output marks that closure and all downstream closures of the track-resolved chain STALE.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`（新增）, `harness/scripts/utils/spec-loader.ts`, receipt/summary schemas

#### Scenario: editing acceptance.yaml after spec closure stales downstream

- **WHEN** acceptance.yaml is modified after the spec phase closed
- **THEN** preflight recomputation SHALL mark the spec closure and all downstream closures STALE

### Requirement: New governance artifacts have fixed locations and ownership

The feature tree SHALL host: `<phase>/headless-assumptions.jsonl` (agent-written, schema-checked) with optional markdown projection; `review/reports/review-closure-attestation.json` (harness-written at closure); acceptance.yaml extended with `flows` and per-AC structured checkpoints plus `requirement_ref`; and current machine evidence under the existing phase/report carriers. Legacy skip/behavior waiver files MAY remain readable for migration but MUST NOT lower a gate. `feature-completion.json` originals live in the runner-owned run directory (atomic write); the feature directory holds only a projection/reference. All are consumed via recomputation-based verification, never via existence checks.

Enforcement: `harness/scripts/utils/{closure-attestation,verify-feature-completion}.ts`, acceptance schema, `specs/phase-rules/*.yaml`

#### Scenario: completion projection without a verifiable original

- **WHEN** the feature directory contains a completion projection whose runner-owned original fails recomputation
- **THEN** consumers SHALL treat the feature as not completed (verify result INVALID/STALE)

### Requirement: Visual debt lives in a harness-derived JSON ledger with a markdown projection

`doc/features/<feature>/visual-debt.json` SHALL be the machine truth for visual debt, derived by the harness from asset-crop-validation, ui-spec verified state, static_fidelity_score, blind-review-pending, materialization sanity, and render-visibility findings — never agent-authored. Entries carry `{id, source_check_id, asset_key?, screen_id?, severity, status: open|closed|accepted, resolution_class, accepted_by?, acceptance_receipt?}`. `closed` means fixed (or three-state asset clearance); `accepted` means still present but explicitly accepted via receipt — both stop blocking release, and reports SHALL list them separately. `visual-debt.md` is a human projection only. Open debt maps to quality_axes (visual UNVERIFIED/FAIL per resolution class) and caps completion per the verdict-lattice rules.

Enforcement: `harness/scripts/utils/visual-debt.ts`（新增）, `harness/scripts/harness-runner.ts`, `harness/scripts/check-testing.ts`

#### Scenario: the incident's buried warnings become a ledger

- **WHEN** a blind-tier run ends with 22 unverified assets, unverified ui-spec, and an uncomputed fidelity score
- **THEN** visual-debt.json SHALL enumerate every item with its source check id, and the test-report conclusion template SHALL render the structured axes instead of a bare 「达标可发布」

### Requirement: Asset debt clears only through source, binding, and render verification

Each asset debt entry SHALL track `asset_source_status` (file sanity), `asset_binding_status` (source/resource reference check), and `asset_render_status` (on-device region visibility). A user-supplied replacement sets source=VERIFIED only; the entry closes when all three are VERIFIED — a file dropped into media while the UI still references the old placeholder SHALL NOT close the entry.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `profiles/hmos-app/harness/{asset-materialization-sanity,render-visibility}.ts`

#### Scenario: file replaced, binding stale

- **WHEN** a real bank logo lands at the manifest's resolved_path but the page still references the placeholder resource
- **THEN** the debt entry stays open with binding=UNVERIFIED naming the referencing source file

### Requirement: Blind-tier asset requests are a standing artifact with a confirmation flow

When blind-tier assets cannot be trusted-cropped, spec SHALL emit `doc/features/<feature>/spec/asset-request.md` (per item: purpose, suggested dimensions, drop path, current placeholder kind). Interactive sessions confirm via the registry (provide asset / accept placeholder / defer per item, copy stating the ≥4/5 first-run expectation); headless proceeds with role-appropriate placeholders and debt entries, with brand-critical placeholders keeping release BLOCKED. A re-run after the user drops assets SHALL absorb them automatically through the three-state clearance.

Enforcement: `harness/scripts/check-spec.ts`, `skills/reference/confirmation-registry.yaml`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: the user drops eight logos after the first run

- **WHEN** files land at the requested paths and spec harness re-runs
- **THEN** each passing role-aware sanity flips source=VERIFIED and the remaining binding/render states drive the entries toward closure without manual ledger edits

### Requirement: Visual execution artifacts are current receipts only

The feature vision directory SHALL use `capability-receipt.json` and `spec-refs-receipt.json` as short-lived current execution evidence. The framework SHALL NOT require or maintain feature-scoped artifact-attestation or policy-downgrade ledgers.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/utils/effective-vision-context.ts`

#### Scenario: Upgraded consumer keeps old ledgers without migration

- **WHEN** a consumer upgrades while old visual JSONL ledgers remain on disk
- **THEN** initialization proceeds without reading, migrating, anchoring, or deleting those files

### Requirement: Blind-mode placeholder metadata is schema-valid but non-authoritative

The ui-spec token schema SHALL allow `placeholder:boolean` and `value_source:string`; the asset schema SHALL allow `blind_fallback_reason:string` and legacy `crop_confirmed_by:string|null`. These fields SHALL only document fallback/provenance and MUST NOT count as visual verification, human authorization, or a reason to lower current execution capability. New writers SHALL use source/hash/tool provenance instead of signer fields.

Enforcement: `harness/schemas/ui-spec.schema.json`, `profiles/hmos-app/harness/ui-spec-schema-validate.ts`, `harness/scripts/utils/ui-spec-shared.ts`

#### Scenario: Honest blind placeholders do not create schema-noise storms

- **WHEN** a blind-mode ui-spec marks neutral token values as placeholders and records asset fallback reasons with null crop confirmation
- **THEN** those fields pass structural schema validation while genuine unknown fields and missing placeholder rationale remain actionable
