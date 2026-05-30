# Tasks: Framework Init 编排化重构

## 1. Config split

- [x] 1.1 Add `specs/framework.local.schema.json` + `templates/framework.local.template.json`
- [x] 1.2 Update `framework.config.schema.json`: `materialized_adapters`, remove required `agent_adapter`
- [x] 1.3 `harness/config.ts`: local merge, sources, cache invalidation, `getFrameworkPersonalSetupStatus`
- [x] 1.4 `config-field-merger`: `extract_personal_to_local` migration + tests
- [x] 1.5 `canonical-gitignore`: add `framework.local.json`

## 2. Orchestrator

- [x] 2.1 `init-task-planner.ts`: readonly probe + task DAG
- [x] 2.2 `init-orchestrate.ts`: enum decision execute + run-log + summary
- [x] 2.3 Refactor check-init: probe readonly; side effects to orchestrate tasks
- [x] 2.4 Unit tests for planner + orchestrate

## 3. Interaction layer

- [x] 3.1 Registry: `init.task_plan`, `init.task_decision`, `init.materialized_adapters`, `setup.*`
- [x] 3.2 Deprecate `init.populated_diff` per_item; renderer init orchestration note
- [x] 3.3 Profile addendum free-input cleanup + lint scope

## 4. Skills & commands

- [x] 4.1 Rewrite `skills/00-framework-init/SKILL.md` (S1-S4)
- [x] 4.2 Add `skills/00b-framework-setup/SKILL.md`
- [x] 4.3 Split commands: framework-init / framework-setup (3 adapters) — claude slash；cursor/generic 经 shared skills-bridge + inline 物化
- [x] 4.4 harness-runner personal setup status gate

## 5. Verify

- [x] 5.1 Consumer migration smoke (`init-orchestrate-smoke.unit.test.ts`)
- [x] 5.2 Docs: agents/README, release-checklist, MIGRATION.md 编排化章节
- [x] 5.3 `cd harness && npm test` all PASS
- [x] 5.4 `npm run openspec:validate` strict PASS（change scenarios 齐备）
- [x] 5.5 Review 修复：local 污染隔离、assert→record、DAG 失败传播、context payload、personal-setup 门控、registry select-only
