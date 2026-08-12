## 1. Provider decoupling

- [x] 1.1 Add `tryLoadGraphExtractor(profileDir)` to `harness/profile-host-loader.ts`
- [x] 1.2 Export `graphExtractor` from hmos-app host; refactor `bootstrap-code-graph.ts` to use loader

## 2. Harness module-graph phase

- [x] 2.1 Implement `harness/scripts/check-module-graph.ts` (zero-graph PASS, schema + drift mapping)
- [x] 2.2 Add `specs/phase-rules/module-graph-rules.yaml` + hmos overlay
- [x] 2.3 Wire `PHASE_RULE_FILENAMES`, `KnownPhase`, `isGlobalPhase`, `normalizePhaseDisabled`
- [x] 2.4 Add `module-graph` node to `workflows/spec-driven.workflow.yaml`

## 3. Skill + profile layers

- [x] 3.1 Public `skills/project/code-graph/SKILL.md`
- [x] 3.2 hmos-app addendum, prompts, template, skill-assets
- [x] 3.3 generic placeholder addendum + skill-assets

## 4. Registration & discovery

- [x] 4.1 `skills/skills.index.yaml`, bridge, Claude slash, confirmation registry
- [x] 4.2 Adapter counts, AGENTS template routing, static lint lists

## 5. Docs & tests

- [x] 5.1 Update `docs/concepts/code-graph.md` §6.1
- [x] 5.2 Unit tests: check-module-graph cases + `listAvailablePhaseRules`
- [x] 5.3 `cd harness && npm test`, `npm run release:verify`, `npm run openspec:validate`
