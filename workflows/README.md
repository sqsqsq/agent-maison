# Workflows (`framework/workflows/`)

Workflow YAML files describe which **harness phases** exist and their **dependency DAG**
(`requires`). The harness runner resolves `active_workflow` (see `framework.config.json`)
to a file named `<active_workflow>.workflow.yaml` in this directory.

## Default

- **`spec-driven.workflow.yaml`** — mirrors the historical linear product flow:
  global `init` / `catalog` / `glossary` / `docs`, then feature phases
  `prd` → `design` → `coding` → `review` & `ut` (both depend on `coding`) → `testing` (depends on `ut`).

## Forking

1. Copy `spec-driven.workflow.yaml` to `my-team.workflow.yaml`.
2. Adjust `artifacts[].requires` or omit phases you disable elsewhere (still subject to profile `phases_disabled`).
3. Set `"active_workflow": "my-team"` in instance `framework.config.json`.

Schema: [`framework/specs/workflow-schema.json`](../specs/workflow-schema.json).
