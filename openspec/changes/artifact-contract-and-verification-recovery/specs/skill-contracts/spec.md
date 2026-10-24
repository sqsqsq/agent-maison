## ADDED Requirements

### Requirement: Deterministic design content is prepared in its producing phase

The existing blueprint writer SHALL prepare only acceptance for spec and only contracts/use-cases for plan, after the existing pre-invoke write snapshot and before current input resolution and Agent invocation. It SHALL compute and validate candidates before transactional writes, preserve compatible increments, write nothing on identical input, and retain existing bytes on conflict. Content conflicts SHALL identify the original producer or design owner; ordinary non-blueprint requests and absent design fragments SHALL keep their existing applicability. Dry-run and post-agent closure MUST NOT materialize content.

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/goal-phase-runtime.ts`.

#### Scenario: Spec prepares acceptance without writing plan outputs

- **WHEN** a fresh canonical CU enters spec
- **THEN** only its determined acceptance SHALL be written, plan outputs SHALL remain due to plan, and repeating preparation SHALL write zero files

#### Scenario: Plan preserves valid author increments

- **WHEN** an existing stage artifact includes compatible additions
- **THEN** preparation SHALL preserve those bytes; a conflicting known field SHALL remain unchanged and return its original owner

### Requirement: UI named entry localization does not certify unit executability

Skills and templates SHALL distinguish a named Page event method from a real unit-callable business entry. Named-handler scanning SHALL prove declaration localization only. Unit/both acceptance MUST be exercised through an actual business entry without constructing the UI runtime; countdown/resend rules remain unit obligations while real navigation/UI behavior remains device testing. Missing seams SHALL use existing testability and owner repair rather than a blanket Page prohibition.

Enforcement: `skills/reference/coding-workflow-detail.md`, `skills/reference/business-ut-workflow-detail.md`, `profiles/*/skills/business-ut/templates/use-cases-schema.md`, `harness/scripts/utils/named-handler.ts`.

#### Scenario: A named Page method is not sufficient unit evidence

- **WHEN** scanning locates a Page handler but unit/both business state cannot be driven without UI
- **THEN** the existing UT responsibility chain SHALL require a real callable seam or verified executable refusal evidence; name existence alone SHALL NOT satisfy the obligation
