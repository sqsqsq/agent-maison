# Agent Adapters Specification

## Purpose

Define how AgentMaison exposes framework skills to different AI coding assistants
via adapter plugins without duplicating skill logic or phase rules.
## Requirements
### Requirement: Each adapter is a self-contained plugin directory

The system SHALL require every adapter to live under `agents/<adapter_name>/` with
an `adapter.yaml` that conforms to `agents/adapter-schema.yaml`.

#### Scenario: Known adapters present
- **WHEN** the framework is inspected for supported adapters
- **THEN** `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, and `agents/generic/adapter.yaml` MUST exist and validate against the schema

> **Enforced by:** `agents/adapter-schema.yaml`, `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, `agents/generic/adapter.yaml`

### Requirement: Adapters do not contain skill logic

The system MUST NOT allow adapters to embed phase rules or skill workflow logic;
adapters SHALL only expose skill entry points (slash commands, bridge files, rules)
to the instance project root. Adapter templates MUST NOT duplicate confirmation
option text that belongs in `skills/reference/confirmation-registry.yaml`; slash
commands MAY retain a one-line platform strong constraint but MUST link to
interaction-renderer and registry SSOT instead of per-skill widget-options files.

#### Scenario: Claude slash commands link registry and renderer
- **WHEN** a Claude slash command template under `agents/claude/templates/commands/`
  is inspected
- **THEN** it MUST reference `confirmation-registry.yaml` options and
  `interaction-renderer.md`, and MUST NOT reference `widget-options/` or
  `confirmation-ux.md`

> **Enforced by:** `agents/claude/templates/commands/*.md`,
> `harness/scripts/check-skills-confirmation-ux.ts`,
> `harness/scripts/smoke-interaction-renderer.ts`

### Requirement: Adapter outputs target instance project root

The system SHALL generate all adapter artifacts relative to the consumer instance
project root, not inside the framework release directory.

#### Scenario: Agent entry file targets instance root
- **WHEN** framework-init runs with a selected adapter
- **THEN** the generated agent entry file (e.g. `AGENTS.md`) MUST appear at the instance project root as defined by `agent_entry_file.target_path` in the adapter config

> **Enforced by:** `agents/*/adapter.yaml`, `skills/project/framework-init/SKILL.md`, `harness/scripts/check-init.ts`

### Requirement: Project init materializes multiple adapters

Project init MUST support `materialized_adapters` with one
`materialize-adapter:<name>` task per adapter. Committed artifacts for each
adapter MUST be rendered using that adapter identity, not the personal
`local.agent_adapter`.

#### Scenario: Claude and Cursor artifacts coexist
- **WHEN** `materialized_adapters` is `["claude","cursor"]`
- **THEN** both `.claude/` and `.cursor/` (and entry files) MAY exist without conflict

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`

### Requirement: Personal setup does not write project artifacts

Personal setup MUST only write `framework.local.json` and MUST use
`assert-active-adapter-materialized` as a read-only check **before**
`record-adapter`. If the chosen adapter is not materialized, setup MUST stop
and direct the user to project init without writing local config.

#### Scenario: Setup writes only framework.local.json
- **WHEN** personal setup completes S3 for `record-adapter` and optional
  `record-deveco-path`
- **THEN** only `framework.local.json` MUST be created or updated; project
  config and adapter directories MUST NOT be modified by setup tasks

#### Scenario: Assert failure does not write local config
- **WHEN** S3 runs personal setup with `activeAdapter` whose entry file is not
  materialized
- **THEN** `assert-active-adapter-materialized` MUST fail, `record-adapter` MUST
  be skipped, and `framework.local.json` MUST NOT be created or updated

> **Enforced by:** `skills/reference/personal-setup-gate.md`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate-smoke.unit.test.ts`

### Requirement: Adapters may declare optional goal_capability

The system SHALL allow adapters to declare an optional `goal_capability` block in `adapter.yaml` with `mode` (`native_goal` | `external_runner`), headless invoke templates, and unattended permission contract.

Enforcement: `agents/adapter-schema.yaml`, `harness/scripts/check-init.ts`

#### Scenario: check-init warns on missing goal_capability

- **WHEN** framework-init check-init runs and adapter lacks `goal_capability`
- **THEN** check-init MUST emit WARN only and MUST NOT BLOCKER-fail init

#### Scenario: goal-runner preflight blocks missing capability

- **WHEN** goal-runner starts with active adapter lacking valid `goal_capability`
- **THEN** preflight MUST exit non-zero before agent invocation

### Requirement: Adapter goal capabilities declare reconcile execution support
`agents/adapter-schema.yaml` SHALL allow adapters to declare support for in-session reconciliation, phase-context isolation, external unattended execution, resume, and bidirectional handoff. `harness/scripts/utils/goal-adapter-capability.ts` SHALL validate the declaration.

