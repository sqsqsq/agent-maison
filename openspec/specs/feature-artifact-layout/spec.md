# feature-artifact-layout Specification

## Purpose
TBD - created by archiving change feature-artifact-archival. Update Purpose after archive.
## Requirements
### Requirement: Phase-scoped feature artifacts use canonical nested paths

The framework SHALL resolve phase-scoped feature artifacts under
`<features_dir>/<feature_path>/<phase>/<basename>` as the canonical write path, where
`<features_dir>` is `paths.features_dir` (default `doc/features`, the single root SSOT),
`<phase>` is determined by `PHASE_SCOPED_ARTIFACTS` in `harness/config.ts`, and
`<feature_path>` is the **physical relative path** derived from the logical feature identity
by one neutral pure function (the Feature path SSOT):

- legacy flat Feature: `<feature_path> = <feature_id>`;
- Change-Unit Feature (identity `cu-` + `base64url(blueprint_id + "\0" + change_unit_id)`):
  `<feature_path> = <blueprint_id>/<change_unit_id>`, i.e. the evolution workspace subdirectory
  that also holds the CU canonical `change-unit.yaml`;
- an identity that starts with `cu-` but whose payload is not a canonical base64url
  `(blueprint_id, change_unit_id)` pair SHALL fail closed; it MUST NOT fall back to a flat directory.

Global cross-phase contracts (`acceptance.yaml`, `contracts.yaml`,
`use-cases.yaml`, `boundaries.yaml`, `compat.yaml`) SHALL remain at the feature
root directory, which for a CU Feature is `<features_dir>/<blueprint_id>/<change_unit_id>/`.

Every Feature path construction in the framework SHALL consume the same Feature path SSOT:
artifact read/write, `receipt_dir_pattern`/`reports_dir_pattern` and any other template that
contains `<feature>`, Goal Mode run/event/manifest/lock/resume paths, context and fidelity
artifacts, SpecLoader/catalog/receipt reconciliation enumeration, the P1/P2/P3
blueprint/change-unit/closure resolvers, CLIs and Skills, **and every independent production
entry shipped in the release**: the plain-Node hooks distributed to host agents
(`check-phase-completion.mjs` and any hook that resolves a receipt
or report location; the retired `record-verifier-report.mjs` publisher is gone, the verifier report path is now
resolved by the TS `reportsDirOf` production resolver used by the caller that writes the report), agent-facing boundary/prompt text that declares writable Feature paths
(e.g. the testing write boundary), compat message templates (`{feature}`), check-spec asset
fallback paths, and framework smoke/lifecycle scripts. The SSOT SHALL be one dependency-free
module that the TypeScript harness and plain-Node hooks import alike; hooks MUST NOT carry a
second copy of the identity decoder. The `<feature>` / `{feature}` placeholder SHALL be
substituted with `<feature_path>`, never with the encoded logical identity; production code
MUST NOT concatenate `<features_dir>` with a feature identity outside the SSOT. The existing
pattern contract is unchanged otherwise: a configured `receipt_dir_pattern`/`reports_dir_pattern`
resolves relative to the project root, only its placeholders are substituted, and every other
prefix and directory level of the pattern is preserved — a CU Feature therefore changes what
`<feature>` expands to (`<blueprint_id>/<change_unit_id>`), not where a custom pattern points.

In framework documentation, skill instructions and agent templates, the placeholder
`<features_dir>/<feature>/…` SHALL denote the **physical Feature path** (`<feature_path>`):
for a CU Feature it reads `<features_dir>/<blueprint_id>/<change_unit_id>/…`. Phase skills'
"Feature 归档定位协议" SHALL instruct the agent to resolve that physical path through the
framework (SSOT/CLI output) rather than to concatenate the logical identity by hand; this
semantic is stated once in the shared reference glossary and referenced by the per-phase skills,
not re-explained per file.

