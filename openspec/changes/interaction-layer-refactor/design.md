# Design: 交互层架构大重构

## Architecture

```text
Skills (platform-agnostic) → registry_id only
Registry (SSOT) → options[] with label/portable/side_effect/dynamic_label
Adapter layer → interaction-renderer + commands strong constraint
Runtime → model reads registry + adapter renderer
```

## Key Decisions

### 1. Registry schema 2.0

- `enum|gate|freeform_approval|artifact_checkbox` → `options[]`
- `matrix` → `matrix_options[]` or `parent` reference
- Delete `widget_hint` / `widget_options_ref` (shared layer zero tool names)

### 2. Three independent renderers

- `agents/claude/templates/rules/interaction-renderer.md` — AskUserQuestion
- `agents/cursor/templates/rules/interaction-renderer.mdc` — AskQuestion
- `agents/generic/templates/rules/interaction-renderer.md` — portable only

### 3. Renderer delivery (check-init)

1. Copy from `rules.template_dir` (shared rules for cursor/generic; all rules for claude)
2. Copy from `user_confirmation.interaction_renderer_rule` if not already copied (dedupe by targetRel)
3. Cursor/generic need extra collection; Claude gets renderer via `rules.template_dir`

### 4. Deprecated artifacts cleanup

- `deprecated_artifacts` in adapter.yaml with `action: backup_delete`
- UPDATE mode: backup to `.framework-backup/<timestamp>/` then delete
- Results in `check-init.json` → `deprecated_artifacts_cleaned`

## Risks / Mitigations

| Risk | Mitigation |
|------|------------|
| Weak model ignores renderer | Commands retain one-line AskUserQuestion BLOCKER |
| Old instance pollution | check-init backup_delete on UPDATE |
| Shared layer tool name leak | harness lint scans .md/.mdc/.yaml/.yml in shared dirs |