#### Scenario: Adapter declares handoff without resume
- **WHEN** an adapter capability enables handoff but lacks the required resume capability
- **THEN** adapter validation MUST fail

### Requirement: Capability routing is fail-closed
Command-capable sessions with valid materialized adapters SHALL share the same non-resident next/report runtime handoff regardless of in_session_reconcile or phase_context_isolation. Isolation SHALL describe only executor context arrangement, without waiving required independent verification. Unattended execution and native transport handoff SHALL retain corresponding capability/preflight requirements; missing required capability SHALL halt with a truthful gap. Framework handoff recovery SHALL NOT depend on model CLI native resume.

#### Scenario: Unattended permission contract is incomplete
- **WHEN** unattended mode is requested and the active adapter fails existing external-runner preflight
- **THEN** the run MUST halt before autonomous mutation and report the missing capability

#### Scenario: In-session capability is absent
- **WHEN** attended goal mode is requested with valid configuration but no phase isolation
- **THEN** the framework SHALL use the same next/report runtime in the main context and disclose the arrangement

### Requirement: Existing adapter behavior remains backward compatible
Adapters that currently support external-runner goal execution SHALL retain their existing headless invoke, permission, output-delivery, tool-event, and usage-capture semantics unless they explicitly opt into new in-session or handoff capability fields.

#### Scenario: Legacy adapter omits new capability fields
- **WHEN** an existing adapter is loaded after upgrade
- **THEN** external-runner behavior SHALL remain available under existing preflight while next/report session handoff is available independently of the new flags and native transport handoff remains disabled

### Requirement: Phase-driven fidelity routing initialization has one flow owner and one implementation

The phase-driven initializer SHALL be owned by `skills/feature/spec` Step 1 (invoked before generating spec.md) and implemented solely by the runner-owned `fidelity-intent-init` CLI wrapping the same `initializeFidelityRouting` used by the goal preflight. Adapter thin entries (cursor/claude/codex slash commands, bridge files, rules) SHALL only pass user input through and direct the agent to the Skill — they MUST NOT initialize routing or write the intent/snapshot artifacts, so every adapter gets identical auto-tiering behavior and the SSOT has a single writer.

