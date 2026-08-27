## 1. Birth schema and shared creation

- [ ] 1.1 Add `run_base_sha` to manifest types/schema/identity round-trip and implement run-created identity/digest validation helpers.
- [ ] 1.2 Implement fresh-only `createGoalRun` with resolved-chain baseline requirement, manifest→single `run_created` ordering, and no-agent fail-closed behavior.
- [ ] 1.3 Route detached fresh CLI and attended `prepareGoalModeRun` through `createGoalRun`; keep resume/attach load-only and add entry parity tests.
- [ ] 1.4 Classify manifest-only/invalid birth residue as `CREATION_INCOMPLETE` across attach, resume, supervisor, occupancy, GC diagnostics and progress projection.

## 2. Identity immutability and baseline consumers

- [ ] 2.1 Keep `run_base_sha` visible in `diffManifestIdentityFields`, reject it before all override authorization in `resolveManifestDriftDecision`, and protect it during identity-rebase replay.
- [ ] 2.2 Add write-once negative tests for modify+override, delete+override, corrupt historical rebase and authorized non-base identity drift.
- [ ] 2.3 Implement shared `resolveGoalRunBaseline` with hard `run_created` era boundary and strict legacy `run_start`+anchor compatibility.
- [ ] 2.4 Migrate UI scope and UT target consumers to the shared manifest baseline; scrub/warn-once for goal `HARNESS_DIFF_BASE_REF` while preserving non-goal manual behavior.
- [ ] 2.5 Remove the coding-base producer/events and register runtime-owned birth/baseline failures as non-`agent_fixable` in the existing classifier.

## 3. Successor and management rebaseline

- [ ] 3.1 Make automatic successors inherit the earliest trustworthy lineage baseline without reading HEAD and fail closed when ancestry has no valid baseline.
- [ ] 3.2 Extract `hasGoalExecutionSignal`, preserve `isAgentSideGoalHarness` formal-gate semantics, and add predicate regressions.
- [ ] 3.3 Implement paired `--supersede`/`--rebaseline-to` validation, exact HEAD equality, goal-signal rejection and new-run-only audit bindings.
- [ ] 3.4 Add structural and behavior tests proving supervisor/executors never construct rebaseline, old events are unchanged, occupancy is cleared, and a valid management successor starts.

## 4. Contracts, docs and verification

- [ ] 4.1 Update goal-mode runbook/skill, manifest schema documentation and `MIGRATION.md` for birth baseline, successor, rebaseline, legacy and incomplete-creation behavior.
- [ ] 4.2 Run TypeScript typecheck plus targeted birth/identity/baseline/successor/attended-detached tests and fix regressions.
- [ ] 4.3 Run `cd harness && npm test`, strict OpenSpec validation and `npm run release:verify -- --skip-typecheck`; record any externally blocked host-only evidence without marking it complete.
