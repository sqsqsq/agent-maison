## MODIFIED Requirements

### Requirement: Knowledge routes only to its declared audience

Object knowledge with `audience: global` MUST appear in the AGENTS/CLAUDE instance knowledge section. Object knowledge with Feature phase audiences MUST appear as dynamically rendered index rows only in those phases' `ai-prompt.md`. Legacy string knowledge in a 1.1 manifest MUST appear in every Feature phase index and MUST NOT enter AGENTS/CLAUDE. Knowledge for component design MUST bind to the sole public entry `/component-design` using existing `skill_assets`, not a new audience value or an internal P1 workflow skill id.

#### Scenario: phase filtering is exact
- **WHEN** two knowledge entries target different Feature phases
- **THEN** each generated phase prompt lists only the entry that includes that phase

#### Scenario: only active workflow Feature phases are accepted
- **WHEN** audience or phase_bindings names an unknown slug or a global phase, or the active workflow cannot be resolved
- **THEN** manifest validation fails; full/lite Feature phases from the active workflow union remain accepted, including custom Feature phases

> **Enforced by:** extension loader, `template-renderer.ts`, `harness-runner.ts`, prompt assembly tests
