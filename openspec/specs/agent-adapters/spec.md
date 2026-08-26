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
project root, not inside the framework submodule directory.

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

> **Enforced by:** `skills/reference/personal-setup-gate.mdSKILL.md`,
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
The goal driver SHALL route in-session, unattended, and handoff behavior only when the active adapter declares and passes the corresponding capability/preflight. Missing capability SHALL select a documented fallback or halt rather than optimistic execution.

#### Scenario: Unattended permission contract is incomplete
- **WHEN** unattended mode is requested and the active adapter fails existing external-runner preflight
- **THEN** the run MUST halt before autonomous mutation and report the missing capability

#### Scenario: In-session capability is absent
- **WHEN** attended goal mode is requested without in-session support
- **THEN** the framework SHALL fall back to manual harness+assess

### Requirement: Existing adapter behavior remains backward compatible
Adapters that currently support external-runner goal execution SHALL retain their existing headless invoke, permission, output-delivery, tool-event, and usage-capture semantics unless they explicitly opt into new in-session or handoff capability fields.

#### Scenario: Legacy adapter omits new capability fields
- **WHEN** an existing adapter is loaded after upgrade
- **THEN** external-runner behavior SHALL remain available under existing preflight while new in-session/handoff behavior remains disabled

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

### Requirement: Claude adapter declares deprecated artifact cleanup

The system SHALL declare `deprecated_artifacts` on the Claude adapter for legacy
interaction-layer files superseded by registry schema 2.0 and interaction-renderer.

#### Scenario: UPDATE mode backup-deletes legacy rules
- **WHEN** check-init runs in UPDATE mode and legacy paths exist under
  `.claude/rules/` (e.g. `confirmation-ux.md`, `widget-options/`)
- **THEN** check-init MUST backup-delete them to `.framework-backup/<timestamp>/`
  and record entries in `check-init.json` → `deprecated_artifacts_cleaned`

> **Enforced by:** `agents/claude/adapter.yaml`, `harness/scripts/check-init.ts`,
> `harness/scripts/smoke-interaction-renderer.ts`

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
only when every one of those fields is present and valid.

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

The first batch SHALL declare `visual_provider` for `claude`, `codex` and `opencode` only.
`codeagent`, `chrys`, `generic` and `cursor` SHALL NOT declare it and SHALL NOT be usable as
providers. A mechanism id kept in the vocabulary without any adapter claiming it (`ask_mode`,
`result_json`) SHALL NOT by itself confer eligibility on any adapter.

Each declaration SHALL be admitted only after a real invocation smoke run on the locked CLI version
proves the declared read-only isolation, model replay and image transport. Where a locked CLI does
not actually provide the declared isolation, the declaration SHALL NOT be admitted, and the provider
SHALL NOT fall back to the adapter's project-default configuration.

Enforcement: `agents/adapter-schema.yaml`, `agents/{claude,codex,opencode}/adapter.yaml`,
`harness/scripts/utils/adapter-catalog.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

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

