# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: The Claude adapter ships a phase-executor subagent template

`agents/claude/templates/agents/phase-executor.md` SHALL exist and be registered in the adapter's agents list with `update_policy: auto_overwrite`. The template SHALL give the subagent the full tool set, SHALL define its input as the minimal phase entry and SHALL instruct it to run the phase skill, the harness, the verifier when required and finalize, returning only the summary path and the terminal block.

Enforcement: `agents/claude/adapter.yaml`, `agents/claude/templates/agents/phase-executor.md`

#### Scenario: Materialization installs the executor

- **WHEN** a consumer runs framework-init with the Claude adapter
- **THEN** `.claude/agents/phase-executor.md` is materialized alongside `verifier.md`
