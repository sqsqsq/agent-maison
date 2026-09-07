# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: The Codex adapter ships a verifier subagent template rendered from the Claude verifier template

`agents/codex/templates/agents/verifier.toml` SHALL exist and SHALL be declared in the codex adapter's subagent
templates with `update_policy: auto_overwrite`, so that `framework-init` materializes it to `.codex/agents/verifier.toml`
and re-aligns it on UPDATE.

The file SHALL be a derivative, never a hand-maintained second copy of the verifier persona. It SHALL be produced by
`renderCodexAgentToml` from `agents/claude/templates/agents/verifier.md`, which remains the single source of the
verifier body. The renderer SHALL carry the frontmatter `description` and the whole body into TOML literal multi-line
strings, and SHALL fail rather than guess: a frontmatter `name` other than `verifier`, a `tools` list reaching outside
`{Read, Glob, Grep}`, or a `'''` sequence inside the description or the body SHALL each raise an error. Equivalence
between the rendered result and the committed file SHALL be test-enforced, so that editing the Claude template without
re-running the sync command fails the unit suite.

The template SHALL declare `sandbox_mode = "read-only"` **as the role default only**. Codex applies the role
configuration when spawning a subagent and then overwrites it with the parent thread's live permissions, and the
Maison goal parent process runs with full access; the declaration therefore SHALL NOT be described, in the file, the
adapter or the docs, as an isolation guarantee or as physical read-only enforcement. The "does not write" constraint
SHALL be carried by the hard rules in the rendered instructions.

Enforcement: `harness/scripts/utils/codex-agent-toml.ts`, `harness/scripts/sync-codex-agent-templates.ts`, `agents/codex/adapter.yaml`, `agents/codex/templates/agents/verifier.toml`, `harness/tests/unit/codex-adapter-verifier-template.unit.test.ts`

#### Scenario: UPDATE backs up and overwrites a hand-written host file

- **WHEN** a host that carries its own `.codex/agents/verifier.toml` runs framework-init UPDATE
- **THEN** the old file SHALL be copied to `.framework-backup/<stamp>/.codex/agents/verifier.toml` and the target
  SHALL become byte-identical to the framework template; a second run SHALL report the target unchanged and SHALL NOT
  create another backup

#### Scenario: An unsynced Claude template edit fails the suite

- **WHEN** `agents/claude/templates/agents/verifier.md` is edited without re-running `npm run sync:codex-agents`
- **THEN** the equivalence unit test SHALL FAIL, naming the rendered result and the committed file as different

### Requirement: Adapter subagent templates may be declared at the adapter top level

An adapter SHALL be able to declare its subagent template directory either at the top level of `agents/<name>/adapter.yaml`
as `subagents`, or in the historical position `commands.subagents`. Both positions SHALL carry the same fields
(`target_dir`, `template_dir`, `update_policy`) and the same semantics, and an adapter SHALL NOT declare both — when the
top-level field is present it SHALL win, and the mutual exclusivity SHALL be test-enforced across every adapter.

Collection SHALL happen outside the `commands` block: an adapter whose agent has no slash command surface declares
`commands: null`, and a subagent declaration reachable only from inside that block would never be materialized. The
resolved source SHALL be visible in the per-file inspection origin so that a materialized target names the field it came
from.

Declaring a subagent template directory SHALL remain unrelated to `verifier_subagent`, which stays a standalone boolean
about observed dispatch capability and SHALL NOT be inferred from the presence of a template directory.

Enforcement: `agents/adapter-schema.yaml`, `agents/codex/adapter.yaml`, `harness/scripts/check-init.ts`, `harness/tests/unit/adapter-catalog-consistency.unit.test.ts`

#### Scenario: A slashless adapter materializes its subagent template

- **WHEN** an adapter declares `commands: null` and a top-level `subagents` block, and framework-init materializes it
- **THEN** every file under the declared `template_dir` SHALL appear in the adapter's template file list with the
  declared `update_policy`, and SHALL be written under the declared `target_dir`

#### Scenario: Adapters keeping the historical position are unaffected

- **WHEN** an adapter declares `commands.subagents` and no top-level `subagents`
- **THEN** its template entries SHALL keep the `commands.subagents.template_dir` origin and the same targets as before