Enforcement: `skills/feature/spec/SKILL.md`, `harness/scripts/fidelity-intent-init.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: adapters do not fork the initialization behavior

- **WHEN** a phase-driven spec session starts from any adapter's thin entry
- **THEN** routing artifacts are produced only via the Skill-invoked runner-owned CLI, and no adapter-specific entry writes fidelity-intent.json

### Requirement: usage_capture capability field

adapter goal capability MUST 支持 `usage_capture: none|stdout_json|stderr_regex|sidecar|api`（缺省 none）；usage 采集实现 MUST 按声明分派（api/sidecar 优先），MUST NOT 对未声明能力的 adapter 猜测采集方式。

#### Scenario: 未声明即按 none
- **WHEN** adapter manifest 无 usage_capture 字段
- **THEN** 采集按 none 处理，该 adapter 的跑动只产出代理指标

> **Enforced by:** `agents/adapter-schema.yaml`, `harness/scripts/utils/agent-invoke.ts`

### Requirement: Adapters declare interaction renderer rules

The system SHALL require every adapter with a non-null `user_confirmation` block to
declare `interaction_renderer_rule` (path relative to the adapter directory) that
injects platform-specific rendering protocol into the consumer instance.

#### Scenario: Claude adapter renderer template exists
- **WHEN** `agents/claude/adapter.yaml` is loaded
- **THEN** `user_confirmation.interaction_renderer_rule` MUST resolve to
  `templates/rules/interaction-renderer.md` and the template MUST exist on disk

#### Scenario: Generic custom bundle root relocates renderer
- **WHEN** framework-init runs with `agent_adapter=generic` and
  `paths.agent_bundle_root` is a custom relative path (e.g. `.codex`)
- **THEN** the interaction renderer MUST be materialized under
  `<agent_bundle_root>/rules/interaction-renderer.md`, not the default
  `.agents/rules/` path from adapter.yaml

> **Enforced by:** `agents/adapter-schema.yaml`, `agents/*/adapter.yaml`,
> `harness/scripts/check-init.ts`, `harness/scripts/smoke-interaction-renderer.ts`

### Requirement: All adapters support deprecated artifact cleanup

The system SHALL execute registered artifact retirement through the UPDATE S3
`cleanup-deprecated` task. Cleanup SHALL cover every adapter in the release,
including adapters absent from the current `materialized_adapters` selection.
Adapters MAY omit `deprecated_artifacts` when they have no dedicated retired paths.
Cleanup SHALL preserve host-owned content and back up changed artifacts under
`.framework-backup/<timestamp>/`; S1 probing SHALL remain read-only.

#### Scenario: UPDATE cleans registered artifacts of an unselected adapter
- **WHEN** the current materialization selection contains only Cursor but registered
  retired files exist under `.claude/`, `.cac/` or `.codex/`
- **THEN** S3 SHALL inspect and clean those registered paths as well, without
  requiring those adapters to be rematerialized or clearing their entire directories

#### Scenario: Legacy bridges follow adapter directory declarations
- **WHEN** registered legacy skill or command names exist in an adapter's materialization directory
- **THEN** cleanup SHALL derive their paths from that adapter's `skill_bridge` and
  `commands` declarations; generic SHALL follow `paths.agent_bundle_root`
- **AND** current entries and unrelated host files SHALL remain intact

#### Scenario: Retired hook registrations are removed before scripts
- **WHEN** a retired script declares `deprecated_artifacts[].hook_configs`
- **THEN** cleanup SHALL back up and remove recognized registrations from those
  shared JSON files before deleting the script, preserving other configuration
- **AND** registration cleanup SHALL run even if the script is already missing;
  an empty `hooks/` directory left by successful script deletion SHALL be removed

#### Scenario: Unresolved references retain scripts and report incomplete cleanup
- **WHEN** configuration still contains a retired script's filename after recognized
  registrations have been removed
- **THEN** cleanup SHALL retain the script and record `blocked`, rather than deleting
  it beneath a remaining reference or guessing how to rewrite a composite command
- **AND** only when every remaining reference is a resolved single-script path outside
  the project SHALL the local copy still be deleted, recording a `warning` naming those
  paths and leaving the host configuration byte-for-byte unchanged; a path carrying an
  unexpanded variable or shell expression is never treated as outside the project

#### Scenario: Local failures do not stop other cleanup
- **WHEN** an adapter's configuration is invalid or cleanup raises an error
- **THEN** other adapters and legacy bridge cleanup SHALL continue and the final
  cleanup task SHALL be failed
- **WHEN** a script is instead `blocked`, or its references are unresolved-but-offsite
  (`warning`)
- **THEN** other cleanup SHALL likewise continue and the final cleanup task SHALL NOT
  be failed
- **AND** in every case S3 run-log SHALL retain successful `cleanup_results`,
  `cleanup_effects`, and blocked/warning/failed diagnostics, so correction and retry
  do not discard already completed cleanup

#### Scenario: CREATE, skip and repeat execution
- **WHEN** init is in CREATE mode or cleanup is explicitly skipped
- **THEN** no retirement cleanup SHALL occur
- **WHEN** UPDATE cleanup is repeated after successful retirement
- **THEN** already-cleaned files and registrations SHALL produce no further changes

> **Enforced by:** `agents/adapter-schema.yaml`, `harness/scripts/check-init.ts`,
> `harness/scripts/utils/init-task-executor.ts`, `harness/scripts/init-orchestrate.ts`,
> `harness/scripts/utils/materialized-adapters-resolve.ts`,
> `harness/scripts/utils/legacy-skill-bridge-cleanup.ts`,
> `harness/scripts/utils/hooks-config-upsert.ts`

### Requirement: Cursor adapter external_runner headless_invoke declaration

The Cursor adapter SHALL declare headless invoke as `cursor-agent -p` (not `cursor agent --print`) for capability validation; runtime structured argv SSOT remains `agent-invoke.ts`.

Enforcement: `agents/cursor/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: Cursor adapter yaml matches runtime

- **WHEN** maintainers read `agents/cursor/adapter.yaml` `headless_invoke`
- **THEN** it documents `cursor-agent -p` style invocation consistent with runtime `cursorHeadlessPlan`

### Requirement: Claude slash commands exclude personal setup

The Claude adapter MUST ship nine slash routing templates (catalog/glossary,
feature phases 1–6, framework-init) and MUST NOT ship `commands/framework-setup.md`.

#### Scenario: slash lint list excludes framework-setup
- **WHEN** `check-skills-confirmation-ux.ts` validates Claude slash templates
- **THEN** `commands/framework-setup.md` is not in `CLAUDE_SLASH_COMMANDS`

### Requirement: Skills bridge excludes personal-setup-gate

Generic/Cursor bridge materialization MUST NOT include `personal-setup-gate` stub;
personal setup is reached only via phase pre-gate `--ensure`.

#### Scenario: reserved bridge ids omit 00b
- **WHEN** `loadReservedBridgeIds` scans `skills-bridge/`
- **THEN** the set MUST NOT contain `personal-setup-gate`

> **Enforced by:** `agents/shared/agent-bundle/templates/skills-bridge/`,
> `harness/scripts/utils/agent-bundle-paths.ts`, `harness/tests/unit/generic-bundle.unit.test.ts`

### Requirement: Skills bridges are adapter-identity neutral

Generated skills-bridge stubs SHALL route to the canonical Skill without embedding a static resolved adapter identity. Bridge templates MUST NOT copy platform-specific `AskUserQuestion` or personal-setup option blocks; interaction rendering remains owned by each adapter's renderer, and a bridge MAY contain only renderer-neutral guidance to resolve `goal.run_mode` for an ambiguous fresh run.

Enforcement: `harness/scripts/utils/materialize-agent-bundle-skills.ts`, `harness/scripts/utils/init-task-executor.ts`, `agents/*/adapter.yaml`

#### Scenario: Shared generic and Chrys root is order independent

- **WHEN** generic and Chrys bundles materialize `.agents/skills/goal-mode/SKILL.md` in either order
- **THEN** the resulting bridge SHALL contain no adapter identity line, SHALL contain no `AskUserQuestion` options, and SHALL remain byte-compatible for coexistence

#### Scenario: Exclusive bridge root stays neutral

- **WHEN** a bridge is materialized under an adapter-exclusive bundle root
- **THEN** it SHALL still omit static adapter identity because personal setup remains the adapter SSOT

### Requirement: Goal entry records adapter provenance from the resolved source

The attended goal preparation entry SHALL accept adapter provenance returned by personal setup and SHALL write only a valid real source such as `local_config`. Its API type and CLI validation MUST consume the manifest-owned `RunAdapterProvenance` / `RUN_ADAPTER_PROVENANCES` SSOT rather than copying the enum. It MUST NOT hard-code `entry_declared` when the adapter came from local configuration and MUST NOT invent an `unknown` enum; when provenance cannot be established, the optional field SHALL be omitted or preparation SHALL fail closed.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/personal-setup-gate.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: Existing local adapter keeps local provenance

- **WHEN** personal setup resolves `activeAdapter=codex` from `framework.local.json` and attended preparation receives that source
- **THEN** the manifest SHALL record `adapter=codex` with `adapter_provenance=local_config`

#### Scenario: Unavailable provenance is not fabricated

- **WHEN** attended preparation cannot prove the adapter source
- **THEN** it SHALL omit the optional provenance or BLOCKER-fail, and MUST NOT write `unknown`

#### Scenario: Provenance enum evolves once

- **WHEN** the manifest-owned provenance list changes
- **THEN** the attended preparation API and CLI SHALL accept exactly that same list without a copied union or validator set

### Requirement: Codex declares streaming delivery and stdout-JSON usage capture

The Codex adapter SHALL declare `goal_capability.output_delivery: streaming` and
`goal_capability.usage_capture: stdout_json`, matching the observed behavior of `codex exec --json`
(events arrive on stdout as JSONL as they occur; the terminal `turn.completed` event carries the
turn's usage object, which the existing stdout-JSON usage parser reads without adding a capture
enum). The adapter SHALL keep `tool_event_provenance` at its default `none`.

The `--json` flag SHALL be appended by the adapter's own argv builder, independently of any
tool-evidence capability field, and SHALL be placed so that the previously verified flag order
(top-level approval flag before `exec`; `exec [--model <v>] --sandbox <mode>`) is unchanged. The
declarative `headless_invoke` template remains capability-validation only; the runtime argv builder
is the single source of truth.

Enforcement: `agents/codex/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: terminal flag is independent of tool-evidence declaration

