## ADDED Requirements

### Requirement: Command-capable adapters transport managed initial design without changing authority

The command-capable sessions of `codex`, `claude`, `codeagent`, `cursor`, `opencode`, `deepseek-harness`, `chrys` and `generic` SHALL use the same existing prepare-run/next/report runtime entry for original formal complete requirements, including initial design before CUs exist and automatic return after child reports. The entry SHALL NOT require native Goal persistence, `in_session_reconcile`, model CLI native resume or a new host callback. Adapters/templates MUST NOT implement an independent CU/phase selection loop or interpret author exit/design readiness as original completion.

Adapters SHALL consume the original request completion disposition including actual design, all applicable CU results and its required formal component endpoint. All completed CUs or an eligible component evaluation MUST NOT substitute for formal assembly/independent evidence and the original closure writer artifact; unavailable evidence remains a concrete wait.

Authors SHALL always use their dedicated work-unit context; unavailable native continuation SHALL reconstruct that dedicated context and disclose the boundary, never authorize business editing in the main conversation; required independent questioning/verifiers MUST use a real independent context/provider and MUST NOT be waived or inferred solely from a changed role/provider name. Detached execution SHALL retain its existing external/headless/survival preflight and startup handshake. Missing command, configuration, independent provider or detached capability SHALL be reported accurately; documentation changes MUST NOT silently raise adapter YAML capability values. Capability declaration, transport tests, shared-kernel tests, real CLI and real host evidence SHALL remain distinct claims.

Enforcement: `agents/README.md`, `templates/AGENTS.md.template`, `agents/*/adapter.yaml`, `agents/shared/agent-bundle/templates/skills-bridge/goal-mode/SKILL.md`, `skills/project/goal-mode/SKILL.md`, `harness/scripts/utils/goal-adapter-capability.ts`, `harness/scripts/utils/session-execution-handoff.ts`.

#### Scenario: A command-capable adapter lacks native Goal or phase isolation

- **WHEN** framework commands and required independent questioning can run but the adapter has no native Goal/phase isolation
- **THEN** the original request SHALL use the common runtime and a dedicated work-unit author context reconstructed from current facts when exact native continuation is unavailable, retaining real independent questioning

#### Scenario: Background capability is missing

- **WHEN** an adapter cannot satisfy required headless/survival startup capability
- **THEN** entry SHALL report the real gap and SHALL NOT claim the original delivery is RUNNING or completed
