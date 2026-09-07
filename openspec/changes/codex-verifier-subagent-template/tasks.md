# Tasks

## 1. Renderer, CLI and derived template (plan 7b2e9d4c D1)

- [x] 1.1 `harness/scripts/utils/codex-agent-toml.ts`: `renderCodexAgentToml(markdown)` parses the frontmatter
      (`name` must be `verifier`, single-line `description`, `tools` ⊆ {Read, Glob, Grep}) and emits the fixed
      skeleton with TOML literal `'''` strings; throws on a non-verifier name, on any tool outside the read-only
      set, and on `'''` inside the description or the body
- [x] 1.2 `harness/scripts/sync-codex-agent-templates.ts` + `npm run sync:codex-agents` writes
      `agents/codex/templates/agents/verifier.toml` (LF)
- [x] 1.3 Generate and commit `agents/codex/templates/agents/verifier.toml`

## 2. Top-level `subagents` declaration (plan 7b2e9d4c D2)

- [x] 2.1 `agents/adapter-schema.yaml`: optional top-level `subagents` (same fields as `commands.subagents`),
      documented as mutually exclusive with the historical position, top level wins
- [x] 2.2 `harness/scripts/check-init.ts`: collect subagent templates outside the `commands` block, reading
      `cfg.subagents ?? cfg.commands?.subagents`, with the `fieldLabel` naming the actual source
- [x] 2.3 `agents/codex/adapter.yaml`: top-level `subagents` (`.codex/agents`, `templates/agents`,
      `auto_overwrite`); fix the "history init materialized" comment; add the 2026-09-07 smoke to the
      `verifier_subagent` evidence; record the two hook decisions in notes. `claude` / `codeagent` untouched

## 3. Tests and verification

- [x] 3.1 `harness/tests/unit/codex-adapter-verifier-template.unit.test.ts`: V1 equivalence and drift, V2 escaping
      and structure (including the three throw paths), V3a first materialization, V3b backup-then-overwrite plus
      idempotence, V3c planner task and catalog entry — V3a–V3c through the real execution entries in a temp project
- [x] 3.2 `harness/tests/unit/adapter-catalog-consistency.unit.test.ts`: V4 mutual exclusivity across all adapters
- [x] 3.3 `npm --prefix harness run typecheck`, the four targeted unit suites, `npm run openspec:validate`
- [ ] 3.4 V5 release packaging: the manifest contains `agents/codex/templates/agents/verifier.toml`
- [ ] 3.5 One full `cd harness && npm test`

## 4. Docs (plan 7b2e9d4c D6)

- [x] 4.1 `agents/README.md`: codex rows in both matrices, the verifier section, the directory tree
- [x] 4.2 `MIGRATION.md` 3.0.x section
- [ ] 4.3 Host acceptance (user-triggered, not part of this change's completion): UPDATE overwrites
      `.codex/agents/verifier.toml` with a backup, and the child thread no longer reads `verify-<phase>.md` or
      the phase rules
