# Agent Adapters Specification

## Purpose

Define how AgentMaison exposes framework skills to different AI coding assistants
via adapter plugins without duplicating skill logic or phase rules.

## Requirements

### Requirement: Each adapter is a self-contained plugin directory

The system SHALL require every adapter to live under `agents/<adapter_name>/` with
an `adapter.yaml` that conforms to `agents/adapter-schema.yaml`.

#### Scenario: Known adapters present
- **WHEN** the framework is inspected for supported adapters
- **THEN** `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, and `agents/generic/adapter.yaml` MUST exist and validate against the schema

> **Enforced by:** `agents/adapter-schema.yaml`, `agents/cursor/adapter.yaml`, `agents/claude/adapter.yaml`, `agents/generic/adapter.yaml`

### Requirement: Adapters do not contain skill logic

The system MUST NOT allow adapters to embed phase rules or skill workflow logic;
adapters SHALL only expose skill entry points (slash commands, bridge files, rules)
to the instance project root.

#### Scenario: Phase rules remain centralized
- **WHEN** an adapter generates instance-level configuration
- **THEN** it MUST NOT write phase rules; all phase rules MUST remain in `specs/phase-rules/*.yaml`

> **Enforced by:** `agents/adapter-schema.yaml` (design constraints section), `specs/phase-rules/`

### Requirement: Adapter outputs target instance project root

The system SHALL generate all adapter artifacts relative to the consumer instance
project root, not inside the framework submodule directory.

#### Scenario: Agent entry file targets instance root
- **WHEN** framework-init runs with a selected adapter
- **THEN** the generated agent entry file (e.g. `AGENTS.md`) MUST appear at the instance project root as defined by `agent_entry_file.target_path` in the adapter config

> **Enforced by:** `agents/*/adapter.yaml`, `skills/00-framework-init/SKILL.md`, `harness/scripts/check-init.ts`
