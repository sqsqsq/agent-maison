## ADDED Requirements

### Requirement: Runtime artifact policy is a single cross-runtime SSOT

`specs/runtime-artifact-policy.json` SHALL be the only source of truth for framework runtime-artifact whitelisting（`ignored_runtime_patterns` / `generated_file_patterns` / `reserved_metadata_files`）. `canonical-gitignore.ts` SHALL derive its framework-runtime gitignore section from it; `framework-integrity.ts`（CJS TS）and `agents/shared/guard-framework-write-core.mjs`（node ESM）SHALL read the same file. No consumer of the policy may maintain a second list.

Enforcement: `specs/runtime-artifact-policy.json`, three-way consistency unit tests

#### Scenario: Three consumers agree

- **WHEN** the policy JSON, the gitignore derivation, and the hook-core matcher are compared over a fixture path matrix
- **THEN** classification SHALL agree pairwise; a drifted local list in any consumer SHALL fail the consistency tests

### Requirement: Write-time guard blocks editing-tool writes into vendored framework/

In consumer layout（`framework/RELEASE-MANIFEST.json` present）, adapter hooks SHALL deny editing-tool writes targeting `framework/**` unless the path matches the **write-allow** predicate（`ignored_runtime_patterns` + `generated_file_patterns` only——`reserved_metadata_files` such as the manifest sidecar are integrity anchors produced by the packer and SHALL be write-denied even though the scan predicate accepts their presence）or a structurally human-approved `integrity.drift_allowlist` entry. Repo identity SHALL derive from the hook script's physical layout（never from payload `cwd`, which may be a subdirectory）; `cwd` is only the resolution base for relative target paths, and `file://` URIs SHALL be converted via `fileURLToPath`. The claude adapter SHALL register a PreToolUse hook（matcher `Write|Edit|MultiEdit|NotebookEdit`）; the cursor adapter SHALL register a preToolUse entry in `.cursor/hooks.json` invoking the in-package shell. Both shells SHALL share `agents/shared/guard-framework-write-core.mjs`. The guard SHALL fail open on any evaluation error（check-time scanning remains the backstop）, and SHALL NOT be claimed as full write coverage（shell redirection is out of scope）.

Enforcement: `agents/shared/guard-framework-write-core.mjs`, `agents/claude/templates/hooks/guard-framework-write.mjs`, `agents/cursor/hooks/guard-framework-write.mjs`

#### Scenario: Temp script into framework/harness/scripts is denied with educational guidance

- **WHEN** an agent attempts to Write `framework/harness/scripts/tmp-*.mjs` in a consumer project
- **THEN** the hook SHALL deny（claude: exit 2 + stderr; cursor: `{permission:"deny", user_message, agent_message}` + exit 0）and the message SHALL point to the scratch/ convention and framework-init UPDATE

#### Scenario: Invalid allowlist entries cannot unlock the guard

- **WHEN** `integrity.drift_allowlist` contains a legacy string entry, an automation signer, a `user_requirement` sentinel, or lacks rationale/approved_by
- **THEN** the write guard SHALL still deny（same approval semantics as the check-time gate, verified by a cross-implementation parity test）

#### Scenario: Source layout is unaffected

- **WHEN** no `framework/RELEASE-MANIFEST.json` exists（agent-maison source repo）
- **THEN** the guard SHALL allow all writes

### Requirement: Foreign files inside framework/ are detected at check time

The integrity preflight SHALL walk the consumer `framework/` tree and report files present on disk but absent from `manifest.files` as a BLOCKER（independent check id `framework_foreign_file`）, whitelisting only runtime-artifact-policy matches and human-approved allowlist entries. Symlinks/junctions SHALL be evaluated **before any exemption** and treated as foreign unconditionally—manifest membership, runtime-artifact policy, and drift allowlist SHALL NOT exempt a link（a whitelisted directory junctioned out of tree, or the reserved sidecar replaced by a file symlink, must be reported; the manifest self-check SHALL additionally hard-fail when the sidecar itself is a link）. The walk SHALL NOT follow links. Vision canary artifacts SHALL be whitelisted by exact filename patterns（never the whole assets/ directory）. Honest cost: layouts that junction runtime directories（e.g. pnpm-style node_modules links）will be flagged; use real directories or the human-approved global downgrade.

Enforcement: `harness/scripts/utils/framework-integrity.ts` `scanForeignFiles`

#### Scenario: The incident's tmp script is caught

- **WHEN** `framework/harness/scripts/tmp-ocr-audit.mjs` exists and is not in the manifest
- **THEN** `framework_foreign_file` SHALL FAIL as BLOCKER while `framework_integrity`（per-file drift）reports independently（no swallowing）

#### Scenario: Junction cannot escape the scan root

- **WHEN** a directory junction inside framework/ points outside the tree
- **THEN** the scan SHALL NOT traverse it and SHALL flag the link itself as foreign

### Requirement: Consumer hashing matches pack semantics（EOL-normalized）

The consumer per-file hash SHALL replicate pack-side classification and normalization exactly: known-binary extensions first（raw bytes even without NUL）, then NUL heuristic, then `/\r\n?/g` EOL normalization for text. CRLF or lone-CR rewrites of unchanged content SHALL NOT report drift; real content changes SHALL. A source-repo parity test SHALL compare the TS implementation against `scripts/release-pack-rules.mjs` over a fixture matrix.

