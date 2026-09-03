# Agent Adapters Spec Delta

## ADDED Requirements

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