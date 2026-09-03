## ADDED Requirements

### Requirement: Framework write authority comes from an out-of-model security principal

Framework control-plane write authority SHALL be granted by the execution environment, never declared inside Maison. A Maison maintainer task may write the source repository and release artifacts; an ordinary host consumer task SHALL see framework control-plane paths as read-only while host product/feature/runtime paths remain writable; a user- or CI-triggered updater may hold temporary framework write access only for an explicit integration operation and SHALL return the control plane to read-only when it completes.

Task sandbox permissions, read-only mounts, restricted OS tokens, and ACLs MAY provide this boundary. Environment variables, config fields, agent names, the current directory, Git repository membership, Git HEAD, and working-tree state SHALL NOT constitute identity. Where maintainer and host agent run as the same OS user without a restricted token, Maison SHALL NOT claim isolation and SHALL NOT substitute a hash or Git detector for it.

Enforcement: `skills/reference/consumer-framework-boundary.md`, `templates/AGENTS.md.template`, execution-environment policy

#### Scenario: Strong isolation denies a host write

- **WHEN** a host consumer task attempts to write a framework control-plane source file under a restricted token, ACL, or read-only mount
- **THEN** the OS or sandbox SHALL deny it without any runtime hash or Git comparison

#### Scenario: Identity is never self-declared

- **WHEN** an agent changes an environment variable, config field, name, cwd, Git branch, commit, or staging state
- **THEN** no framework write authority SHALL follow

### Requirement: Without strong isolation the boundary is one cooperative editing-tool guard

Where strong isolation is unavailable, Maison SHALL retain the existing Write/Edit/MultiEdit/NotebookEdit guard as a cooperative mistake-prevention measure. It SHALL deny editing-tool writes to framework control-plane paths except existing runtime write-allow paths. It SHALL fail open on evaluation errors and SHALL be documented as unable to cover shell redirection, scripts, `node -e`, arbitrary subprocesses, or out-of-process writers. Maison SHALL NOT add an after-the-fact detector to pretend these blind spots are covered.

Legacy `integrity.allow_local_drift` and `integrity.drift_allowlist` fields MAY remain parseable for lossless config migration, but SHALL be ignored, SHALL NOT unlock the guard, and SHALL NOT produce a runtime advisory or check result. Their migration notice SHALL live in schema/template/MIGRATION documentation.

Enforcement: `agents/shared/guard-framework-write-core.mjs`, adapter hook shells, `harness/config.ts`, `specs/framework.config.schema.json`

#### Scenario: Editing-tool write is denied

- **WHEN** an ordinary host agent uses a covered editing tool to write a framework control-plane file
- **THEN** the guard SHALL deny the operation and point to scratch or an explicit updater/upstream release path

#### Scenario: Shell coverage is not invented

- **WHEN** the environment cannot prevent a shell, script, or external process from writing framework
- **THEN** Maison SHALL document the blind spot and SHALL NOT claim a later Git/hash scan will detect it

#### Scenario: Retired config fields have zero runtime effect

- **WHEN** a legacy config contains `integrity.allow_local_drift` or `integrity.drift_allowlist`
- **THEN** config parsing SHALL succeed, guard/verdict SHALL be unchanged, and no runtime migration advisory or `framework_integrity` result SHALL be emitted

### Requirement: Ordinary runtime is invariant to host Git state

Ordinary init, global phases, feature phases, report-only runs, and goal gate invocations SHALL NOT inspect host Git state to decide framework identity, integrity, applicability, or verdict. Maison SHALL NOT produce `framework_integrity`, `framework_control_plane_dirty`, or a framework-Git-derived `framework_integrity_block`. It SHALL NOT retain an always-SKIP or always-PASS compatibility result.

