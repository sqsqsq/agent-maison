# Tasks: Extension manifest 1.1

## 1. Protocol and loader

- [x] Update the manifest schema/types/loader for 1.1 knowledge, mcp_actions, and the three phase binding slots, including closed-field validation and 1.0 compatibility tests.
- [x] Switch 1.1 Skill bridge selection to manifest `provides.skills[]` while preserving 1.0 directory behavior.

## 2. Consumers and gates

- [x] Route global and phase knowledge to AGENTS/CLAUDE and phase ai-prompt projections with exact audience filtering.
- [x] Add before-work/before-verify/after-verify-before-close binding projections and required/optional produces checks through existing CheckResult/receipt paths.
- [x] Add MCP action inspect/self-report semantics and ordinary produces evidence checks without server or credential management.
- [x] Reuse existing materialization/feedback validators for M7 produces and report explicit consumers in inspect.

## 3. Documentation and proof

- [x] Update `/extension`, schema/concept/runbook/acceptance docs, DOC_INVENTORY, host adaptation §7, packaged manifest sample, adapter/index wiring, and leave maintainer changelog generation to m5.
- [x] Register and run positive/negative unit and fixture coverage, including M7 hash/authority mutations and 1.0/no-extension zero behavior.
- [x] Run strict OpenSpec, plan gate, typecheck, unit, fixtures, diff/EOL checks, and record exact results in plan d8 implementation notes.