Enforcement: `framework-integrity.ts` `sha256FileEolNormalized`, parity unit test

#### Scenario: CRLF rewrite no longer forges drift

- **WHEN** a tool rewrites a framework text file with CRLF（bytes differ, content identical）
- **THEN** the per-file comparison SHALL PASS（the incident's false-drift → manifest-recompute chain is cut at its root）

### Requirement: Manifest self-check via in-package sidecar

The packer SHALL write `framework/RELEASE-MANIFEST.sha256`（single 64-hex lowercase line + trailing LF = sha256 of the manifest's raw bytes）into the package, excluded from `manifest.files`（circular dependency）. `release:verify` coverage SHALL exclude exactly {RELEASE-MANIFEST.json, RELEASE-MANIFEST.sha256} and SHALL assert sidecar format and content. The consumer preflight SHALL run an independent `framework_manifest_selfcheck` using the **same strict format**（64-hex + mandatory trailing LF）: match → PASS and continue; mismatch → BLOCKER FAIL and stop per-file/foreign checks（manifest untrusted）; **missing → BLOCKER FAIL and continue**——the selfcheck code ships with ≥3.0.0 packages（code and package share one tree in consumer layout）, so a missing sidecar can only mean deletion or a non-release deployment, never a "legacy package"（true pre-3.0.0 hosts run pre-3.0.0 code without this check at all）. This closes the delete-sidecar-then-recompute-manifest bypass. `workspace_tmp_hygiene` SHALL run regardless.

Enforcement: `pack-release.mjs`, `verify-release-pack.mjs`, `framework-integrity.ts` `runManifestSelfcheck`

#### Scenario: Recomputing the manifest to mask drift is caught

- **WHEN** an agent recomputes manifest hashes to match locally drifted files（sidecar no longer matches manifest bytes）
- **THEN** `framework_manifest_selfcheck` SHALL FAIL as BLOCKER with guidance to never hand-recompute, and subsequent per-file checks SHALL stop

#### Scenario: Deleting the sidecar cannot disarm the chain

- **WHEN** an agent modifies a file, recomputes the manifest, and deletes the sidecar
- **THEN** `framework_manifest_selfcheck` SHALL FAIL as BLOCKER（`framework_manifest_sidecar_missing`）while per-file/foreign checks continue for diagnostics

### Requirement: hooks_config adapter field materializes via structured upsert

The adapter schema SHALL provide `hooks_config`（template_path/target_path/update_policy; materialization kind `structured_upsert`）for host-shared hook registries such as `.cursor/hooks.json`. Materialization SHALL create `{version:1, hooks:{…}}` when absent; when present and valid it SHALL upsert only framework-owned entries（ownership key = the entry's `command` path; matcher/timeout are framework-managed mutable fields updated in place; duplicate owned entries deduplicate to one; future command changes migrate via `LEGACY_OWNED_COMMANDS`）, preserving all third-party entries, top-level and unknown fields. **Every write path SHALL honor structured upsert**: mechanism sync（`applyInitMechanismSync`）and adapter materialization（`materialize-adapter:` / `materialize-adapter-file:` via `syncTemplateTarget`）alike——no path may treat a `structured_upsert` target as verbatim bytes. **Schema-incompatible targets SHALL block, never be rewritten**: a `hooks` value that is not a plain object, or a managed event whose value is not an array, is host-owned semantics（`invalid_schema`, no output text generated）; invalid JSON likewise blocks. Blocked states SHALL propagate as an init BLOCKER（check id `hooks_config_target_compatible`）and a `blocked` sync effect——never silently recorded as unchanged; the S3 preflight（`preflightValidateHooksConfigTargets`）SHALL detect incompatible targets read-only BEFORE any task writes, so preceding tasks leave zero disk writes. **Validation SHALL cover all materialized adapters**（union of context adapters and `framework.config.json` `materialized_adapters`, not just the primary）at all three surfaces: preflight, executor, and check-init inspection. Removal semantics（delete owned/legacy entries only, preserve third-party entries, clean emptied containers）SHALL be provided by `computeHooksConfigRemoval`; wiring it into an uninstall/adapter-switch flow is deferred until such a flow exists（no parallel flow invented for it）. `hooks_config` SHALL NOT participate in `resolveEnforcementTier` hard_hook detection（cursor stays `soft_rule_only`, pinned by regression test）.

Enforcement: `harness/scripts/utils/hooks-config-upsert.ts`, `harness/scripts/utils/init-task-executor.ts`, `check-init.ts`, `agents/adapter-schema.yaml`

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

### Requirement: Workspace tmp-script hygiene advisory

The preflight SHALL shallow-scan the repo root and `scripts/`（depth ≤2）for `tmp-*.{js,mjs,cjs,ts}` files（git-ignored hits filtered when git is available）and report them as an independent `workspace_tmp_hygiene` MAJOR WARN pointing to the scratch/ convention. This is a naming heuristic—no intent judgement, never a BLOCKER（the host root is host property）—and SHALL coexist with all other integrity results.

Enforcement: `framework-integrity.ts` `runWorkspaceTmpHygieneScan`

#### Scenario: The incident's root-scripts leg becomes visible

- **WHEN** `scripts/tmp-add-ocr.js` exists untracked in the host root
- **THEN** `workspace_tmp_hygiene` SHALL WARN alongside any `framework_foreign_file` result（neither swallows the other）
