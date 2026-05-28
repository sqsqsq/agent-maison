# Tasks: 交互层架构大重构

## 1. Registry & SSOT

- [x] 1.1 Upgrade `confirmation-registry.yaml` to schema 2.0 with full options
- [x] 1.2 Delete `widget_hint` / `widget_options_ref` fields

## 2. Adapter renderers

- [x] 2.1 Create Claude `interaction-renderer.md`
- [x] 2.2 Create Cursor `interaction-renderer.mdc`
- [x] 2.3 Create generic `interaction-renderer.md`
- [x] 2.4 Update adapter-schema.yaml + all adapter.yaml

## 3. Shared layer cleanup

- [x] 3.1 Remove tool names from skills/, profiles/, agents/shared/, templates/
- [x] 3.2 Update Claude commands (9 files)
- [x] 3.3 Delete confirmation-ux.md and widget-options/

## 4. Harness

- [x] 4.1 check-init: interaction_renderer_rule delivery + dedupe
- [x] 4.2 check-init: deprecated_artifacts backup_delete
- [x] 4.3 check-skills-confirmation-ux.ts lint rewrite
- [x] 4.4 smoke-interaction-renderer.ts

## 5. Docs & verify

- [x] 5.1 Update agents/README.md, docs/overview.md, docs/evolution/, docs/concepts/
- [x] 5.2 Update release-checklist.md with MiniMax 2.7 acceptance
- [x] 5.3 `cd harness && npm test`全 PASS