Directory discovery under `<features_dir>` SHALL return only executable Features
(`legacy | cu`), never workspace containers: a first-level directory that contains
`blueprint/component-blueprint.yaml` is an evolution workspace whose subdirectories containing
`change-unit.yaml` are CU Features (identity rebuilt from `(workspace dir, subdir)` and required to
round-trip with the SSOT), its `blueprint/` subdirectory is skipped, a subdirectory holding
phase-scoped artifacts without `change-unit.yaml` is an orphan and SHALL fail closed, and
auxiliary directories with no known Feature marker are ignored; a first-level directory that
has a `blueprint/` subdirectory without `component-blueprint.yaml`, or that mixes flat Feature
artifacts with `blueprint/component-blueprint.yaml`, SHALL fail closed rather than be treated as a
legacy Feature. Any other first-level directory keeps the existing legacy flat behavior.
Feature artifact detection SHALL reuse `PHASE_SCOPED_ARTIFACTS` and the existing artifact
layout; no second hand-written artifact list is permitted.

#### Scenario: Spec written under spec subdirectory
- **WHEN** an agent writes `spec.md` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/spec/spec.md`

#### Scenario: Plan written under plan subdirectory
- **WHEN** an agent writes `plan.md` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/plan/plan.md`

#### Scenario: Global contract stays at feature root
- **WHEN** harness loads `contracts.yaml` for feature `demo`
- **THEN** the canonical path SHALL be `<features_dir>/demo/contracts.yaml`

#### Scenario: CU Feature artifacts live inside the evolution workspace
- **WHEN** an agent writes `spec.md` for the Feature derived from `blueprint_id=ledger-evolution`,
  `change_unit_id=cu-ledger-write`
- **THEN** the canonical path SHALL be `<features_dir>/ledger-evolution/cu-ledger-write/spec/spec.md`,
  and `contracts.yaml` SHALL be `<features_dir>/ledger-evolution/cu-ledger-write/contracts.yaml`

#### Scenario: Default receipt and report templates substitute the physical path
- **WHEN** `receipt_dir_pattern` is the default `doc/features/<feature>/<phase>` and the feature is a CU Feature
- **THEN** the receipt directory SHALL resolve to `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>`,
  not to `<features_dir>/cu-<base64url>/<phase>`

#### Scenario: Custom pattern keeps its own structure and only expands the placeholder
- **WHEN** `receipt_dir_pattern` is the custom `requirements/features/<feature>/phases/<phase>` and the
  feature is a CU Feature
- **THEN** the receipt directory SHALL resolve to
  `requirements/features/<blueprint_id>/<change_unit_id>/phases/<phase>` relative to the project root;
  the custom prefix and levels SHALL be preserved, the pattern SHALL NOT be relocated under
  `<features_dir>`, and the encoded identity SHALL NOT appear as a segment

#### Scenario: No shadow directory after a Goal Mode run
- **WHEN** a CU Feature completes a Goal Mode run that writes events, manifest, lock, receipts and reports
- **THEN** no resolved path SHALL contain the encoded `<encoded-featureId>` as a segment and
  `<features_dir>/<encoded-featureId>` SHALL NOT exist. Artifacts whose location is fixed relative to the
  Feature root — Goal Mode events, manifest and lock under `goal-runs/`, and `context/facts.md` — SHALL
  always be located under `<features_dir>/<blueprint_id>/<change_unit_id>/` regardless of any pattern;
  receipts, reports, phase-scoped artifacts and any other artifact resolved through
  `receipt_dir_pattern`/`reports_dir_pattern` follow the pattern: under
  `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>/…` with the default patterns, or under the custom
  pattern's own structure with `<feature>` expanded to `<blueprint_id>/<change_unit_id>`

#### Scenario: Shipped hooks resolve the CU physical directory
- **WHEN** the distributed `check-phase-completion.mjs` hook runs for a CU Feature, or the caller writes the
  verifier report through the production reports-dir resolver
- **THEN** with the default patterns the reports directory the hook prints and the verifier report the caller writes SHALL
  resolve to `<features_dir>/<blueprint_id>/<change_unit_id>/<phase>/…`; with a custom pattern they SHALL
  resolve to that pattern with only `<feature>` expanded to `<blueprint_id>/<change_unit_id>` (e.g.
  `requirements/features/<blueprint_id>/<change_unit_id>/phases/<phase>/…`); in both cases they SHALL go
  through the same Feature path SSOT, SHALL NOT read or write a path containing the encoded identity, and
  SHALL NOT embed a private decoder