The same installed release bytes SHALL yield the same Maison phase adjudication and Framework package identity whether framework is tracked dirty, staged, committed, entirely untracked, or outside a Git repository. Host product dirtiness SHALL likewise have no effect. Production code SHALL NOT start a Git subprocess with `frameworkRoot` as cwd to identify the framework.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/framework-integrity.ts`, `profiles/hmos-app/harness/visual-feedback.ts`

#### Scenario: A complete update overlays an old host HEAD

- **WHEN** a complete valid new release is mirrored over an older release recorded in host HEAD, producing modified, deleted, and untracked entries without add/stage/commit
- **THEN** the actual framework-init UPDATE orchestration SHALL finish with `run-global-phases` successful, catalog SHALL contain no framework Git result, and the init run-log/summary SHALL not report that task failed

#### Scenario: Five Git environments are equivalent

- **WHEN** identical valid release bytes are evaluated as tracked dirty, staged, committed, entirely untracked, and non-Git
- **THEN** Maison phase verdict/check classifications and Framework package identity SHALL be equal across all five environments

### Requirement: Write-time guard blocks editing-tool writes into the framework release

In consumer release layout (`framework/RELEASE-MANIFEST.json` present), adapter hooks SHALL deny covered editing-tool writes targeting `framework/**` unless the target matches the existing runtime write-allow predicate (`ignored_runtime_patterns` plus `generated_file_patterns`; shipped files and reserved metadata remain write-denied). Repo identity SHALL derive from the hook script's physical layout; payload cwd is only the base for relative targets, and file URLs SHALL use standard conversion. Claude, Cursor, and other materialized adapters SHALL use the shared core.

There SHALL be no allowlist unlock. The guard SHALL be described as cooperative and incomplete when strong isolation is absent; no Git dirty, manifest scan, foreign-file check, or any other check-time backstop SHALL be cited as fallback coverage.

Enforcement: `agents/shared/guard-framework-write-core.mjs`, adapter hooks/settings, agent rule templates

#### Scenario: A named approval cannot unlock the guard

- **WHEN** a legacy config names an approver for a framework path
- **THEN** the editing-tool guard SHALL still deny the control-plane write and no runtime advisory/check SHALL be generated

#### Scenario: Fail-open is not backstopped by a later scan

- **WHEN** the guard fails open on an evaluation error
- **THEN** no check-time integrity scan SHALL be introduced or cited as compensating coverage

### Requirement: Package identity is non-blocking and has one loader

One package identity loader SHALL read version, `source_commit`, and `built_at` from `RELEASE-MANIFEST.json`, and SHALL directly parse the existing `RELEASE-MANIFEST.sha256` 64-hex text as `manifest_sha256`. It SHALL NOT hash the sidecar text, traverse manifest `files[]`, recompute installed files, or read host Git.

check-init and visual-feedback SHALL reuse this loader. For visual-feedback schema compatibility, `framework_commit_sha` SHALL contain manifest `source_commit`, and `framework_package_digest` SHALL contain `manifest_sha256`. Missing/corrupt identity SHALL be rendered as null/unknown or a non-blocking warning and SHALL NOT affect an ordinary phase verdict.

Enforcement: `harness/scripts/utils/framework-integrity.ts`, `harness/scripts/check-init.ts`, `profiles/hmos-app/harness/visual-feedback.ts`

#### Scenario: Sidecar value is not double-hashed

- **WHEN** `RELEASE-MANIFEST.sha256` contains a valid manifest SHA
- **THEN** package identity and visual-feedback SHALL expose that exact value rather than sha256(sidecar file bytes)

#### Scenario: Host commit cannot change package identity

- **WHEN** the same release bytes move from dirty/staged to committed host state
- **THEN** `framework_commit_sha` SHALL remain the manifest `source_commit` and every Framework identity field SHALL remain unchanged

## MODIFIED Requirements

### Requirement: Runtime artifact policy is a single cross-runtime SSOT

`specs/runtime-artifact-policy.json` SHALL remain the only source of truth for framework runtime-artifact whitelisting (`ignored_runtime_patterns` / `shipped_files_in_runtime_dirs` / `generated_file_patterns` / `reserved_metadata_files`). It SHALL describe only Maison's own output and guard paths inside `framework/`; it SHALL NOT derive, describe, or compensate for any host source-control configuration.

Its consumers SHALL be exactly two, reading the same file with equivalent glob-lite semantics: the Git-neutral TypeScript helper `harness/scripts/utils/runtime-artifact-policy.ts` (release/package boundary checks) and `agents/shared/guard-framework-write-core.mjs` (write-time editing-tool guard). `canonical-gitignore.ts` SHALL NOT be a consumer — the file is deleted along with the host `.gitignore` derivation, equivalence map, advisories, and writer. No consumer may maintain a second list, and the policy SHALL NOT gain a second copy, cache, or derived state file.

Enforcement: `specs/runtime-artifact-policy.json`, `harness/scripts/utils/runtime-artifact-policy.ts`, `agents/shared/guard-framework-write-core.mjs`, policy↔consumer consistency unit tests

#### Scenario: Both consumers agree on the same SSOT

- **WHEN** the policy JSON, the Git-neutral TS helper, and the hook-core matcher are compared over a fixture path matrix
- **THEN** classification SHALL agree pairwise; a drifted local list in either consumer SHALL fail the consistency tests

#### Scenario: Policy has no host SCM derivation

- **WHEN** the policy file and its consumers are inspected
- **THEN** they SHALL contain no host `.gitignore` derivation, ignore-equivalence map, ignore advisory, or `!`-rule generation, and the policy comments SHALL describe only the guard, release file set, and Maison output boundary

### Requirement: Release artifacts ship a per-file integrity manifest

The release packer SHALL compute sha256 over staged, sanitized, LF-normalized shipped bytes and write `RELEASE-MANIFEST.json` plus the existing manifest-SHA sidecar. Pack/release verify and the explicit updater/integration boundary SHALL retain their package validation. Ordinary consumer phases SHALL NOT recompute or compare installed files.

The manifest fields and sidecar MAY be read as non-blocking package identity without becoming a runtime integrity verdict.

Enforcement: `scripts/pack-release.mjs`, `scripts/verify-release-pack.mjs`, explicit integration/candidate binding

#### Scenario: Ordinary phases only read identity

- **WHEN** an ordinary phase runs from a consumer release
- **THEN** it MAY display package identity but SHALL NOT traverse per-file manifest entries or compare them to installed bytes

## REMOVED Requirements

### Requirement: Write-time guard blocks editing-tool writes into vendored framework/

**Reason**: 该 requirement 的三处结论已被本 change 推翻：(1) `integrity.drift_allowlist` 的结构化人工审批解锁通道随 runtime hash 家族一并退役——同一可写主体既能改 framework 也能改审批文件；(2) "check-time scanning remains the backstop" 依赖的 consumer 期完整性扫描已删除，fail-open 不再有事后兜底；(3) "vendored framework/" 属操作性 submodule/vendor 叙事，与发布件唯一拓扑冲突。标题与正文同时变更，故以 REMOVED + ADDED（`Write-time guard blocks editing-tool writes into the framework release`）成对替换，而非 MODIFIED。

**Migration**: 守卫本体、hook 注册与 shared core 全部保留，语义改由 ADDED requirement 承载：无解锁通道、无 check-time 兜底、诚实声明 shell/脚本/场外进程盲区。`integrity.drift_allowlist` / `allow_local_drift` 仅保留存量配置解析兼容，读取即忽略。

### Requirement: Consumer harness enforces framework source integrity

**Reason**: Runtime hash and scoped Git dirty are both same-principal after-the-fact detectors. Git status also blocks valid release upgrades and changes with host commit policy.

**Migration**: Strong environments use OS/sandbox read-only enforcement. Same-user environments retain only the cooperative editing-tool guard and its documented blind spots. Historical results remain readable; new runs produce no replacement check.

### Requirement: Foreign files inside framework/ are detected at check time

**Reason**: Neither manifest scanning nor Git untracked scanning proves source or authority; ordinary runtime shall not inspect the installed tree for identity.

**Migration**: Covered editing tools remain guarded. Shell/external writers are an acknowledged blind spot without strong isolation.

### Requirement: Consumer hashing matches pack semantics（EOL-normalized）

**Reason**: Consumer per-file hashing is removed. EOL normalization remains a release-boundary concern and the generic text helper may remain for unrelated consumers.

**Migration**: Pack/verify tests retain LF/hash semantics; ordinary phase code does not consume them.

### Requirement: Manifest self-check via in-package sidecar

**Reason**: Runtime sidecar verification was another same-principal detector. The sidecar remains release identity and trusted-boundary verification input only.

**Migration**: Ordinary runtime may display the declared manifest SHA non-blockingly; it does not validate installed bytes.

### Requirement: Workspace tmp-script hygiene advisory

**Reason**: Host-root naming heuristics are unrelated to framework package identity.

**Migration**: Scratch guidance remains documentation; no check result is produced.
