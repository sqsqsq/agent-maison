# Design: Framework Init 编排化重构

## Architecture

```text
Probe (readonly) → InitTaskPlan JSON → User approve (widget + decision mode)
  → Execute DAG (enum decision JSON only) → RunLog → Structured summary

Project config (committed): framework.config.json + materialized_adapters + multi-adapter artifacts
Personal config (gitignored): framework.local.json → agent_adapter + devEco installPath
Runtime: loadFrameworkConfig() merges both; sources tracked (local | project_legacy | fallback)
```

## Key Decisions

### 1. Dual adapter model

- `materialized_adapters[]` — project-level, committed, drives `materialize-adapter:<name>` tasks
- `agent_adapter` — personal local only; setup selects from materialized list; never writes project artifacts
- Render committed AGENTS/CLAUDE per adapter being materialized, not local active adapter

### 2. Orchestrator (harness deterministic)

- `init-task-planner.ts`: readonly probe, task DAG with deps/allowed_actions/skippable
- `init-orchestrate.ts`: `--scope project|personal`; rejects unknown task/action/param; dependency closure on skip
- Side effects moved from probe: `ensure-gitignore`, `cleanup-deprecated`, `sync-auto-overwrite`

### 3. Decision modes (S2)

- Smart: no drift → skip; drift → overwrite without per-task stop
- Manual: each drift task uses `init.task_decision` widget (overwrite / keep)

### 4. Personal setup status

- `getFrameworkPersonalSetupStatus()` called at: harness-runner pre-phase, Skill bootstrap, adapter slash command
- `fallback` → must guide setup, never silent generic

### 5. Interaction (rebase interaction-layer-refactor)

- Add registry: `init.task_plan`, `init.task_decision`, `init.materialized_adapters`, `setup.adapter`, `setup.deveco_path`
- Remove `init.populated_diff` per_item (Q1=y); no free-text in init/setup orchestration decisions

## Risks / Mitigations

| Risk | Mitigation |
|------|------------|
| Probe still writes disk | Unit test: planner run zero filesystem mutations |
| Setup writes project artifacts | Task named `assert-active-adapter-materialized` (readonly only) |
| Personal choice leaks to committed files | Render env uses materializing adapter, not local |
| Old addendum reopens free input | Lint profiles/** addendum; sync hmos profile-addendum |