- **WHEN** the adapter plan is built with any `tool_event_provenance` value
- **THEN** the resulting argv SHALL be byte-identical and SHALL contain the terminal-event flag,
  and SHALL NOT contain the Claude-family structured-output flags

### Requirement: Terminal event parsing is adapter-scoped and consumes stdout directly

Terminal event parsing SHALL be enabled only for adapters with a verified terminal contract, resolved
from the adapter identity of the invocation plan. The parser SHALL consume the raw stdout chunk
stream with cross-chunk line buffering and SHALL NOT require the three-file structured-event split
(that split belongs to the tool-evidence contract and is unrelated). The parser SHALL accept only
structured JSON lines: unparseable lines SHALL be skipped with no text-regex fallback, and events
nested inside turn items (including item-level error items and item error fields) SHALL NOT be
treated as turn terminal states.

Terminal event shapes SHALL be pinned by fixtures captured from real CLI runs; hand-written shapes
SHALL NOT be used as the contract baseline.

Enforcement: `harness/scripts/utils/codex-terminal-events.ts`,
`harness/tests/unit/fixtures/codex-terminal-*.jsonl`

#### Scenario: half-line chunk boundaries

- **WHEN** the terminal event stream is delivered in arbitrary chunk sizes that split JSON lines
- **THEN** the parser SHALL reach the same conclusion as it would for whole-line delivery, and SHALL
  fire each terminal observation at most once

