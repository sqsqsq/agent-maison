# Delta: Agent Adapters — No framework-setup command

## MODIFIED Requirements

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
