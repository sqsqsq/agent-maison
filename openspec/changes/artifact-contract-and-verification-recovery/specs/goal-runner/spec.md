## ADDED Requirements

### Requirement: Verification gaps continue only independent authorized obligations

The runtime SHALL reuse existing workflow requires/control edges and consumed-input dependencies to decide what can safely proceed while a required checker has a framework execution gap. Independent authorized unfinished obligations SHALL execute; dependent obligations MUST NOT execute blindly. Unclassified legacy BLOCKER SKIP SHALL remain in blocking_skips for verifier review and SHALL NOT by itself change an existing PASS, trigger author repair or become INCOMPLETE. With no independent work the runtime SHALL wait/defer accurately for explicitly classified framework or external gaps and SHALL NOT spend content retries on unchanged framework gaps. After repair it SHALL reverify affected phases, reuse still-valid evidence and continue through existing recovery while preserving authorization, write protection, accumulated budget and deadlines.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/repair-responsibility.ts`, `harness/scripts/utils/verify-feature-completion.ts`.

#### Scenario: Independent work runs and required completion stays open

- **WHEN** a required checker has a framework execution gap but an authorized obligation has no dependency on it
- **THEN** that obligation SHALL run, dependent obligations SHALL remain deferred, and the request MUST NOT complete until its required evidence is restored

### Requirement: Phase prompts carry commands from the current invocation context

Runtime prompts SHALL render actual project/phase/mode/identity arguments for current harness and closure commands, point to already supplied context and deterministic projections, and avoid asking the Agent to invent attended identity in detached mode. A new invocation without receipt SHALL NOT run an inevitably failing receipt recovery probe; existing receipt recovery SHALL remain effective.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`.

#### Scenario: Detached spec and plan receive executable current commands

- **WHEN** the runtime prepares a detached phase
- **THEN** the prompt SHALL provide its actual harness command and a sync-closure command with phase, without attended-only owner/attempt arguments
