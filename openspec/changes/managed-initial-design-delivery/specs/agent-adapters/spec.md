## ADDED Requirements

### Requirement: Command-capable adapters transport managed initial design without changing authority

The command-capable sessions of `codex`, `claude`, `codeagent`, `cursor`, `opencode`, `deepseek-harness`, `chrys` and `generic` SHALL use the same existing prepare-run/next/report runtime entry for original formal complete requirements, including initial design before CUs exist and automatic return after child reports. The entry SHALL NOT require native Goal persistence, `in_session_reconcile`, model CLI native resume or a new host callback. Adapters/templates MUST NOT implement an independent CU/phase selection loop or interpret author exit/design readiness as original completion.

All applicable CU formal completions SHALL establish this request's endpoint. Adapters SHALL report the existing read-only component-closure check separately, without claiming its PASS from request completion or starting an automatic P3 repair/write/closure loop.

Actual stage isolation SHALL determine ordinary author context and be disclosed; required independent questioning/verifiers MUST use a real independent context/provider and MUST NOT be waived or inferred solely from a changed role/provider name. Detached execution SHALL retain its existing external/headless/survival preflight and startup handshake. Missing command, configuration, independent provider or detached capability SHALL be reported accurately; documentation changes MUST NOT silently raise adapter YAML capability values. Capability declaration, transport tests, shared-kernel tests, real CLI and real host evidence SHALL remain distinct claims.

Enforcement: `agents/README.md`, `templates/AGENTS.md.template`, `agents/*/adapter.yaml`, `agents/shared/agent-bundle/templates/skills-bridge/goal-mode/SKILL.md`, `skills/project/goal-mode/SKILL.md`, `harness/scripts/utils/goal-adapter-capability.ts`, `harness/scripts/utils/session-execution-handoff.ts`.

#### Scenario: A command-capable adapter lacks native Goal or phase isolation

- **WHEN** framework commands and required independent questioning can run but the adapter has no native Goal/phase isolation
- **THEN** the original request SHALL use the common runtime and ordinary author main context with disclosure, retaining real independent questioning

#### Scenario: Background capability is missing

- **WHEN** an adapter cannot satisfy required headless/survival startup capability
- **THEN** entry SHALL report the real gap and SHALL NOT claim the original delivery is RUNNING or completed