#### Scenario: Agent-facing boundary text names the physical path
- **WHEN** the testing write boundary (or any prompt/compat message) declares writable or forbidden
  Feature paths for a CU Feature
- **THEN** the declared paths SHALL be `<features_dir>/<blueprint_id>/<change_unit_id>/…`, identical to what
  the machine snapshot check enforces; the declared set and the checked set MUST NOT diverge

#### Scenario: Custom features_dir is honored end to end
- **WHEN** `paths.features_dir` is configured to a non-default directory
- **THEN** legacy Features, evolution workspaces, CU Features, receipts and reports SHALL all resolve
  under that directory; no path construction SHALL hardcode `doc/features`

#### Scenario: Workspace container is not a Feature
- **WHEN** `<features_dir>/ledger-evolution/` contains `blueprint/component-blueprint.yaml` and the
  subdirectory `cu-ledger-write/change-unit.yaml`
- **THEN** enumeration SHALL yield only the CU Feature `cu-ledger-write` (kind `cu`) and SHALL NOT yield
  `ledger-evolution` itself

#### Scenario: Invalid cu- identity fails closed
- **WHEN** a Feature identity starts with `cu-` but its payload does not decode to a canonical
  `(blueprint_id, change_unit_id)` pair
- **THEN** path resolution SHALL fail with a located error and SHALL NOT create or read
  `<features_dir>/<identity>`

#### Scenario: Ambiguous or incomplete workspace fails closed
- **WHEN** a first-level directory mixes flat `spec/spec.md` with `blueprint/component-blueprint.yaml`, or
  has `blueprint/` without `component-blueprint.yaml`
- **THEN** enumeration and loading SHALL fail closed with the directory located, not silently pick one
  interpretation

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

`phase-completion-receipt.md` SHALL be generated by the harness as a read-only projection (`receipt_schema: "2.1"`) of closure facts already held in the summary. It SHALL contain no agent-filled fields and no anti-assumption checkboxes. Older receipts remain readable; none is required for closure.

Enforcement: `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`, `harness/harness-runner.ts`

#### Scenario: Old receipts keep reading

- **WHEN** an instance holds a hand-filled 2.0 receipt from a previous closure
- **THEN** it is parsed for display only and never demanded again

### Requirement: Phase closures carry acyclic evidence manifests derived from the loader SSOT