#### Scenario: item-level errors inside a turn that completes

- **WHEN** a turn contains item-level error records and then emits its `completed` terminal event
- **THEN** the parser SHALL report completion and SHALL NOT report a terminal failure

### Requirement: Structured stdout envelopes are projected before canary grading

Canary grading SHALL project a structured stdout envelope back to the agent's message text before
applying line-anchored answer parsing, whenever the adapter's headless stdout is an envelope rather
than plain text.
Grading raw envelope bytes with line anchors yields a guaranteed miss and would misreport an adapter
that actually answered as one that did not answer. The projection dialect SHALL be resolved from the
adapter identity and its argv-injection conditions, and SHALL return no text when the envelope lacks
a successful terminal state — in which case the run SHALL decline to grade rather than guess.

Enforcement: `harness/scripts/utils/vision-canary.ts`, `harness/scripts/utils/codex-terminal-events.ts`,
`harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: adapter answers the canary inside a JSONL envelope

- **WHEN** the adapter's stdout is JSONL and its agent message contains the canonical answer lines
- **THEN** grading SHALL project the message text first and SHALL resolve the answer normally

### Requirement: A complete `visual_provider` declaration is the single source of provider support and eligibility

The adapter schema SHALL define an optional `visual_provider` object with the frozen shape
`{readonly_invoke, image_transport, stdout_envelope, model_replay}`. A declaration is **complete**
only when every field is present and valid, except that the combination
`profile_read_only_patch` / `prompt_path` / `final_jsonl` MAY omit `model_replay`
and SHALL replay the existing frozen `modelBinding` instead of inventing a model flag.

Provider support and provider run-time eligibility SHALL be derived **solely** by scanning that field
across the adapter catalog. The framework SHALL NOT maintain a TypeScript adapter whitelist, SHALL
NOT intersect with or subtract from the model-pin adapter set, SHALL NOT infer eligibility from
adapter kernel family (a Claude-kernel fork without its own declaration is **not** eligible), and
SHALL NOT keep a hand-written support list in documentation. Help text, interactive prompts, CLI
validation and runtime routing SHALL all consume the same catalog-derived result.

The ordinary `goal_capability` block SHALL NOT participate in provider eligibility: the complete
`visual_provider` declaration alone carries the invoke, model-replay, image-transport and
stdout-envelope contract. An adapter MAY therefore be a provider without being materialized as a
project adapter and without a usable `goal_capability`.

Eligibility SHALL follow each adapter's currently qualified declaration, including DSH's
independently verified read-only profile composition. A mechanism id kept in the vocabulary without any adapter claiming it (`ask_mode`,
`result_json`) SHALL NOT by itself confer eligibility on any adapter.

Each declaration SHALL be admitted only after a real invocation smoke run on the locked CLI version
proves the declared read-only isolation, model replay and image transport. Where a locked CLI does
not actually provide the declared isolation, the declaration SHALL NOT be admitted, and the provider
SHALL NOT fall back to the adapter's project-default configuration.

Enforcement: `agents/adapter-schema.yaml`, `agents/{claude,codex,opencode,deepseek-harness}/adapter.yaml`,
`harness/scripts/utils/adapter-catalog.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: DSH visual composition separates model replay from development permissions

- **WHEN** DSH is invoked as a visual provider with a frozen provider, full model ID and native source
- **THEN** the source patch SHALL precede the fixed visual patch, and precheck and spawn SHALL share the read-only intent
- **AND** the effective session SHALL be read-only/never with only required reading tools, image offload disabled and automatic compaction disabled
- **AND** ordinary development invocations SHALL retain their existing full-access contract

#### Scenario: DSH final and image evidence belong to the current invocation

- **WHEN** a DSH visual invocation returns, including a tool error followed by exit zero
- **THEN** acceptance SHALL require exit zero, the last complete final text and paired successful read_image evidence for every current input image
- **AND** a missing or malformed last final SHALL NOT reuse an earlier final, and no extra turn_end anchor SHALL be required
- **AND** the existing identity, image hash, payload and workspace checks SHALL continue to apply

Enforcement: `agents/deepseek-harness/visual-readonly-patch.yaml`, `harness/scripts/utils/agent-invoke.ts`,
`harness/scripts/utils/adapter-model.ts`, `harness/scripts/utils/codex-terminal-events.ts`,
`harness/tests/unit/visual-provider.unit.test.ts`, `harness/tests/unit/deepseek-harness-adapter.unit.test.ts`

