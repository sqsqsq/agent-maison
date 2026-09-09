# codex-verifier-subagent-template

## Why

The Codex adapter has never shipped a verifier subagent template, and the file that plays that role on the host
was written by hand outside the framework.

**F01 — the host's `.codex/agents/verifier.toml` is host-private, not a framework artifact.** It arrived with host
commit `66eb7dfd` (2026-05-25, a Cursor session) together with a copy of two Claude hook scripts. The framework's
codex adapter, first committed 2026-06-08, has only ever carried `adapter.yaml`, `goal-condition.md` and rules;
no adapter in the repo has ever rendered a TOML agent file.

**F02 — both host copies are frozen on the May contract.** They tell the verifier to read `verify-<phase>.md` and
`phase-rules/<phase>-rules.yaml` itself, name the old artifact paths, ask for a Markdown table with a "BLOCKER FAIL
count", and know nothing about the terminal block, the short request contract or what to do with an illegal
request. The Claude verifier template has changed ten times since.

**F03 — the stale file has not broken closure, and that is the trap.** A read-only smoke on the main host
(2026-09-07) confirmed a real `agent_role=verifier` child thread and a well-formed terminal block: the assembled
`ai-prompt.md` carries the terminal-block contract itself, so the model reconciled the two instruction sets. The
cost is silent — the child thread read `verify-testing.md` twice plus the overlay and the phase rules, every one
of which the Claude template forbids because `ai-prompt.md` is already their assembled result.

**F04 — the adapter had no place to declare a subagent template.** `check-init` collected subagent templates only
inside `if (cfg.commands && typeof cfg.commands === 'object')`, and codex declares `commands: null`, so a codex
subagents block could never have been materialized wherever it was written.

## What Changes

**The codex verifier template becomes a derived, test-guarded artifact.** A single function
`renderCodexAgentToml(markdown)` turns `agents/claude/templates/agents/verifier.md` into
`agents/codex/templates/agents/verifier.toml`: frontmatter `name` must be `verifier`, `description` must be one
line, `tools` must stay within `{Read, Glob, Grep}`, and both description and body go into TOML literal `'''`
strings with a hard error if either contains `'''`. A CLI (`npm run sync:codex-agents`) writes the file, the file
is committed, and a unit test fails the moment `verifier.md` changes without a re-sync. There is no second hand-
maintained body and no generic "any md to any adapter format" framework.

**Subagent templates may be declared at the adapter top level.** `agents/adapter-schema.yaml` gains an optional
top-level `subagents` with the same fields as `commands.subagents`; `check-init` collects them outside the
`commands` block, preferring the top-level declaration. The two positions are mutually exclusive per adapter, and
`claude` / `codeagent` keep `commands.subagents` untouched.

**`sandbox_mode = "read-only"` is declared as the role default and nothing more.** Codex applies the role config
first and then overwrites it with the parent thread's live permissions, and the Maison goal parent runs
`danger-full-access`, so the child thread is not sandboxed on the goal path. The template says so in a comment;
"does not write" is carried by the hard rules in the instructions, exactly as it has been since May. No isolation
mechanism is added.

**Codex hooks are ruled out for this change.** No Stop hook (goal closure is judged by the harness and
check-receipt; project-layer hooks also need a trust action) and no write guard yet (technically feasible, but
there is no recorded incident of codex writing into `framework/`). Both decisions, with their re-examination
triggers, are recorded in `agents/codex/adapter.yaml` notes.

## Impact

- **Affected specs**: `agent-adapters` — two ADDED requirements (the rendered codex verifier template; top-level
  subagent declaration). No requirement is removed and `verifier_subagent` keeps its meaning.
- **Affected code**: `harness/scripts/utils/codex-agent-toml.ts`, `harness/scripts/sync-codex-agent-templates.ts`,
  `harness/scripts/check-init.ts`, `harness/package.json`, `agents/adapter-schema.yaml`,
  `agents/codex/adapter.yaml`, `agents/codex/templates/agents/verifier.toml`.
- **Breaking**: yes for hosts. `framework-init` UPDATE overwrites a hand-written `.codex/agents/verifier.toml`
  without asking (backup under `.framework-backup/<stamp>/`), and the verifier's instructions change.
- **放弃的准确性**: (1) the toml is a committed derivative, not rendered at init time — a `verifier.md` edit without
  a re-sync is caught by a unit test, never at runtime; (2) there is no physical read-only isolation, the declared
  sandbox is a default the parent thread overrides; (3) no Stop hook, so a "fake completion" in an interactive codex
  session is constrained by rules only; (4) a host's own edits to the toml are overwritten silently (backed up);
  (5) the smoke that showed the stale file still closing was a single sample, one phase, under a read-only parent.