Each phase closure SHALL still produce `phase-evidence-manifest.json` recording inputs, outputs, environment and an aggregate hash resolved from the loader SSOT. The receipt SHALL be excluded from the manifest and from freshness recomputation; `receipt_changed` SHALL no longer exist as a staleness cause.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/spec-loader.ts`

#### Scenario: acceptance edits still stale downstream

- **WHEN** acceptance.yaml is modified after spec closure
- **THEN** the spec closure and downstream closures are STALE and `--revalidate` re-checks them

### Requirement: New governance artifacts have fixed locations and ownership

The feature tree SHALL host `<phase>/headless-assumptions.jsonl` as an agent-written, schema-checked audit record with an optional markdown projection; `review/reports/review-closure-attestation.json` as harness-written machine evidence; acceptance `flows`, per-AC structured checkpoints, and `requirement_ref` as spec-owned hash-bound contracts; and testing runtime observations inside the existing device-test evidence and phase-evidence locations. New runs MUST NOT create `testing/skip-waivers.yaml`, phase behavior-switch waivers, human visual acceptance receipts, mutation-adjudication receipts, or other quality-lowering confirmation artifacts. `feature-completion.json` originals remain in the runner-owned run directory with only a projection/reference in the feature directory. All authoritative artifacts SHALL be consumed through recomputation-based verification, never existence or signer-name checks.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `specs/phase-rules/*.yaml`

#### Scenario: old waiver files remain on disk

- **WHEN** an upgraded consumer contains legacy skip-waiver, behavior-waiver, or human visual receipt files
- **THEN** readers MAY report them as deprecated history, but no current gate, closure, or completion decision SHALL consume them

### Requirement: Visual debt lives in a harness-derived JSON ledger with a markdown projection

`doc/features/<feature>/visual-debt.json` SHALL be the machine truth for visual debt, derived by the harness from current asset, ui-spec, deterministic visual, provider, materialization, and render-visibility evidence — never agent-authored. Entries carry stable identity, source check, optional asset/screen identity, severity, status `open|closed`, and a machine resolution class. `closed` means fixed and reverified; there is no `accepted` quality-bypass state and new entries MUST NOT carry `accepted_by` or `acceptance_receipt`. `visual-debt.md` is a human projection only. Open required debt maps to the existing quality axes and blocks release; optional unverified debt remains advisory only where existing release policy permits it.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`, `harness/scripts/check-testing.ts`

#### Scenario: a user name cannot close visual debt

- **WHEN** an open visual debt entry has legacy acceptance metadata but its source evidence has not been fixed and reverified
- **THEN** the entry SHALL remain open for current projection and release SHALL remain blocked when the axis is required

### Requirement: Asset debt clears only through source, binding, and render verification

Each asset debt entry SHALL track `asset_source_status` (file sanity), `asset_binding_status` (source/resource reference check), and `asset_render_status` (on-device region visibility). A user-supplied replacement sets source=VERIFIED only; the entry closes when all three are VERIFIED — a file dropped into media while the UI still references the old placeholder SHALL NOT close the entry.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `profiles/hmos-app/harness/{asset-materialization-sanity,render-visibility}.ts`

#### Scenario: file replaced, binding stale

- **WHEN** a real bank logo lands at the manifest's resolved_path but the page still references the placeholder resource
- **THEN** the debt entry stays open with binding=UNVERIFIED naming the referencing source file

### Requirement: Blind-tier asset requests are a standing artifact with a confirmation flow

When assets cannot be trusted-cropped, spec SHALL emit `doc/features/<feature>/spec/asset-request.md` with each item's purpose, suggested dimensions, drop path, and current placeholder kind. A run MAY consume user-supplied files or bounding boxes as frozen input provenance, but no mid-run signature is required to continue. The automated path SHALL use role-appropriate placeholders where allowed and keep brand-critical placeholders release-blocking; after supplied assets appear, re-running the owner phase SHALL absorb them through source, binding, and render verification.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/visual-debt.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`

#### Scenario: unattended run lacks a trustworthy crop

- **WHEN** an unattended run cannot verify a requested crop and no supplied asset exists
- **THEN** it SHALL materialize only an allowed visible placeholder or fail/defer according to asset criticality, and SHALL NOT stop for a signature

### Requirement: Visual execution artifacts are current receipts only

The feature vision directory SHALL use `capability-receipt.json` and `spec-refs-receipt.json` as short-lived current execution evidence. The framework SHALL NOT require or maintain feature-scoped artifact-attestation or policy-downgrade ledgers.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/utils/effective-vision-context.ts`

#### Scenario: Upgraded consumer keeps old ledgers without migration

- **WHEN** a consumer upgrades while old visual JSONL ledgers remain on disk
- **THEN** initialization proceeds without reading, migrating, anchoring, or deleting those files

### Requirement: Blind-mode placeholder metadata is schema-valid but non-authoritative

The ui-spec token schema SHALL allow `placeholder:boolean` and `value_source:string`; the asset schema SHALL accept legacy `blind_fallback_reason` and `crop_confirmed_by` fields for compatibility. These fields SHALL document fallback/input provenance only and MUST NOT count as visual verification, human authorization, or a reason to lower current execution capability. New writers SHALL use neutral source/tool/hash provenance and MUST NOT produce `crop_confirmed_by` or `human_crop_confirmed` as quality authority.

Enforcement: `harness/schemas/ui-spec.schema.json`, `profiles/hmos-app/harness/ui-spec-schema-validate.ts`, `harness/scripts/utils/ui-spec-shared.ts`

#### Scenario: legacy crop confirmation is inert

- **WHEN** an existing ui-spec contains `crop_confirmed_by: user_requirement`
- **THEN** schema compatibility SHALL allow the field, but crop admission SHALL still require current source/hash/tool evidence

### Requirement: Runtime observations reuse device and phase evidence locations

P0 runtime step observations SHALL be stored within the existing `device-test-evidence.json`/Hylyre run directory and referenced by the testing phase evidence manifest. The framework MUST NOT create a runtime-confirmation receipt, signature ledger, or off-repository trust record.

Enforcement: `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/device-test-evidence.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: runtime evidence participates in closure freshness

- **WHEN** a bound trace, HAP, product source aggregate, flow, or step observation changes after testing closure
- **THEN** testing closure and feature completion SHALL become stale through the existing evidence-manifest verification

### Requirement: contracts.files is the sole file authorization set

Within `contracts.yaml`, the top-level `files` collection SHALL be the only persistent authorization set for files that plan permits coding or later phases to materialize or modify. All other file-bearing contract fields are references and MUST be members of that set; they MUST NOT act as independent authorization channels. Reference closure SHALL be a deterministic in-memory projection of the current YAML and SHALL not create another feature artifact.

The `navigation` section SHALL carry exactly one file-bearing field in 3.0: `config_files: string[]`, the navigation registration/configuration file list. Its entries are references like any other and MUST be members of `contracts.files`; a consumer reading them MUST NOT treat the declaration itself as authorization.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `specs/artifact-schemas/contracts.schema.yaml`

#### Scenario: Resource key is a reference, not an allowlist

- **WHEN** `resource_keys[*].media` names a file absent from `contracts.files`
- **THEN** the media field MUST NOT authorize that file and plan closure MUST remain open

#### Scenario: Reclosed contracts replace the in-memory view

- **WHEN** the plan owner adds a missing path to `contracts.files` and reruns closure
- **THEN** the resolver SHALL derive a new view solely from the updated YAML without reading a previous graph or sidecar

#### Scenario: Navigation config file is a reference, not an allowlist

- **WHEN** `navigation.config_files` names a registration file absent from `contracts.files`
- **THEN** plan closure MUST remain open and the navigation declaration MUST NOT authorize that file

### Requirement: feature.yaml declares track

feature 级档位声明 MUST 落盘于 `<features_dir>/<feature>/feature.yaml`，含 `track`、判档评分快照、确认记录与升档 history；文件缺失 MUST 解释为 `track: full`。所有读写 MUST 经 `paths.features_dir` 解析，MUST NOT 硬编码 `doc/features/`。

#### Scenario: 无 feature.yaml 的存量 feature
- **WHEN** 既有 feature 目录无 feature.yaml
- **THEN** 全部运行时按 full track 处理，行为与升级前一致

> **Enforced by:** `harness/config.ts`（loadFeatureTrack）, `harness/scripts/utils/runtime-policy.ts`

### Requirement: change.md is the single lite narrative artifact

lite track 的叙述产物 MUST 为单文档 `change.md`（意图 / scope in-out 模块 / 术语快查 / 验收 checkbox / 关键契约 / 任务 checkbox）；lite MUST NOT 要求 spec.md / plan.md / contracts.yaml / per-phase receipt。升档 full 时 change.md MUST 作为 spec/plan 的种子输入而非作废。

#### Scenario: lite feature 全链产物
- **WHEN** 单模块 feature 走 lite（change → coding → exit）完成
- **THEN** feature 目录内叙述产物仅 change.md（+ exit 报告），无 spec/plan/contracts/receipt

> **Enforced by:** `harness/scripts/check-change-lite.ts`, `workflows/spec-driven.workflow.yaml`

### Requirement: The verifier is invoked through a short request whose subject addresses the reviewed material

`harness-runner` SHALL write exactly one `verifier.request.<subject>.json` when the verifier capability is `enabled`. `subject_id` SHALL be the SHA-256 of the pre-verifier material view computed at request issue time: the phase's actual input file hashes (resolved from the loader REQUIRED/OPTIONAL tables), the phase's primary artifact hashes, the source/trace/visual/machine-report files the verifier actually reads, the phase rule hash, the verifier prompt template hash and the gate fingerprint. It SHALL exclude the verifier report itself, summary runtime fields, the receipt, the `ai-prompt.md` generation timestamp and the merged report. Identical material SHALL address the same subject across harness re-runs so an existing verified report is reused; changed material addresses a new subject.

Enforcement: `harness/scripts/utils/verifier-request.ts`, `harness/scripts/utils/verifier-subject.ts`, `harness/harness-runner.ts`

#### Scenario: A no-op harness re-run keeps the subject

- **WHEN** the harness is re-run with no artifact changed
- **THEN** the request carries the same subject and the previous PASS report is reused without invoking the verifier

### Requirement: Summary schema 1.3 makes the verifier fields conditional and separates the three roles

The run summary writer SHALL emit `schema_version` `"1.3"`, in which `ai_prompt`, `verifier_subject_id`, `verifier_request` and `verifier_report` are **conditional** fields present only when the phase's verifier plan resolved to `enabled`. Their absence SHALL mean "not applicable", never "missing".

`verifier_report` SHALL be written at request issue time, as the project-root-relative path `<reports>/verifier.report.<subject>.md`. It exists so the dispatching agent never composes that path itself; the console `NEXT` line SHALL name it directly.

The three roles previously conflated in one field SHALL be separated: **generation** is carried by `schema_version`, **applicability** is recomputed on demand from the resolved verifier plan, and **identity** is carried by `verifier_subject_id`. No applicability snapshot SHALL be persisted into the summary — applicability is a judgement that can be recomputed at any time, and freezing it into a field turns it into state that drifts.

`1.2` SHALL remain readable as the previous closure generation, and `1.0` / `1.1` SHALL remain readable as legacy with unknown assurance. The assurance obligations that `1.2` introduced (`assurance`, capability resolutions and fingerprint, `closure_status`) SHALL apply unchanged to `1.3`; consumers SHALL express that as a version **set**, not as an equality against a single literal, so that a future generation does not silently drop out of every gate.

Verifier evidence adjudication SHALL NOT dispatch on `schema_version`. The generation field records the summary's own shape; using it to pick between two verifier evidence protocols made a legitimately disabled capability read as "old artifact".

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A disabled phase writes no verifier fields at all

- **WHEN** the resolved verifier plan for a phase is `disabled`
- **THEN** the summary SHALL carry no `ai_prompt`, no `verifier_subject_id`, no `verifier_request` and no `verifier_report`, and no prompt, request or report SHALL be produced

#### Scenario: An enabled phase names its report path up front

- **WHEN** the plan is `enabled` and the script gate passes
- **THEN** the summary SHALL carry `verifier_report` pointing at `<reports>/verifier.report.<subject>.md`, and the console `NEXT` line SHALL instruct the dispatcher to write the verifier's reply to exactly that path

#### Scenario: The current generation is accepted by every assurance consumer

- **WHEN** a `1.3` summary reaches quality-axes validation, the upstream verdict gate, feature completion verification, assessment, or the UT attestation-first probe
- **THEN** it SHALL be treated as the current generation and SHALL NOT be classified as legacy

#### Scenario: Closure does not downgrade the generation

- **WHEN** the closure finalizer patches an open `1.3` summary to `closed`
- **THEN** the written summary SHALL still declare `1.3`

### Requirement: Feature contracts normalize convention application declarations

Feature contracts MAY declare `conventions_applied` as an array of entries with required unique `id` and non-empty `planned_locations`. Every planned location MUST be a canonical project-relative POSIX file path or directory prefix; absolute paths, parent traversal, glob syntax and backslashes MUST fail shape validation. The existing `SpecLoader` SHALL normalize this field once and report invalid shapes through the existing `shape_issues → feature_spec_shape` BLOCKER path; downstream review MUST consume only this normalized object and MUST NOT reparse contracts YAML.

#### Scenario: Valid declaration is loaded

- **WHEN** contracts declare one id with `planned_locations: [src/data, test/data/repository.test.ts]`
- **THEN** `SpecLoader` SHALL preserve canonical values for review consumption

#### Scenario: Invalid path is declared

- **WHEN** a planned location is absolute, contains `..`, a backslash or glob syntax
- **THEN** `SpecLoader` SHALL remove the invalid entry and record a structured `feature_spec_shape` BLOCKER

#### Scenario: Convention id is duplicated

- **WHEN** two entries use the same convention id
- **THEN** the declaration SHALL fail shape validation rather than being collapsed by a Set or last-write-wins behavior

> **Enforced by:** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/check-review.ts`

### Requirement: CU-bound Feature contracts use ID-only construction mappings

For a Feature deterministically derived from a Change Unit, `contracts.yaml` SHALL bind the exact `change_unit_ref` and map canonical CU identifiers to construction evidence without copying or redefining CU content. `predicate_mappings[]`, `provide_mappings[]`, and `design_ref_mappings[]` MUST reference IDs/refs present in the bound canonical CU and map them to real implementation, symbol, test, or verification refs. Every required CU identifier MUST be mapped, and unknown identifiers or copied predicate/provide definitions MUST fail the Feature construction mapping gate.

The existing `contracts.state_management` section SHALL remain the sole Feature-construction authority for runtime facts. CU artifacts SHALL contain only stable blueprint runtime/design refs; no `runtime_flow_slices` or second runtime-detail section may duplicate trigger, owner, mutation, publication, subscription, consumer, freshness, or recovery facts. Features without `change_unit_ref` SHALL retain their existing artifact behavior.

#### Scenario: Canonical CU definitions are mapped, not copied

- **WHEN** a CU-bound Feature maps each canonical predicate/provide/design ref to actual files, symbols, and tests
- **THEN** the construction mapping gate passes without requiring copied CU descriptions in `contracts.yaml`

#### Scenario: Runtime facts remain in state management

- **WHEN** a CU references a P1 runtime flow and the Feature plans its implementation
- **THEN** concrete runtime facts are authored once in `contracts.state_management` and linked to the stable design ref; a parallel `runtime_flow_slices` definition is rejected

#### Scenario: Standalone Feature remains compatible

- **WHEN** an existing Feature has no `change_unit_ref`
- **THEN** its current contracts loading and validation behavior remains unchanged

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-review.ts`

### Requirement: Phase notes are a non-gating artifact

Each phase MAY carry `<features_dir>/<feature>/<phase>/notes.md` for agent observations. It SHALL NOT be read by any gate, SHALL NOT enter the evidence manifest, the verifier subject or freshness recomputation, and editing it SHALL never stale a closure.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/spec-loader.ts`

#### Scenario: Notes are invisible to closure

- **WHEN** `testing/notes.md` is created after testing closed
- **THEN** the testing closure stays fresh

### Requirement: Verifier output is a terminal block plus an item table

The verifier's answer SHALL consist of the versioned terminal block and one table of check id / verdict / one-line evidence / fix, with no prose sections. The SubagentStop hook SHALL keep reading only the terminal block.

Enforcement: `harness/prompts/verify-spec.md`, `harness/prompts/verify-plan.md`, `harness/prompts/verify-coding.md`, `harness/prompts/verify-review.md`, `harness/prompts/verify-ut.md`, `harness/prompts/verify-testing.md`, `agents/claude/templates/agents/verifier.md`

#### Scenario: The report returned to the driver is short

- **WHEN** a verifier finishes a phase with 12 checks
- **THEN** its final message is the 12-row table and the terminal block only

### Requirement: Harness-derived records and phase notes live outside the artifact inventory by design

`specs/artifact-schemas/inventory.yaml` describes skill-authored narrative artifacts and explicitly excludes harness summaries, receipts, traces and evidence manifests. The feature tree therefore legitimately contains output that the inventory does not and SHALL NOT describe, including the harness-derived `visual-debt.json` / `visual-debt.md` ledger, the `revalidation.json` execution record, and each phase's `notes.md`. Absence from the inventory SHALL NOT restrict writing these paths, SHALL NOT be interpreted as a permission failure, and SHALL NOT be compensated for by registering them as phase-owned artifacts or by adding a file-name exclusion list to the write boundary. Their correctness remains governed by their own consumers: a corrupt visual debt ledger still fails closed on read, and gates still recompute every authoritative artifact rather than checking existence.

Enforcement: `specs/artifact-schemas/inventory.yaml`, `harness/scripts/utils/visual-debt.ts`, `harness/scripts/utils/revalidate.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: the harness writes its debt ledger during a phase

- **WHEN** a phase skill runs the harness in-process and the harness derives and writes the feature-root visual debt ledger
- **THEN** the write SHALL be permitted and recorded as an unattributed observation, and the run SHALL NOT halt for missing ownership

#### Scenario: an agent writes phase notes as instructed

- **WHEN** a phase skill instructs the agent to record WARN/UNKNOWN observations in `<phase>/notes.md`
- **THEN** the write SHALL be permitted despite the file being outside the inventory, and no gate, closure or write boundary SHALL block it

#### Scenario: a corrupt ledger is still rejected

- **WHEN** `visual-debt.json` exists but cannot be parsed
- **THEN** the reader SHALL fail closed on the corrupt content rather than treating the ledger as absent, independently of any write-boundary decision

### Requirement: The verifier report markdown is the sole machine truth, written by the invoking agent

Each phase whose verifier plan resolves to `enabled` SHALL carry its machine-consumable verdict in a **subject-partitioned** markdown file, `<reports>/verifier.report.<subject>.md`. `summary.verifier_subject_id` alone decides which file is the current machine evidence, and `summary.verifier_report` names its path.

There SHALL be exactly **one writer**: the agent that dispatched the verifier. The verifier subagent SHALL keep its read-only tool grant and SHALL keep replying with the full report ending in exactly one versioned terminal block; the dispatcher SHALL write that reply **verbatim** — not summarized, not reduced to the terminal block — to the path named by `summary.verifier_report`. The verifier SHALL NOT be granted write access, the request SHALL NOT carry a report path for the verifier to write to, and no fallback second writer SHALL exist. A fallback in which the dispatcher writes only what it happens to hold would produce a report carrying a terminal block and no findings, which the loader would accept while repair candidates, WARN items and the multimodal review text silently vanish.

The subject partition SHALL be preserved: one file per subject, so no round can move, delete or overwrite another subject's file. A file whose terminal block echoes a different subject than its own name SHALL fail closed and SHALL NOT be repaired or moved. Stale files from superseded subjects SHALL be left in place; they are outside every consumer's read surface.

Adjudication SHALL rest on exactly three facts: the file exists, the terminal block echoes `summary.verifier_subject_id`, and `verdict` agrees with `blocker_count` (`PASS` ⟺ zero). A conclusion fingerprint, a subagent identity, a stored invocation/result subject pair, and a publication state machine SHALL NOT be required. The single recovery action for any failure SHALL be to re-run the verifier and rewrite the report.

The report SHALL NOT enter the evidence manifest protection set and SHALL NOT be hashed into the review closure attestation. Editing it after closure SHALL NOT mark any phase stale: the conclusion that closure adopted is already recorded in the summary, and a report whose modification is undetectable by design must not simultaneously act as a tamper tripwire.

Enforcement: `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/verifier-subject.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: The dispatcher writes the verifier's full reply

- **WHEN** a verifier subagent returns a full report ending in one terminal block
- **THEN** the dispatching agent SHALL write that reply verbatim to `summary.verifier_report`, and the loader SHALL return its full text as `report_text` for repair candidates and read-image evidence

#### Scenario: A report echoing a stale subject is not evidence

- **WHEN** a report file's terminal block echoes a subject that differs from `summary.verifier_subject_id`
- **THEN** the loader SHALL report a subject mismatch, the phase SHALL be treated as having no current evidence, and the guidance SHALL be to re-run the verifier

#### Scenario: Editing the report after closure stales nothing

- **WHEN** a closed phase's `verifier.report.<subject>.md` is modified
- **THEN** evidence manifest recomputation and the review closure attestation SHALL both remain valid, and no phase SHALL be marked stale
