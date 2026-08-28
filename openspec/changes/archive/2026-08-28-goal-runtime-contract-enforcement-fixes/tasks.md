## 1. Birth Contract Corrections

- [x] 1.1 Persist the normalized actual phase chain in the existing manifest and `run_created`, validate equality, and use it for modern resume/attach with an era-bounded legacy fallback.
- [x] 1.2 Make the shared creation validator and baseline resolver reject every `run_base_sha` presence/value mismatch.
- [x] 1.3 Add production-path tests for workflow drift across HALTED resume and post-birth baseline injection/deletion/change.

## 2. Shared Runtime Authorization

- [x] 2.1 Pass attended authorization, through-phase, lease and round limits into `GoalPhaseRuntime` and enforce them at phase boundaries.
- [x] 2.2 Add production-chain tests proving manual zero-invoke, batch through-phase confinement and single-round one-phase confinement.

## 3. Canonical Handoff Failure

- [x] 3.1 Write the requested target owner kind on production `handoff_rejected` events and project the production event shape canonically.
- [x] 3.2 Replace synthetic rejected-handoff test facts with the real production event shape and assert the failed direction.

## 4. Milestone and Verification Closure

- [x] 4.1 Reopen M1/M2 during correction, then mark them complete only after targeted tests, structural acceptance and typecheck pass.
- [x] 4.2 Run `npm test`, `npm run openspec:validate`, `node scripts/check-plan-version.mjs`, `npm run release:check-plans`, and `npm run release:verify -- --skip-typecheck`; document any external or unrelated release blockers without bypassing them.
