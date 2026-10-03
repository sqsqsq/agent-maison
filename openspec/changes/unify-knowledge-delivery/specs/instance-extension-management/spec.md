## ADDED Requirements

### Requirement: Shared static knowledge routes and optional design asset
AGENTS and CLAUDE SHALL expose the existing global and Feature phase audience routes from the same source as runtime and inspect. Existing binding slots MUST retain their timing and manifest 1.0 MUST NOT acquire 1.1 routing implicitly. component-design SHALL resolve optional `provides.skill_assets.component-design.knowledge` first through the extension loader, then `assets.component-design.knowledge` in the profile; absence in both is legal. Root Skill prose MUST describe that conditional lookup without a required asset marker. Enforcement: `harness/scripts/utils/knowledge-context.ts`, `harness/scripts/utils/template-renderer.ts`, `harness/scripts/utils/extension-inspect.ts`, `skills/project/component-design/SKILL.md`.

#### Scenario: Extension-only early design material
- **WHEN** no blueprint or Feature exists and only the extension declares the design knowledge key
- **THEN** the design entry and inspect identify the same extension-root-resolved file and discovery reads it before writing the blueprint

#### Scenario: No optional design asset
- **WHEN** neither extension nor profile declares the key
- **THEN** the entry reports no declared asset and the docs checker does not fail for an invented required reference
