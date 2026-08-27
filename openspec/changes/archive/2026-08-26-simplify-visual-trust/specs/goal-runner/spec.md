## MODIFIED Requirements

### Requirement: Fidelity routing is a three-stage formula with auto-tiering and a single genuine-conflict halt

The runner SHALL derive fidelity routing as `inferred` (requirement-text detection) → `selected = resolveRequestedFidelity(inferred, manifest.fidelity, downgrade_receipt_valid)` → `effective = clampFidelityByCapability(selected, capability_snapshot)`. The capability snapshot SHALL contain only current execution capability and MUST NOT include artifact attestation or policy downgrade state. Acceptance strictness SHALL remain a separate axis. The ONLY capability halt is `selected=pixel_1to1 ∧ strictness=hard ∧ current execution capability cannot satisfy it` → DEFERRED_CAPABILITY_MISSING. The goal preflight SHALL run the shared initializer before any agent invoke. Prompt text SHALL state that `fidelity_target` projects `selected_fidelity`, while `effective_fidelity` is the current execution ceiling and MUST NOT be written back as the selected target.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: An artifact warning cannot clamp a capable model

- **WHEN** the current adapter/canary proves image reading and an existing ui-spec has an evidence-gap warning
- **THEN** capability remains visual, selected/effective remain pixel_1to1 when requested, and the prompt instructs the agent to repair the warning

#### Scenario: The prompt distinguishes selected from effective

- **WHEN** selected is pixel_1to1 but a genuinely blind current execution is clamped to semantic_layout
- **THEN** the prompt keeps `fidelity_target=pixel_1to1`, reports `effective_fidelity=semantic_layout` separately, and does not instruct the agent to rewrite the selected target

### Requirement: Retry prompts carry continuation context decoupled from the content-retry budget

The runner SHALL derive continuation from the current phase's most recent attempt window independently of the retries counter. Whenever continuation is non-null, the prompt SHALL include prior-failure evidence matched to the cause. If the harness did not produce a readable summary, the runner SHALL include a bounded excerpt of the current attempt's harness error output and SHALL classify a parser/schema/artifact load failure as an artifact/gate failure rather than defaulting to `code_regression`. `harness_start`/`harness_end`/`phase_verdict` events SHALL carry `invoke_id`; legacy logs without it SHALL be windowed by event order.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: YAML parse failure reaches the next attempt

- **WHEN** a spec harness exits before summary generation with `BLOCK_AS_IMPLICIT_KEY`
- **THEN** the next prompt includes that error and affected artifact context instead of generic source-code rollback guidance

#### Scenario: Resume into a fresh phase injects nothing

- **WHEN** the runner restarts with --resume and the current phase has no historical agent_invoke_start
- **THEN** continuation SHALL be null and the prompt SHALL contain no continuation blocks

### Requirement: Fidelity intent is detected from the dereferenced requirement SSOT with a capability pre-gate

Before phase prompting, the runner SHALL detect intent from the inline manifest requirement plus bounded, explicitly referenced source documents that already exist at initialization. A path under the current feature output tree that is named as a file to be produced SHALL NOT be dereferenced into requirement identity, and generated `ux-reference` documents SHALL NOT enter the requirement hash. The resolved source set SHALL remain stable for the phase. Strong pixel intent combined with genuinely missing current visual capability SHALL yield DEFERRED_CAPABILITY_MISSING; `--fidelity`/manifest fidelity remains upgrade-only without a valid downgrade receipt.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: Creating the requested README does not stale routing

- **WHEN** the requirement tells spec to create `doc/features/<feature>/ux-reference/README.md` and that file is created during spec
- **THEN** the stored requirement hash remains valid and `fidelity_capability_pregate` does not fail solely because the output now exists
