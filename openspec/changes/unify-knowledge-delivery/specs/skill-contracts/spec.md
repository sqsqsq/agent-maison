## ADDED Requirements

### Requirement: Shared knowledge delivery before work
The framework SHALL assemble native and declared extension knowledge from existing paths and readers for goal author prompts, prepare-scope, prepare-request, and verifier inputs. Literal terminology matches SHALL remain candidates with disambiguation and original source paths. Missing optional sources and content deferred by budget SHALL be disclosed without claiming they were read. Required reading MUST NOT be silently omitted. Enforcement: `harness/scripts/utils/knowledge-context.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/request-phase.ts`.

#### Scenario: Candidate not found or content too large
- **WHEN** a request has no literal glossary match or applicable material exceeds inline budget
- **THEN** the full source path remains available for exploration or incremental reading without inventing facts

### Requirement: Knowledge in the actual verifier material
Typed and legacy verifier assembly SHALL consume applicable architecture, conventions, component assets and target source. Global verifier capabilities enabled by a custom workflow SHALL retain their scoped inputs. Prompt and material fingerprints SHALL use the same assembly; actual referenced material files SHALL affect the existing fingerprint. Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/verifier-material.ts`.

#### Scenario: Relevant convention changes
- **WHEN** a convention or actual reference source in the verifier input changes
- **THEN** the current material identity changes and cannot reuse a same-material PASS; existing prior-review disclosure policy still applies
