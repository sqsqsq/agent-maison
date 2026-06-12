## Why

Code Graph schema, drift library, and hmos-app `GraphExtractor` landed in `define-code-graph-concepts`, but consumers still lack a user-facing entry to generate/curate graphs and a harness gate to catch anchor drift. Without a Skill + global `module-graph` phase, drift checks stay manual and bootstrap remains a maintainer-only script.

## What Changes

- **Project Skill `code-graph`**: public flow SSOT (`skills/project/code-graph/SKILL.md`) with profile addenda (hmos-app full generation; generic drift-only placeholder).
- **Harness global phase `module-graph`**: `check-module-graph.ts` scans catalog modules with on-disk `code-graph.yaml`, validates schema, maps `evaluateCodeGraphDrift()` to `CheckResult`. **Zero graphs → PASS** with guidance to run the Skill.
- **Provider decoupling**: `tryLoadGraphExtractor(profileDir)` in `profile-host-loader`; `bootstrap-code-graph.ts` resolves provider dynamically (no hardcoded hmos import).
- **Discovery surfaces**: skills index, agent bridge, Claude `/code-graph`, confirmation registry, workflow node (`requires: [catalog]`).
- **Docs**: `docs/concepts/code-graph.md` §6.1 updated — Skill + phase are shipped; Repo Map and skill navigation integration remain deferred.

## Capabilities

### New Capabilities
- `code-graph-entrypoints`: user-facing Skill orchestration, profile skill-assets, and `module-graph` harness gate semantics (including zero-graph PASS).

### Modified Capabilities
<!-- None at archive time; extends define-code-graph-concepts operationally without altering its normative vocabulary requirements. -->

## Impact

- Publishable paths: `skills/`, `specs/phase-rules/`, `profiles/*/skills/code-graph/`, `harness/scripts/check-module-graph.ts`, `workflows/spec-driven.workflow.yaml`, `docs/concepts/code-graph.md`, agent adapters.
- Non-hmos profiles: drift gate works; generation requires a profile `GraphExtractor` (clear error when missing).
- No consumer breaking change; existing projects without graphs keep global phase green.
- Sequencing: `.cursor/plans/code-graph-skill-entrypoints_a2caa5a3.plan.md` (window `2.3.0`); defers Repo Map and skill navigation integration per `code-graph-ut-evolution` blueprint.