#### Scenario: a Claude-kernel fork is not admitted by family

- **WHEN** an adapter shares the Claude kernel and its argv builders but declares no `visual_provider`
- **THEN** it SHALL NOT appear in the derived support list and SHALL NOT be accepted as a provider

#### Scenario: eligibility survives an unusable goal capability

- **WHEN** an adapter carries a complete `visual_provider` declaration while its `goal_capability` is
  missing or invalid
- **THEN** it SHALL remain an eligible provider, because provider eligibility reads only the
  `visual_provider` declaration

#### Scenario: the support list has exactly one source

- **WHEN** the support list is rendered into a prompt, a CLI error, or validation logic
- **THEN** every rendering SHALL come from the catalog scan, and no second enumeration of adapter
  names SHALL exist in code or documentation

### Requirement: Goal executors encapsulate agent invocation only

A `GoalPhaseExecutor` SHALL accept an immutable `PhaseExecutionContext` and return a normalized agent invocation result. The detached executor MAY implement adapter spawn, containment, timeout, stdout/stderr, structured events and usage capture; the attended executor MAY implement the existing host callback transport. Neither executor MUST own assessment, runtime fact preparation, harness gate calls, verdict, backtrack, close, handoff policy or event-ledger advancement.

Enforcement: `harness/scripts/utils/goal-phase-executor.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `agents/*/adapter.yaml`

#### Scenario: Adapter output is returned to the runtime

- **WHEN** the detached adapter process exits or times out
- **THEN** its executor SHALL return the normalized invocation result to `GoalPhaseRuntime` and MUST NOT directly emit a canonical phase verdict or call the harness gate

### Requirement: Device provider internals stay outside phase execution context

`PhaseExecutionContext` SHALL preserve the existing testing provider boundary and MUST NOT expose Hylyre vendor/source build layout, `.hylyre/build-src`, `vendor_artifact_kind`, provider installation state or other provider-private telemetry as canonical lifecycle or runtime ownership facts.

Enforcement: `harness/scripts/utils/goal-phase-executor.ts`, `harness/scripts/utils/goal-phase-runtime.ts`, `profiles/hmos-app/harness/*`

#### Scenario: Testing executor sees no vendor lifecycle state

- **WHEN** a testing phase uses the Hylyre device provider
- **THEN** the runtime SHALL invoke the existing harness/provider boundary and the executor context MUST NOT contain provider-private installation or vendor fields

### Requirement: Entry routing table with conservative default

实例根入口模板 MUST 含 L0/L1/L2 分流路由表：L0 direct（不进管线，但仍须遵守用户显式要求与项目原生 test/lint/build）、L1 lite、L2 full；判档拿不准时 MUST 写死保守缺省"进 lite"。track 建议 MUST 经 `feature.track` 确认 gate（登记 confirmation-registry）后生效。

#### Scenario: 模糊小需求默认进 lite
- **WHEN** 用户请求无法明确判 L0 或 L1
- **THEN** 入口路由指示按 lite 处理并走 feature.track 确认

> **Enforced by:** `templates/AGENTS.md.template`, `skills/reference/confirmation-registry.yaml`

### Requirement: Correction triage questions reside at entry

入口模板 MUST 常驻「修正三问」（≤15 行）：Q1 需求/验收变→spec；Q2 契约/设计变→plan；Q3 都不变→改代码 coding / 纯验证 ut·testing。对进行中 feature 的修正请求 MUST 先分层再动产物；模糊请求先诊断根因再分类。

#### Scenario: NL 修正回合规则在场
- **WHEN** 用户以自然语言对进行中 feature 提出修正（未触发任何 skill）
- **THEN** 会话上下文中已含修正三问与"禁止未分层直接动产物"约束（入口常驻）

> **Enforced by:** `templates/AGENTS.md.template`

### Requirement: change-lite skill is indexed and bridged

`feature/change-lite` skill MUST 登记于 `skills.index.yaml` 并按各 adapter 约定物化跳板；正文 MUST 遵守 C3 主干预算（≤150 行）。

#### Scenario: lite 入口可被 adapter 触发
- **WHEN** 消费者在任一物化 adapter 中请求 lite 流程
- **THEN** resolveSkillPath 能解析 change-lite 且跳板存在

> **Enforced by:** `skills/skills.index.yaml`, `agents/`（bundle 模板）

### Requirement: CodeAgent is in the supported headless full-permission set; Chrys stays refused

The headless full-permission support gate SHALL pass CodeAgent (reusing the existing
`--dangerously-skip-permissions` argv, stdin prompt delivery, stream-json events and Read parser
already shared with claude — the codeagentcli binary retaining the claude-family argv), and SHALL
continue to refuse Chrys until its non-interactive full-permission CLI arguments are verified by a
host. No experimental switches, authorization states, or speculative flag signatures are added;
real CodeAgent CLI flag errors are handled by the unified hard-CLI early halt (see goal-runner
delta) and appended to signatures only from observed evidence.

Enforcement: `harness/scripts/utils/agent-invoke.ts`, `agents/codeagent/adapter.yaml`, `agents/chrys/adapter.yaml`

#### Scenario: preflight passes codeagent and rejects chrys

- **WHEN** goal-runner preflight evaluates adapter support
- **THEN** `codeagent` returns `{ ok: true }` and `chrys` returns
  `adapter_headless_permission_unsupported` with the verification path

### Requirement: Claude and CodeAgent ship a dedicated author template

The shared `agents/claude/templates/agents/phase-executor.md` SHALL be materialized for Claude and CodeAgent with `update_policy: auto_overwrite`. The dedicated author SHALL perform work in its requested boundary and hand back the original outcomes. The coordinating runtime SHALL own dispatch, acceptance of independent verification, and formal closure.

Enforcement: `agents/claude/adapter.yaml`, `agents/codeagent/adapter.yaml`, `agents/claude/templates/agents/phase-executor.md`

#### Scenario: Materialization installs the dedicated author

- **WHEN** a consumer runs framework-init with Claude or CodeAgent
- **THEN** the current `phase-executor.md` SHALL be materialized to that adapter's managed agent directory

### Requirement: Transport capability does not set phase verification applicability

The shared phase verifier plan SHALL derive applicability from the profile, workflow and effective evidence policy. A transport or model binding gap SHALL retain the outstanding verification obligation and disclose the actual recovery condition. The same issued request and report contract SHALL apply across adapters.

#### Scenario: An adapter encountering a transport gap retains the obligation

- **WHEN** a full phase requires independent verification, a request is issued, and the current adapter cannot replay the chosen model
- **THEN** the verifier obligation SHALL remain outstanding and the runtime SHALL expose the actual model replay limitation

### Requirement: UPDATE retires the old managed verifier roles

New materialization SHALL omit the retired roles. An authorized UPDATE SHALL use `deprecated_artifacts` with `backup_delete` for the exact managed targets `.claude/agents/verifier.md`, `.cac/agents/verifier.md` and `.codex/agents/verifier.toml`. Other roles and user files SHALL remain intact.

Enforcement: `agents/claude/adapter.yaml`, `agents/codeagent/adapter.yaml`, `agents/codex/adapter.yaml`, `harness/scripts/utils/init-task-executor.ts`

#### Scenario: UPDATE backs up the exact legacy artifact once

- **WHEN** an eligible managed verifier file exists in the host during UPDATE
- **THEN** the original bytes SHALL be backed up under `.framework-backup/<stamp>/` before deletion
- **AND** a repeat UPDATE SHALL leave the same backups and unrelated files intact

### Requirement: Adapter subagent templates may be declared at the adapter top level

An adapter SHALL be able to declare its subagent template directory either at the top level of `agents/<name>/adapter.yaml`
as `subagents`, or in the historical position `commands.subagents`. Both positions SHALL carry the same fields
(`target_dir`, `template_dir`, `update_policy`) and the same semantics, and an adapter SHALL NOT declare both — when the
top-level field is present it SHALL win, and the mutual exclusivity SHALL be test-enforced across every adapter.

Collection SHALL happen outside the `commands` block: an adapter whose agent has no slash command surface declares
`commands: null`, and a subagent declaration reachable only from inside that block would never be materialized. The
resolved source SHALL be visible in the per-file inspection origin so that a materialized target names the field it came
from.

Enforcement: `agents/adapter-schema.yaml`, `harness/scripts/check-init.ts`, `harness/tests/unit/adapter-catalog-consistency.unit.test.ts`

#### Scenario: A slashless adapter materializes its subagent template

- **WHEN** an adapter declares `commands: null` and a top-level `subagents` block, and framework-init materializes it
- **THEN** every file under the declared `template_dir` SHALL appear in the adapter's template file list with the
  declared `update_policy`, and SHALL be written under the declared `target_dir`

#### Scenario: Adapters keeping the historical position are unaffected

- **WHEN** an adapter declares `commands.subagents` and no top-level `subagents`
- **THEN** its template entries SHALL keep the `commands.subagents.template_dir` origin and the same targets as before

### Requirement: Complete model binding across adapters

Every framework-dispatched responsibility SHALL replay its frozen provider, complete native model ID and applicable reasoning settings, or wait before a paid request. DSH SHALL load its foreground native model-source layer before the framework patch, remain headless, and validate final --dump-config source metadata without reading/copying credentials. Native auxiliary models SHALL retain foreground behavior. An observable main-model mismatch SHALL cancel the invocation immediately through the existing lifecycle.

DSH startup SHALL capture its exact session/home/profile from the foreground shell, use that session's last request header at launch, and freeze the actual profile source plus a non-secret route identity in the existing model pin. Manual request identifiers remain overrides. A same-path endpoint change SHALL require an authorized selection change. Native records that omit reasoning metadata SHALL not be treated as contradicting an explicit header. OpenCode user messages SHALL read the variant from their native nested model structure. Visual reuse SHALL compare the complete role binding and preserve the original invocation identity.

For native deepseek-official and deepseek-account routes absent from profile provider declarations, DSH SHALL bind the native version, provider, model and effective non-secret endpoint rather than require a synthetic pi-ai declaration. A detached child SHALL consume the captured pin unchanged, even when original model arguments remain present. Visual selection SHALL share the existing authorization decision at birth and rejoin. OpenCode foreground source-location parameters SHALL not alone constitute an explicit model change.

Enforcement: `harness/scripts/utils/adapter-model.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: DSH source exists only in desktop layer

- **WHEN** the selected volcengine route exists only in the foreground source layer
- **THEN** headless SHALL compose that layer, validate complete source metadata, and let native MISSING_CREDENTIAL reach the existing hard-failure classifier without trying another model


### Requirement: Adapters share source-bound intake and disclose write-time limits

所有已物化 adapter 的根入口/常驻规则/Skill 跳板 SHALL 指向 `docs/operations/project-entry.md` 同一前门，不各维护档位表。可用原生 payload/环境 SHALL 给原 compile/request 自动提供真实原件/session 与 user 消息定位；已有请求 SHALL 复用原 session-ref，显式交接支持该原生引用（含 JSONL/DSH 消息引用及 OpenCode SQLite 引用），reader 核真实用户来源/session/cwd；无可用原件 SHALL 准确降级，不把模型转述当用户覆盖。

已验证的编辑 hook SHALL 保留适用的 framework 发布件保护、原生权限与受管写界。产品编辑 SHALL NOT 以文档读取事件为放行条件。各客户端 SHALL 核真实项目与用户锚，工具调用和结果按准确配对与退出信息分别判断。普通记录缺失或错配 SHALL 局部披露；缺少唯一原件的验收保持欠验。原入口 SHALL 按真实用户所指及已有原请求绑定识别续作和豁免。

仅实测成立的客户端、事件与编辑工具 SHALL 声称相应写保护。Shell、脚本、场外进程及未覆盖工具依赖执行环境隔离。Codex Desktop 与 CLI SHALL 分别取证，保留原生信任和宿主已有设置。

#### Scenario: An edit proceeds with no prior document Read
- **WHEN** 用户授权已定位，支持的编辑工具修改该请求的产品文件，原生记录没有读取入口文档的事件
- **THEN** 写操作 SHALL 沿既有权限与写界执行，framework 发布件的写保护继续生效

#### Scenario: An independent tool output is pending
- **WHEN** 已定位真实用户，一条读取或编辑调用暂未配对，另一项有独立执行原件
- **THEN** 只对所依赖的记录保留缺口，专项目标和独立结论继续消费其现有依据

#### Scenario: A CLI result is not a Desktop result
- **WHEN** Codex CLI 通过而 Desktop hook 未实测，或某客户端缺本机认证/程序
- **THEN** 报告对应未测/环境缺口与降级，SHALL NOT 声称 Desktop 已拦截或产品不支持

> **Enforced by:** 已物化入口、原 guard hook 与原生请求 reader；真实客户端能力证据见 `agents/README.md`，开发夹具不能替代原生结果。


### Requirement: Compact design reuses the adapter intake without claiming new client evidence

adapter 入口 SHALL 消费同一四档结果及当前原 request；小型 SHALL 指向同协议短蓝图与后续适用能力，不强建 CU/独立设计质询/独立评审文件，不恢复 lite 或另维护档位表。首次授权蓝图准备 SHALL 使用真实 component-design 上下文，不借 review 假身份。此能力接线 SHALL NOT 扩大任何客户端 hook 的实测结论，CLI/隔离开发通过不代表 Desktop、业务宿主、真机或效率验收通过。

#### Scenario: An adapter handles a small request
- **WHEN** 同源规则或真实 user 指定小型
- **THEN** 入口消费原 request 的短设计和当前验收来源，不新建 Feature/CU 或新执行器；该结果不改变客户端 hook 未测边界

> **Enforced by:** 已物化根入口/Skill 指引、原 design/request 消费者；客户端实证沿 `agents/README.md` 分别记录。
