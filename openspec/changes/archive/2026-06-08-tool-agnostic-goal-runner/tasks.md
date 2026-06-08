# Tasks: tool-agnostic-goal-runner

## 1. Contract layer

- [x] 1.1 Extend `workflow-schema.json` + `workflow-loader.ts` + `spec-driven.workflow.yaml`
- [x] 1.2 Implement `resolveAutoChain`, `classifyPhaseVerdict`, `dependency_policy` in `phase-transition-policy.ts`
- [x] 1.3 Add `goal-manifest` schema + parser
- [x] 1.4 Add `goal-report-generator.ts`

## 2. Execution layer

- [x] 2.1 Implement `goal-runner.ts` with run evidence layer
- [x] 2.2 Implement `agent-invoke.ts` (claude -p, codex exec)
- [x] 2.3 Implement unattended preflight validation

## 3. Adapter layer

- [x] 3.1 Extend `adapter-schema.yaml`; check-init WARN for goal_capability
- [x] 3.2 Fill claude/cursor/generic/codex adapter metadata
- [x] 3.3 Add `goal-orchestration` skill + index + bridges

## 4. Verification & docs

- [x] 4.1 Unit tests + register in run-unit.ts
- [x] 4.2 Update phase-transition-policy.md, goal-mode-runbook.md, user-confirmation-ux §8
- [x] 4.3 `cd harness && npm test` PASS; release:check-plans
