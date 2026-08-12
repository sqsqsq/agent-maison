# Tasks: Framework Setup 前置门控

## 1. Harness

- [x] `personal-setup-gate.ts` + `check-personal-setup.ts --ensure --json`
- [x] `harness-runner.ts` exempt phases + `HARNESS_INIT_INTERNAL_GLOBAL_RUN`
- [x] `init-task-executor.ts` runGlobalPhases env injection
- [x] Unit tests for ensure + internal exempt

## 2. Surfaces

- [x] Remove framework-setup slash + skills-bridge 00b
- [x] Update adapter.yaml, CLAUDE_SLASH_COMMANDS, generic-bundle tests

## 3. Docs

- [x] personal-setup-gate.md, 00b SKILL, phase entries, residual refs
- [x] MIGRATION / README / release-checklist

## 4. Verify

- [x] `cd harness && npm test`
- [x] `npm run openspec:validate --strict`
