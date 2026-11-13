# Workflows (`framework/workflows/`)

Workflow YAML files describe which **harness phases** exist and their **dependency DAG**
(`requires`). The harness runner resolves `active_workflow` (see `framework.config.json`)
to a file named `<active_workflow>.workflow.yaml` in this directory.

## Default

- **`obligation-driven.workflow.yaml`** — default for new requests. The unified [project entry](../docs/operations/project-entry.md) derives the delivery envelope from source-bound facts; ExecutionScope selects only unmet obligations and valid evidence. Four envelopes do not restore lite/full tracks or prescribe a fixed phase package. Especially simple changes use direct capabilities; small requests consume a compact form of the same blueprint through the original request, without a CU or separate design-questioning/review document. Medium/complex work and existing CUs retain complete design/admission; determined mappings reuse the existing writer instead of adding a plan model call.
- **`spec-driven.workflow.yaml`** — historical compatibility definition for existing runs; mirrors the old linear product flow:
  global `init` / `catalog` / `glossary` / `docs`, then feature phases
  `spec` → `plan` → `coding` → `review` & `ut` (both depend on `coding`) → `testing` (depends on `ut`).
  Legacy phase ids `prd` / `design` remain readable aliases (see [MIGRATION.md](../MIGRATION.md) §v2.3).

## Forking

1. Copy `obligation-driven.workflow.yaml` to `my-team.workflow.yaml`; preserve the obligation-driven scope contract.
2. Adjust `artifacts[].requires` or omit phases you disable elsewhere (still subject to profile `phases_disabled`).
3. Set `"active_workflow": "my-team"` in instance `framework.config.json`.

Schema: [`framework/specs/workflow-schema.json`](../specs/workflow-schema.json).
