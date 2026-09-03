# framework-integrity Specification

## Purpose
TBD - created by archiving change consumer-write-guard. Update Purpose after archive.
## Requirements
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

### Requirement: hooks_config adapter field materializes via structured upsert

The adapter schema SHALL provide `hooks_config`（template_path/target_path/update_policy; materialization kind `structured_upsert`）for host-shared hook registries such as `.cursor/hooks.json`. Materialization SHALL create `{version:1, hooks:{…}}` when absent; when present and valid it SHALL upsert only framework-owned entries（ownership key = the entry's `command` path; matcher/timeout are framework-managed mutable fields updated in place; duplicate owned entries deduplicate to one; future command changes migrate via `LEGACY_OWNED_COMMANDS`）, preserving all third-party entries, top-level and unknown fields. **Every write path SHALL honor structured upsert**: mechanism sync（`applyInitMechanismSync`）and adapter materialization（`materialize-adapter:` / `materialize-adapter-file:` via `syncTemplateTarget`）alike——no path may treat a `structured_upsert` target as verbatim bytes. **Schema-incompatible targets SHALL block, never be rewritten**: a `hooks` value that is not a plain object, or a managed event whose value is not an array, is host-owned semantics（`invalid_schema`, no output text generated）; invalid JSON likewise blocks. Blocked states SHALL propagate as an init BLOCKER（check id `hooks_config_target_compatible`）and a `blocked` sync effect——never silently recorded as unchanged; the S3 preflight（`preflightValidateHooksConfigTargets`）SHALL detect incompatible targets read-only BEFORE any task writes, so preceding tasks leave zero disk writes. **Validation SHALL cover all materialized adapters**（union of context adapters and `framework.config.json` `materialized_adapters`, not just the primary）at all three surfaces: preflight, executor, and check-init inspection. Removal semantics（delete owned/legacy entries only, preserve third-party entries, clean emptied containers）SHALL be provided by `computeHooksConfigRemoval`; wiring it into an uninstall/adapter-switch flow is deferred until such a flow exists（no parallel flow invented for it）. `hooks_config` SHALL NOT participate in `resolveEnforcementTier` hard_hook detection（cursor stays `soft_rule_only`, pinned by regression test）.

Enforcement: `harness/scripts/utils/hooks-config-upsert.ts`, `harness/scripts/utils/init-task-executor.ts`, `harness/scripts/check-init.ts`, `agents/adapter-schema.yaml`

#### Scenario: Schema-incompatible host config blocks init visibly

- **WHEN** `.cursor/hooks.json` contains `{"hooks":"team-owned"}` or a managed event as a non-array, or is invalid JSON
- **THEN** upsert SHALL return `invalid_schema`/`invalid_json` with no rewrite text, the sync effect SHALL be `blocked`, and check-init SHALL emit BLOCKER `hooks_config_target_compatible`（verified by an init integration fixture, not only helper unit tests）

#### Scenario: Team hooks survive framework updates

- **WHEN** `.cursor/hooks.json` already contains third-party hooks and framework runs UPDATE
- **THEN** only the framework-owned entry is inserted/updated（idempotent across repeated runs）and every other entry/field survives byte-meaningfully

#### Scenario: Matcher evolution stays idempotent

- **WHEN** the framework template's matcher changes（e.g. Write|Delete → Write|StrReplace|Delete）
- **THEN** UPDATE SHALL update the owned entry in place（array length unchanged; no stale matcher residue）

#### Scenario: Secondary adapter cannot bypass structured upsert

- **WHEN** `materialized_adapters` is `["claude","cursor"]`（cursor not primary）and init materializes the cursor adapter
- **THEN** `.cursor/hooks.json` SHALL be structurally merged（third-party entries and top-level fields preserved, framework entry upserted）; an incompatible target SHALL be caught by the preflight across ALL materialized adapters（zero disk writes for preceding tasks）, by the executor（task failed, host file byte-identical）, and by check-init BLOCKER `hooks_config_target_compatible`

### Requirement: Release artifacts ship a per-file integrity manifest

The release packer SHALL compute sha256 over staged, sanitized, LF-normalized shipped bytes and write `RELEASE-MANIFEST.json` plus the existing manifest-SHA sidecar. Pack/release verify and the explicit updater/integration boundary SHALL retain their package validation. Ordinary consumer phases SHALL NOT recompute or compare installed files.

The manifest fields and sidecar MAY be read as non-blocking package identity without becoming a runtime integrity verdict.

Enforcement: `scripts/pack-release.mjs`, `scripts/verify-release-pack.mjs`, explicit integration/candidate binding

#### Scenario: Ordinary phases only read identity

- **WHEN** an ordinary phase runs from a consumer release
- **THEN** it MAY display package identity but SHALL NOT traverse per-file manifest entries or compare them to installed bytes

### Requirement: Canonical enforcement paths are mechanically closed

Repository validation SHALL parse canonical `openspec/specs/*/spec.md` `Enforcement:` lines and require every exact repository-relative file path to exist. Missing exact paths MUST fail strict OpenSpec or release validation; functions, prose labels and supported glob expressions SHALL be classified separately rather than mistaken for exact files.

Enforcement: `scripts/check-openspec-enforcement-paths.mjs`, `package.json`

#### Scenario: Canonical requirement names a removed runtime file
- **WHEN** an `Enforcement:` line contains an exact path to a file that does not exist
- **THEN** repository validation fails and reports the spec line and missing path

#### Scenario: Enforcement names a function beside a valid file
- **WHEN** an `Enforcement:` line names a valid file plus a non-path function symbol
- **THEN** the file is validated and the symbol is not treated as a missing filesystem path

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
