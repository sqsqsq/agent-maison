## MODIFIED Requirements

### Requirement: Cursor adapter external_runner headless_invoke declaration

The Cursor adapter SHALL declare headless invoke as `cursor-agent -p` (not `cursor agent --print`) for capability validation; runtime structured argv SSOT remains `agent-invoke.ts`.

Enforcement: `agents/cursor/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: Cursor adapter yaml matches runtime

- **WHEN** maintainers read `agents/cursor/adapter.yaml` `headless_invoke`
- **THEN** it documents `cursor-agent -p` style invocation consistent with runtime `cursorHeadlessPlan`
